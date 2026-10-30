//! Who builds when. Each document has at most one build running and one
//! waiting; a new request replaces the one waiting. A build that started less
//! than 300 ms ago is stopped and replaced (the request is almost certainly a
//! correction of the one before), a build that has run longer finishes first.
//! Two documents build at once at most. The scheduler only decides: it hands
//! back what to start, stop and drop, and the caller does it, so the rules
//! can be tested with a clock that is just a number.

use std::collections::{HashMap, VecDeque};

/// A build that started less than this long ago is stopped for a newer one.
pub const RESTART_WITHIN_MS: u64 = 300;
/// Most builds running at once, whatever the documents.
pub const GLOBAL_CAP: usize = 2;

/// What the caller has to do.
#[derive(Debug, PartialEq, Eq)]
pub enum Action<J> {
    /// Start `job` (build number `seq` of `doc`).
    Start { doc: String, seq: u64, job: J },
    /// Stop the running build `seq` of `doc`; it ends with `finished`.
    Kill { doc: String, seq: u64 },
    /// The waiting build `seq` of `doc` will never run.
    Drop { doc: String, seq: u64 },
}

struct Running {
    seq: u64,
    started: u64,
    /// Told to stop already.
    killed: bool,
}

struct Slot<J> {
    running: Option<Running>,
    pending: Option<(u64, J)>,
    /// In the line of documents waiting for a free place.
    waiting: bool,
}

pub struct Scheduler<J> {
    cap: usize,
    next: u64,
    running: usize,
    docs: HashMap<String, Slot<J>>,
    line: VecDeque<String>,
}

impl<J> Scheduler<J> {
    pub fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(1),
            next: 1,
            running: 0,
            docs: HashMap::new(),
            line: VecDeque::new(),
        }
    }

    /// How many builds are running.
    #[cfg(test)]
    pub fn running(&self) -> usize {
        self.running
    }

    /// Asks for a build of `doc` at time `now` (milliseconds). Answers its
    /// number and what to do.
    pub fn submit(&mut self, doc: &str, job: J, now: u64) -> (u64, Vec<Action<J>>) {
        let seq = self.next;
        self.next += 1;
        let mut actions = Vec::new();
        let slot = self.docs.entry(doc.to_owned()).or_insert(Slot {
            running: None,
            pending: None,
            waiting: false,
        });
        if let Some((old, _)) = slot.pending.replace((seq, job)) {
            actions.push(Action::Drop {
                doc: doc.to_owned(),
                seq: old,
            });
        }
        match &mut slot.running {
            Some(run) => {
                if !run.killed && now.saturating_sub(run.started) < RESTART_WITHIN_MS {
                    run.killed = true;
                    actions.push(Action::Kill {
                        doc: doc.to_owned(),
                        seq: run.seq,
                    });
                }
            }
            None => {
                if !slot.waiting {
                    slot.waiting = true;
                    self.line.push_back(doc.to_owned());
                }
                self.fill(now, &mut actions);
            }
        }
        (seq, actions)
    }

    /// Stops what `doc` is doing and drops what waits for it.
    pub fn cancel(&mut self, doc: &str) -> Vec<Action<J>> {
        let mut actions = Vec::new();
        if let Some(slot) = self.docs.get_mut(doc) {
            if let Some((seq, _)) = slot.pending.take() {
                actions.push(Action::Drop {
                    doc: doc.to_owned(),
                    seq,
                });
            }
            if let Some(run) = &mut slot.running
                && !run.killed
            {
                run.killed = true;
                actions.push(Action::Kill {
                    doc: doc.to_owned(),
                    seq: run.seq,
                });
            }
        }
        self.forget_idle(doc);
        actions
    }

    /// Tells that build `seq` of `doc` is over (however it ended). Answers
    /// what to start now that a place is free.
    pub fn finished(&mut self, doc: &str, seq: u64, now: u64) -> Vec<Action<J>> {
        let mut actions = Vec::new();
        let Some(slot) = self.docs.get_mut(doc) else {
            return actions;
        };
        if slot.running.as_ref().is_none_or(|run| run.seq != seq) {
            return actions;
        }
        slot.running = None;
        self.running = self.running.saturating_sub(1);
        if slot.pending.is_some() && !slot.waiting {
            slot.waiting = true;
            self.line.push_back(doc.to_owned());
        }
        self.forget_idle(doc);
        self.fill(now, &mut actions);
        actions
    }

    /// Starts waiting builds while there is room.
    fn fill(&mut self, now: u64, actions: &mut Vec<Action<J>>) {
        while self.running < self.cap {
            let Some(doc) = self.line.pop_front() else {
                break;
            };
            let Some(slot) = self.docs.get_mut(&doc) else {
                continue;
            };
            slot.waiting = false;
            if slot.running.is_some() {
                continue;
            }
            let Some((seq, job)) = slot.pending.take() else {
                // Cancelled while it waited: nothing is left of it.
                self.docs.remove(&doc);
                continue;
            };
            slot.running = Some(Running {
                seq,
                started: now,
                killed: false,
            });
            self.running += 1;
            actions.push(Action::Start { doc, seq, job });
        }
    }

    /// Forgets `doc` when it has nothing running or waiting.
    fn forget_idle(&mut self, doc: &str) {
        if self
            .docs
            .get(doc)
            .is_some_and(|slot| slot.running.is_none() && slot.pending.is_none() && !slot.waiting)
        {
            self.docs.remove(doc);
        }
    }
}
