//! The work of a turn: what a started turn does from its first message to its
//! last event. `send.rs` decides whether a message starts one; this runs it.

use std::sync::Arc;
use std::time::Duration;

use kasten_core::{Instant, Kasten};

use super::queue::Linked;
use super::send::{Profile, Work, compose};
use super::{Begun, Chats, Settled, repair};
use crate::chat::attach::Resolved;
use crate::chat::event::{ChatEvent, EventKind, Events};
use crate::chat::model::{Message, Model};
use crate::chat::plan;
use crate::chat::prompt;
use crate::chat::turn::{self, Ending, Turn};
use crate::chat::{ChatRequest, ChatTurn, WriteMode};

pub(super) fn queued_event(
    events: &dyn Events,
    chat: &str,
    turn: &str,
    text: &str,
    delivered: bool,
) {
    let mut event = ChatEvent::new(chat, turn, EventKind::Queued);
    event.text = Some(text.to_owned());
    event.delivered = Some(delivered);
    events.emit(event);
}

/// Ends a turn that was dropped half way (a panic, the app closing): the
/// thread is free again and the window hears why.
struct Guard {
    chats: Chats,
    events: Arc<dyn Events>,
    chat: String,
    turn: String,
    armed: bool,
}

impl Drop for Guard {
    fn drop(&mut self) {
        if self.armed {
            self.chats.abort(&self.chat, &self.turn);
            let mut event = ChatEvent::new(&self.chat, &self.turn, EventKind::Error);
            event.error = Some("The chat stopped unexpectedly".to_owned());
            self.events.emit(event);
        }
    }
}

/// A new message.
pub(super) struct Sending {
    pub request: ChatRequest,
    pub attached: Resolved,
    /// Its message, when it is already composed.
    pub ready: Option<Message>,
}

/// What a turn starts from.
pub(super) enum Mode {
    Send(Box<Sending>),
    /// The next step of a thread that stopped.
    Resume,
}

/// Everything a turn is started with.
pub(super) struct Launch<M> {
    pub chats: Chats,
    pub kasten: Arc<Kasten>,
    pub events: Arc<dyn Events>,
    pub model: M,
    pub profile: Profile,
    pub chat: String,
    pub today: String,
    pub writes: WriteMode,
    pub mode: Mode,
}

/// Whether the chat's writes wait as staged changes for the person to apply.
/// The agent mode decides (`chat_writes_staged`): always on review, never on
/// autonomous, and in between the thread's own "Apply directly". A turn may
/// write anywhere, so a project whose mode holds changes back holds the
/// whole chat's.
pub(crate) fn stages_writes(kasten: &Kasten, writes: WriteMode) -> bool {
    let direct = writes == WriteMode::Direct;
    let now = Instant::now();
    let projects: Vec<String> = kasten
        .config()
        .agents
        .map(|agents| agents.projects.into_keys().collect())
        .unwrap_or_default();
    std::iter::once(None)
        .chain(projects.iter().map(|project| Some(project.as_str())))
        .any(|project| kasten.chat_writes_staged(project, direct, now))
}

