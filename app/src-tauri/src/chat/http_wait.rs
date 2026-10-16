//! What the model over HTTP waits with and reads with: a wait that looks at
//! the stop flag several times a second and gives up after a long silence,
//! and the decoder of whichever provider's stream is being read.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::errors::{FailKind, StreamError};
use super::http::{IDLE, Kind};
use super::model::{Failure, Reply};
use super::sse::SseEvent;
use super::{anthropic, openai, responses};

/// How often a wait looks at the stop flag.
const TICK: Duration = Duration::from_millis(200);

pub(super) enum Decoder {
    Anthropic(anthropic::Stream),
    OpenAi(openai::Stream),
    Responses(responses::Stream),
}

impl Decoder {
    pub(super) fn of(kind: Kind) -> Decoder {
        match kind {
            Kind::Anthropic => Decoder::Anthropic(anthropic::Stream::default()),
            Kind::OpenAi => Decoder::OpenAi(openai::Stream::default()),
            Kind::ChatGpt => Decoder::Responses(responses::Stream::default()),
        }
    }

    pub(super) fn event(&mut self, event: &SseEvent) -> Result<Option<String>, String> {
        match self {
            Decoder::Anthropic(s) => s.event(event),
            Decoder::OpenAi(s) => s.event(event),
            Decoder::Responses(s) => s.event(event),
        }
    }

    pub(super) fn ended(&self) -> bool {
        match self {
            Decoder::Anthropic(s) => s.ended(),
            Decoder::OpenAi(s) => s.ended(),
            Decoder::Responses(s) => s.ended(),
        }
    }

    /// Whether a tool call has come whole. A stream that breaks before that
    /// can be asked for again; after it, the model has decided something and
    /// the break is reported.
    pub(super) fn call_done(&self) -> bool {
        match self {
            Decoder::Anthropic(s) => s.call_done(),
            Decoder::OpenAi(s) => s.call_done(),
            Decoder::Responses(s) => s.call_done(),
        }
    }

    /// What the error that ended the stream meant, if it said.
    pub(super) fn stream_error(&self) -> Option<StreamError> {
        match self {
            Decoder::Anthropic(s) => s.error(),
            Decoder::OpenAi(s) => s.error(),
            Decoder::Responses(s) => s.error(),
        }
    }

    pub(super) fn complete(&self) -> bool {
        match self {
            Decoder::Anthropic(s) => s.complete(),
            Decoder::OpenAi(s) => s.complete(),
            Decoder::Responses(s) => s.complete(),
        }
    }

    pub(super) fn reply(self, cancelled: bool) -> Reply {
        match self {
            Decoder::Anthropic(s) => s.reply(cancelled),
            Decoder::OpenAi(s) => s.reply(cancelled),
            Decoder::Responses(s) => s.reply(cancelled),
        }
    }

    /// A failure that keeps the text said so far.
    pub(super) fn failed(self, message: String, kind: FailKind) -> Failure {
        let partial = self.reply(true);
        Failure {
            message,
            partial: (!partial.text.trim().is_empty()).then_some(partial),
            kind,
        }
    }
}

pub(super) enum Waited<T> {
    Done(T),
    Cancelled,
    TimedOut,
}

/// Awaits `future` unless the person stops the turn or nothing happens
/// for `IDLE`.
pub(super) async fn wait<F: Future>(future: F, cancel: &AtomicBool) -> Waited<F::Output> {
    let mut future = std::pin::pin!(future);
    let mut quiet = Duration::ZERO;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Waited::Cancelled;
        }
        match tokio::time::timeout(TICK, future.as_mut()).await {
            Ok(output) => return Waited::Done(output),
            Err(_) => {
                quiet += TICK;
                if quiet >= IDLE {
                    return Waited::TimedOut;
                }
            }
        }
    }
}
