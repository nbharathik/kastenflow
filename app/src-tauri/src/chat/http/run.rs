//! One request across its tries: how many have been made, how long it has
//! taken, which client it uses, and the line it leaves in the connection
//! report. A try that failed is a `Trial`, with what asking again could do.

use std::time::{Duration, Instant};

use super::HttpModel;
use crate::chat::diagnostics::{RequestOutcome, Stage, route_of};
use crate::chat::errors::FailKind;
use crate::chat::model::{Failure, Reply, Stop};
use crate::chat::retry::Again;

/// A try that failed.
pub(super) struct Trial {
    pub(super) message: String,
    pub(super) kind: FailKind,
    /// Whether asking again can help, and how.
    pub(super) again: Again,
    pub(super) stage: Stage,
    pub(super) status: Option<u16>,
    /// One word for the connection report.
    pub(super) reason: String,
    /// What the model had said by then, kept if no try is left.
    pub(super) partial: Option<Box<Reply>>,
}

impl Trial {
    /// A failure that asking again will not change.
    pub(super) fn new(message: impl Into<String>, kind: FailKind, stage: Stage) -> Trial {
        Trial {
            message: message.into(),
            kind,
            again: Again::never(),
            stage,
            status: None,
            reason: String::new(),
            partial: None,
        }
    }

    pub(super) fn again(mut self, again: Again) -> Trial {
        self.again = again;
        self
    }

    pub(super) fn because(mut self, reason: impl Into<String>) -> Trial {
        self.reason = reason.into();
        self
    }

    pub(super) fn answered(mut self, status: u16) -> Trial {
        self.status = Some(status);
        self
    }

    /// The failure the turn gets when no try is left.
    pub(super) fn into_failure(self, attempts: u32) -> Failure {
        let message = if attempts > 1 {
            format!("{} Tried {attempts} times.", self.message.trim_end())
        } else {
            self.message
        };
        Failure {
            message,
            partial: self.partial.map(|partial| *partial),
            kind: self.kind,
        }
    }

    /// How the notice about asking again begins.
    fn lead(&self) -> &'static str {
        match (self.status, self.reason.as_str()) {
            (Some(429), _) => "Rate limited",
            (Some(_), _) => "The server is busy",
            (None, "closed" | "cut" | "connect" | "timeout") => "Connection dropped",
            (None, "idle") => "No answer",
            _ => "The server is busy",
        }
    }

    /// The notice for try number `next` of `total`.
    pub(super) fn notice(&self, next: u32, total: u32) -> String {
        format!("{}, trying again ({next} of {total})", self.lead())
    }
}

/// A request in progress.
pub(super) struct Run {
    started: Instant,
    attempt_started: Instant,
    pub(super) attempts: u32,
    /// Tries that ended in a silence that was given up on.
    pub(super) silences: u32,
    first_byte: Option<Duration>,
    pub(super) renewed: bool,
    pub(super) rebuilt: bool,
    /// The client this request is using.
    pub(super) client: reqwest::Client,
    generation: Option<u64>,
    /// How far the latest try got.
    pub(super) stage: Stage,
    pub(super) status: Option<u16>,
}

impl Run {
    pub(super) fn start(model: &HttpModel) -> Run {
        let (client, generation) = match model.link.as_ref().map(|link| link.get()) {
            Some(Ok((client, generation))) => (client, Some(generation)),
            _ => (model.http.clone(), None),
        };
        Run {
            started: Instant::now(),
            attempt_started: Instant::now(),
            attempts: 0,
            silences: 0,
            first_byte: None,
            renewed: false,
            rebuilt: false,
            client,
            generation,
            stage: Stage::Request,
            status: None,
        }
    }

    /// A new try begins.
    pub(super) fn begin_attempt(&mut self) {
        self.attempts += 1;
        self.attempt_started = Instant::now();
        self.first_byte = None;
        self.stage = Stage::Request;
        self.status = None;
    }

    /// The first piece of the answer came.
    pub(super) fn first_chunk(&mut self) {
        self.first_byte
            .get_or_insert_with(|| self.attempt_started.elapsed());
    }

    /// Takes a new client in place of the one a connection failed on.
    pub(super) fn rebuild(&mut self, model: &HttpModel) {
        let (Some(link), Some(seen)) = (&model.link, self.generation) else {
            return;
        };
        if let Ok((client, generation)) = link.replace(seen) {
            self.rebuilt |= generation != seen;
            self.client = client;
            self.generation = Some(generation);
        }
    }

    /// The line this request leaves in the connection report.
    pub(super) fn outcome(
        &self,
        model: &HttpModel,
        result: Result<&Reply, &Trial>,
    ) -> RequestOutcome {
        let millis = |d: Duration| u64::try_from(d.as_millis()).unwrap_or(u64::MAX);
        let (ok, stage, status, kind, reason) = match result {
            Ok(reply) => (
                true,
                Stage::Stream,
                self.status,
                None,
                if reply.stop == Stop::Cancelled {
                    "stopped".to_owned()
                } else {
                    String::new()
                },
            ),
            Err(trial) => (
                false,
                trial.stage,
                trial.status.or(self.status),
                Some(trial.kind),
                trial.reason.clone(),
            ),
        };
        RequestOutcome {
            at: kasten_core::Instant::now().millis,
            provider: model.kind.word().to_owned(),
            model: model.model.clone(),
            route: route_of(&model.url),
            ok,
            stage,
            status,
            kind,
            reason,
            attempts: self.attempts,
            first_byte_ms: self.first_byte.map(millis),
            total_ms: millis(self.started.elapsed()),
            renewed: self.renewed,
            rebuilt: self.rebuilt,
        }
    }
}