pub(super) fn launch<M: Model + 'static>(job: Launch<M>) -> Result<(ChatTurn, Work), String> {
    let Launch {
        chats,
        kasten,
        events,
        model,
        profile,
        chat,
        today,
        writes,
        mode,
    } = job;
    let begun: Begun = chats.begin_on(&chat, Instant::now(), &today, prompt::system)?;
    match &mode {
        Mode::Send(sending) => {
            let request = &sending.request;
            let ids: Vec<String> = request.attachments.iter().map(|a| a.id.clone()).collect();
            chats.started(&chat, request, &ids);
        }
        Mode::Resume => chats.persist(&chat),
    }
    let answer = ChatTurn {
        chat: chat.clone(),
        session: begun.session.id.clone(),
        turn: begun.turn.clone(),
        queued: false,
    };
    // Made before the work is first run, so dropping it unrun frees the thread too.
    let guard = Guard {
        chats: chats.clone(),
        events: Arc::clone(&events),
        chat: chat.clone(),
        turn: begun.turn.clone(),
        armed: true,
    };
    let work = async move {
        // The whole guard, not just the field set below, lives in the work.
        let mut guard = guard;
        // As many chats work at once as the person allows; the rest wait here, and say so.
        let Some(_place) = chats
            .take_place(events.as_ref(), &chat, &begun.turn, &begun.cancel)
            .await
        else {
            // Stopped while it waited: nothing ran, so the message can be sent again.
            let _ = chats.settle(&chat, &begun.turn, None, &Ending::Done { stopped: true });
            guard.armed = false;
            let mut event = ChatEvent::new(&chat, &begun.turn, EventKind::Done);
            event.stopped = Some(true);
            events.emit(event);
            chats.persist(&chat);
            return;
        };
        let mut messages = begun.messages;
        let mut plan = begun.plan;
        repair(&mut messages);
        let before = messages.len();
        let fresh = matches!(mode, Mode::Send(_));
        match mode {
            Mode::Send(sending) => {
                let Sending {
                    request,
                    attached,
                    ready,
                } = *sending;
                let message = match ready {
                    Some(message) => message,
                    None => {
                        let (reader, session) = (Arc::clone(&kasten), begun.session.clone());
                        tokio::task::spawn_blocking(move || {
                            compose(&reader, &session, &request, &attached)
                        })
                        .await
                        .unwrap_or_else(|err| {
                            Message::User(format!(
                                "(The attached context could not be read: {err})"
                            ))
                        })
                    }
                };
                messages.push(message);
            }
            Mode::Resume => {
                if matches!(messages.last(), Some(Message::Assistant(_)) | None) {
                    messages.push(Message::User(turn::RESUME.to_owned()));
                }
            }
        }
        let mut tools = kasten_mcp::tools::specs();
        tools.push(plan::spec());
        let link = Linked {
            chats: chats.clone(),
            chat: chat.clone(),
            turn: begun.turn.clone(),
        };
        let turn = Turn {
            kasten: &kasten,
            session: &begun.session,
            system: &begun.system,
            tools: &tools,
            events: events.as_ref(),
            chat: &chat,
            turn: &begun.turn,
            cancel: &begun.cancel,
            changes: stages_writes(&kasten, writes).then_some(&begun.changes),
            link: &link,
            budgets: chats.budgets(),
            window: profile.window,
            spent: Duration::ZERO,
        };
        let ending = loop {
            let ending = turn.run(&model, &mut messages, &mut plan).await;
            // A turn that got no answer leaves no trace, so the message can be
            // sent again.
            if fresh && messages.len() == before + 1 {
                messages.truncate(before);
            }
            let kept = Some((&begun.session, messages.clone(), plan.clone()));
            match chats.settle(&chat, &begun.turn, kept, &ending) {
                Settled::Over => break ending,
                Settled::More(waiting) => {
                    for queued in waiting {
                        queued_event(events.as_ref(), &chat, &begun.turn, &queued.text, true);
                        messages.push(queued.message);
                    }
                }
            }
        };
        guard.armed = false;
        let mut event = ChatEvent::new(&chat, &begun.turn, EventKind::Done);
        match ending {
            Ending::Done { stopped } => event.stopped = Some(stopped),
            Ending::Error { message, kind } => {
                event.kind = EventKind::Error;
                event.error = Some(message);
                event.error_kind = Some(kind);
            }
            Ending::Paused { reason, detail } => {
                event.kind = EventKind::Paused;
                event.reason = Some(reason);
                event.detail = Some(detail);
            }
        }
        events.emit(event);
        // Saved again, so the number of the last event is in the file.
        chats.persist(&chat);
    };
    Ok((answer, Box::pin(work)))
}
