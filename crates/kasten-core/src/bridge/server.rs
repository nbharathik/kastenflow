//! The app's side: a loop that takes up the requests in the mailbox and gives
//! each to a handler, and keeps saying the app is there. It runs on threads of
//! its own inside the app (a short interval, no new dependency); `stop` ends it.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use serde_json::Value;

use super::ALIVE_EVERY_MS;
use super::call::{Call, Reply, Request};
use super::files::{Mailbox, Taken};
use crate::error::{Error, Result};
use crate::time::Instant;

/// How often the mailbox is looked at.
const TICK: Duration = Duration::from_millis(100);
/// How often old files are swept.
const SWEEP_EVERY_MS: u64 = 30_000;
/// The most requests being worked on at once; the rest wait their turn.
const MAX_PARALLEL: usize = 4;

/// What the app does with a request: the answer's result, or one plain
/// sentence for why not. The call is checked already (it names a place inside
/// the vault); the handler checks the document again.
pub type Handler = Arc<dyn Fn(Request, Call) -> std::result::Result<Value, String> + Send + Sync>;

/// A running server. Dropping it stops it.
pub struct Server {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Server {
    /// Ends the loop and says the app is gone. Requests being worked on
    /// finish and answer.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Starts answering requests in `mailbox`, telling `version` as the app's.
pub fn serve(mailbox: Mailbox, version: &str, handler: Handler) -> Result<Server> {
    mailbox.ensure_dirs()?;
    mailbox.mark_alive(version, Instant::now().millis)?;
    let stop = Arc::new(AtomicBool::new(false));
    let (flag, version) = (Arc::clone(&stop), version.to_owned());
    let thread = std::thread::Builder::new()
        .name("kasten-bridge".into())
        .spawn(move || run(&mailbox, &version, &handler, &flag))
        .map_err(Error::Io)?;
    Ok(Server {
        stop,
        thread: Some(thread),
    })
}

fn run(mailbox: &Mailbox, version: &str, handler: &Handler, stop: &AtomicBool) {
    let busy = Arc::new(AtomicUsize::new(0));
    let start = Instant::now().millis;
    let (mut said, mut swept) = (start, start);
    while !stop.load(Ordering::SeqCst) {
        let now = Instant::now().millis;
        if now.saturating_sub(said) >= ALIVE_EVERY_MS {
            let _ = mailbox.mark_alive(version, now);
            said = now;
        }
        if now.saturating_sub(swept) >= SWEEP_EVERY_MS {
            mailbox.sweep(now);
            swept = now;
        }
        // A folder that went is made again; one that is now a link stays refused.
        let _ = mailbox.ensure_dirs();
        for id in mailbox.waiting() {
            if busy.load(Ordering::SeqCst) >= MAX_PARALLEL {
                break;
            }
            match mailbox.take_request(&id, now) {
                Taken::Nothing => {}
                Taken::Reply(reply) => {
                    let _ = mailbox.put_reply(&reply);
                }
                Taken::Request(request) => work(mailbox, handler, &busy, request),
            }
        }
        std::thread::sleep(TICK);
    }
    // What the person had selected is not left behind for the next reader.
    mailbox.clear_selection();
    mailbox.clear_alive();
}

/// Works on one request on a thread of its own, so a long build never holds
/// up the next request.
fn work(mailbox: &Mailbox, handler: &Handler, busy: &Arc<AtomicUsize>, request: Request) {
    busy.fetch_add(1, Ordering::SeqCst);
    let id = request.id.clone();
    let (mailbox_for, handler_for, busy_for) =
        (mailbox.clone(), Arc::clone(handler), Arc::clone(busy));
    let started = std::thread::Builder::new()
        .name("kasten-bridge-job".into())
        .spawn(move || {
            answer(&mailbox_for, &handler_for, request);
            busy_for.fetch_sub(1, Ordering::SeqCst);
        });
    if started.is_err() {
        busy.fetch_sub(1, Ordering::SeqCst);
        let _ = mailbox.put_reply(&Reply::failed(&id, "The app could not start that just now"));
    }
}

fn answer(mailbox: &Mailbox, handler: &Handler, request: Request) {
    let id = request.id.clone();
    let reply = match request.call() {
        Err(why) => Reply::failed(&id, why),
        Ok(call) => match catch_unwind(AssertUnwindSafe(|| handler(request, call))) {
            Ok(Ok(value)) => Reply::ok(&id, value),
            Ok(Err(why)) => Reply::failed(&id, why),
            Err(_) => Reply::failed(&id, "The app stopped while doing that: try again"),
        },
    };
    if mailbox.put_reply(&reply).is_err() {
        let _ = mailbox.put_reply(&Reply::failed(&id, "The answer was too big to send back"));
    }
}
