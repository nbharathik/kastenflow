//! The model over HTTP answering: a request is tried up to four times. What
//! passes (a busy or rate-limiting server, a connection that dropped, a
//! stream that broke before a tool call came whole) is sent again after a
//! wait, with the notice "trying again (2 of 4)" while it waits; what will not
//! change (a refused key, a model that is not there, a chat that is too long)
//! is reported at once. Nothing is repeated once a tool call came whole, since
//! the model had decided something. The wait ends the moment Stop is pressed.
//! A try that broke leaves nothing in the thread: the thread keeps the text
//! of the try that worked, and the window is told to drop what the failed
//! one had shown.

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use super::HttpModel;
use super::run::{Run, Trial};
use crate::chat::diagnostics::Stage;
use crate::chat::errors::{FailKind, chain};
use crate::chat::http_wait::{Decoder, Waited, wait};
use crate::chat::model::{Call, Failure, Model, Notice, Reply};
use crate::chat::retry::{self, Again, LONGEST_ASKED};
use crate::chat::sse::SseParser;

/// The code of a notice that says a try is being repeated.
pub const RETRY: &str = "retry";

impl HttpModel {
    /// How long to wait before the next try, or None when there is none.
    fn wait_before_next(&self, run: &mut Run, trial: &Trial) -> Option<Duration> {
        let again = trial.again;
        if !again.passes || run.attempts >= self.policy.attempts {
            return None;
        }
        if again.silent {
            run.silences += 1;
            // Two silences of three minutes are all anyone should sit through.
            if run.silences >= 2 {
                return None;
            }
        }
        if again.asked.is_some_and(|asked| asked > LONGEST_ASKED) {
            return None;
        }
        Some(
            self.policy
                .wait(run.attempts + 1, again.asked, retry::unit()),
        )
    }

    fn tell_retry(&self, text: String) {
        if let Ok(mut retries) = self.retries.lock() {
            retries.push(text);
        }
    }

    /// Writes the request's outcome to the report.
    fn record(&self, run: &Run, result: Result<&Reply, &Trial>) {
        let outcome = run.outcome(self, result);
        if let Ok(mut last) = self.last.lock() {
            *last = Some(outcome.clone());
        }
        self.report.record(outcome);
    }

    /// A stream that failed after it began. A tool call that came whole is
    /// not asked for again: the model has decided something.
    fn broke(
        &self,
        decoder: Decoder,
        message: String,
        kind: FailKind,
        again: Again,
        reason: &str,
    ) -> Trial {
        let whole = decoder.call_done();
        let failure = decoder.failed(message, kind);
        let mut trial = Trial::new(failure.message, failure.kind, Stage::Stream)
            .again(Again {
                passes: again.passes && !whole,
                ..again
            })
            .because(reason);
        trial.partial = failure.partial.map(Box::new);
        trial
    }

    /// One try: the request, and the answer read to its end.
    async fn attempt(
        &self,
        call: &Call<'_>,
        text: &(dyn Fn(&str) + Sync),
        cancel: &AtomicBool,
        run: &mut Run,
    ) -> Result<Reply, Trial> {
        let mut decoder = Decoder::of(self.kind);
        let Some(mut response) = self.open(call, cancel, run).await? else {
            return Ok(decoder.reply(true));
        };
        run.stage = Stage::Stream;
        let mut sse = SseParser::default();
        loop {
            let (events, end) = match wait(response.chunk(), cancel).await {
                Waited::Done(Ok(Some(chunk))) => {
                    run.first_chunk();
                    (sse.push(&chunk), false)
                }
                Waited::Done(Ok(None)) => (sse.finish(), true),
                Waited::Done(Err(err)) => {
                    let message = format!("The connection to {} broke: {}", self.name, chain(&err));
                    let again = Again {
                        passes: true,
                        stale: true,
                        ..Again::never()
                    };
                    return Err(self.broke(
                        decoder,
                        message,
                        FailKind::Connection,
                        again,
                        "closed",
                    ));
                }
                Waited::Cancelled => return Ok(decoder.reply(true)),
                Waited::TimedOut => {
                    let again = Again {
                        passes: true,
                        stale: true,
                        silent: true,
                        ..Again::never()
                    };
                    let message = self.silent_words();
                    return Err(self.broke(decoder, message, FailKind::Connection, again, "idle"));
                }
            };
            if sse.overflowed() {
                let message = format!("{} sent more in one piece than KastenFlow reads", self.name);
                return Err(self.broke(
                    decoder,
                    message,
                    FailKind::Other,
                    Again::never(),
                    "overflow",
                ));
            }
            for event in &events {
                match decoder.event(event) {
                    Ok(Some(piece)) => text(&piece),
                    Ok(None) => {}
                    Err(why) => {
                        let message = format!("{} stopped with an error: {why}", self.name);
                        // The provider's own code says what kind of failure it was and
                        // whether it passes; a stream that says the chat is too long is
                        // that kind.
                        let found = decoder.stream_error();
                        let kind = found
                            .as_ref()
                            .map_or_else(|| crate::chat::errors::classify(200, &why), |f| f.kind);
                        let again = Again {
                            passes: found.as_ref().is_some_and(|f| f.passes),
                            ..Again::never()
                        };
                        let code = found.map(|f| f.code).filter(|c| !c.is_empty());
                        let reason = code.as_deref().unwrap_or("stream-error");
                        return Err(self.broke(decoder, message, kind, again, reason));
                    }
                }
            }
            if end || decoder.ended() {
                break;
            }
        }
        if !decoder.complete() {
            let message = format!(
                "The connection to {} closed before the answer was complete",
                self.name
            );
            let again = Again {
                passes: true,
                stale: true,
                ..Again::never()
            };
            return Err(self.broke(decoder, message, FailKind::Connection, again, "cut"));
        }
        Ok(decoder.reply(false))
    }
}

impl Model for HttpModel {
    fn take_notice(&self) -> Option<String> {
        let mut notices = self.notices.lock().ok()?;
        (!notices.is_empty()).then(|| notices.drain(..).collect::<Vec<_>>().join(" "))
    }

    fn take_notices(&self) -> Vec<Notice> {
        let mut out: Vec<Notice> = self
            .take_notice()
            .map(|text| Notice { code: None, text })
            .into_iter()
            .collect();
        if let Ok(mut retries) = self.retries.lock() {
            out.extend(retries.drain(..).map(|text| Notice {
                code: Some(RETRY.to_owned()),
                text,
            }));
        }
        out
    }

    async fn reply(
        &self,
        call: &Call<'_>,
        text: &(dyn Fn(&str) + Sync),
        cancel: &AtomicBool,
    ) -> Result<Reply, Failure> {
        let mut run = Run::start(self);
        loop {
            run.begin_attempt();
            let trial = match self.attempt(call, text, cancel, &mut run).await {
                Ok(reply) => {
                    self.record(&run, Ok(&reply));
                    return Ok(reply);
                }
                Err(trial) => trial,
            };
            let Some(wait) = self.wait_before_next(&mut run, &trial) else {
                self.record(&run, Err(&trial));
                return Err(trial.into_failure(run.attempts));
            };
            // The window learns of it before the wait, so it can say so.
            self.tell_retry(trial.notice(run.attempts + 1, self.policy.attempts));
            if trial.again.stale {
                run.rebuild(self);
            }
            if retry::pause(wait, cancel).await {
                let stopped = Decoder::of(self.kind).reply(true);
                self.record(&run, Ok(&stopped));
                return Ok(stopped);
            }
        }
    }
}
