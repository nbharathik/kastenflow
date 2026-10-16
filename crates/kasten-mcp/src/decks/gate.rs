//! One picture is drawn at a time, with one more waiting. The render host is a
//! browser, which is heavy and draws one thing at a time; a model that asks for
//! every slide of a deck at once must not queue up a dozen browser calls behind
//! each other. A call that finds one drawing and one waiting is told at once to
//! try again; the one waiting gives up after a while; and a call that was
//! cancelled (the client withdrew its request, the person pressed Stop) never
//! starts, and its picture is thrown away if the browser was busy with it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// How long a call waits for the drawing before it.
pub(crate) const WAIT: Duration = Duration::from_secs(30);

/// How often a waiting call looks at whether it was cancelled.
const LOOK: Duration = Duration::from_millis(50);

/// Why a call was not let through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refused {
    /// One is drawing and one is waiting already.
    Busy,
    /// It waited as long as it may.
    Waited,
    /// It was cancelled.
    Cancelled,
}

#[derive(Default)]
struct State {
    drawing: bool,
    waiting: usize,
}

/// The gate: one drawing, one waiting.
pub(crate) struct Gate {
    state: Mutex<State>,
    changed: Condvar,
}

/// The right to draw; the next in line goes when it is dropped.
pub(crate) struct Turn<'a>(&'a Gate);

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        self.0.lock().drawing = false;
        self.0.changed.notify_one();
    }
}

fn cancelled(flag: Option<&AtomicBool>) -> bool {
    flag.is_some_and(|f| f.load(Ordering::SeqCst))
}

impl Gate {
    pub(crate) const fn new() -> Gate {
        Gate {
            state: Mutex::new(State {
                drawing: false,
                waiting: 0,
            }),
            changed: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Waits for the turn to draw: at once if nobody is, for up to `wait` if one
    /// is drawing and nobody waits, and not at all if one waits already.
    pub(crate) fn enter(
        &self,
        cancel: Option<&AtomicBool>,
        wait: Duration,
    ) -> Result<Turn<'_>, Refused> {
        if cancelled(cancel) {
            return Err(Refused::Cancelled);
        }
        let mut state = self.lock();
        if !state.drawing {
            state.drawing = true;
            return Ok(Turn(self));
        }
        if state.waiting >= 1 {
            return Err(Refused::Busy);
        }
        state.waiting += 1;
        let until = Instant::now() + wait;
        loop {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                state.waiting -= 1;
                return Err(Refused::Waited);
            }
            state = self
                .changed
                .wait_timeout(state, left.min(LOOK))
                .unwrap_or_else(PoisonError::into_inner)
                .0;
            if cancelled(cancel) {
                state.waiting -= 1;
                return Err(Refused::Cancelled);
            }
            if !state.drawing {
                state.waiting -= 1;
                state.drawing = true;
                return Ok(Turn(self));
            }
        }
    }

    /// Runs `work` when it is this call's turn. What it made is thrown away if
    /// the call was cancelled meanwhile.
    pub(crate) fn run<T>(
        &self,
        cancel: Option<&AtomicBool>,
        wait: Duration,
        work: impl FnOnce() -> T,
    ) -> Result<T, Refused> {
        let _turn = self.enter(cancel, wait)?;
        let made = work();
        if cancelled(cancel) {
            return Err(Refused::Cancelled);
        }
        Ok(made)
    }
}

/// The one gate every drawing in this program goes through.
pub(crate) static GATE: Gate = Gate::new();

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;

    /// A fake renderer: it draws when told to, and counts how many are at it at once.
    struct Fake {
        inside: AtomicUsize,
        most: AtomicUsize,
    }

    impl Fake {
        fn draw(&self, until: &mpsc::Receiver<()>) -> &'static str {
            let now = self.inside.fetch_add(1, Ordering::SeqCst) + 1;
            self.most.fetch_max(now, Ordering::SeqCst);
            let _ = until.recv_timeout(Duration::from_secs(5));
            self.inside.fetch_sub(1, Ordering::SeqCst);
            "picture"
        }
    }

    fn fake() -> Arc<Fake> {
        Arc::new(Fake {
            inside: AtomicUsize::new(0),
            most: AtomicUsize::new(0),
        })
    }

    #[test]
    fn a_third_call_is_told_at_once_to_try_again_and_two_never_draw_together() {
        let gate = Arc::new(Gate::new());
        let renderer = fake();
        let (go_first, first_waits) = mpsc::channel();
        let (go_second, second_waits) = mpsc::channel();
        let first = {
            let (gate, renderer) = (Arc::clone(&gate), Arc::clone(&renderer));
            std::thread::spawn(move || {
                gate.run(None, Duration::from_secs(5), || renderer.draw(&first_waits))
            })
        };
        // Let the first begin.
        while renderer.inside.load(Ordering::SeqCst) == 0 {
            std::thread::sleep(Duration::from_millis(2));
        }
        let second = {
            let (gate, renderer) = (Arc::clone(&gate), Arc::clone(&renderer));
            std::thread::spawn(move || {
                gate.run(None, Duration::from_secs(5), || {
                    renderer.draw(&second_waits)
                })
            })
        };
        // The second is waiting once the gate counts it.
        while gate.lock().waiting == 0 {
            std::thread::sleep(Duration::from_millis(2));
        }
        let started = Instant::now();
        let third = gate.run(None, Duration::from_secs(5), || "never");
        assert_eq!(third, Err(Refused::Busy));
        assert!(started.elapsed() < Duration::from_secs(1), "told at once");
        go_first.send(()).unwrap();
        assert_eq!(first.join().unwrap(), Ok("picture"));
        go_second.send(()).unwrap();
        assert_eq!(second.join().unwrap(), Ok("picture"));
        assert_eq!(renderer.most.load(Ordering::SeqCst), 1);
        // And the gate is free again.
        assert_eq!(gate.run(None, WAIT, || 7), Ok(7));
    }

    #[test]
    fn a_call_that_waits_too_long_gives_up_and_leaves_the_gate_as_it_was() {
        let gate = Gate::new();
        let turn = gate.enter(None, WAIT).unwrap();
        let started = Instant::now();
        assert_eq!(
            gate.enter(None, Duration::from_millis(120)).err(),
            Some(Refused::Waited)
        );
        assert!(started.elapsed() >= Duration::from_millis(100));
        assert_eq!(gate.lock().waiting, 0);
        drop(turn);
        assert!(gate.enter(None, WAIT).is_ok());
    }

    #[test]
    fn a_cancelled_call_never_starts_and_a_waiting_one_stops_waiting() {
        let gate = Arc::new(Gate::new());
        let flag = Arc::new(AtomicBool::new(true));
        assert_eq!(
            gate.run(Some(flag.as_ref()), WAIT, || "never").err(),
            Some(Refused::Cancelled)
        );
        // Waiting behind a drawing, it is cancelled.
        let turn = gate.enter(None, WAIT).unwrap();
        flag.store(false, Ordering::SeqCst);
        let waiter = {
            let (gate, flag) = (Arc::clone(&gate), Arc::clone(&flag));
            std::thread::spawn(move || gate.run(Some(flag.as_ref()), WAIT, || "never"))
        };
        while gate.lock().waiting == 0 {
            std::thread::sleep(Duration::from_millis(2));
        }
        flag.store(true, Ordering::SeqCst);
        assert_eq!(waiter.join().unwrap(), Err(Refused::Cancelled));
        assert_eq!(gate.lock().waiting, 0);
        drop(turn);
    }

    #[test]
    fn what_a_cancelled_call_drew_is_thrown_away() {
        let gate = Gate::new();
        let flag = AtomicBool::new(false);
        let made = gate.run(Some(&flag), WAIT, || {
            flag.store(true, Ordering::SeqCst);
            "a picture nobody wants"
        });
        assert_eq!(made, Err(Refused::Cancelled));
        assert!(gate.enter(None, WAIT).is_ok(), "the turn was given back");
    }
}
