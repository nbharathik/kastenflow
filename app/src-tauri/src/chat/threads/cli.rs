//! A turn answered by an agent CLI (chat/cli) instead of a model the app asks:
//! the thread, its session and its stop flag are the chat's own, the CLI
//! does the work in a child process, and what it does arrives as the same
//! events. The CLI keeps its own conversation; this keeps the thread's
//! messages (the person's words and the answer's text) so the thread is
//! saved, listed and searched like any other.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use kasten_core::{Instant, Kasten};
use serde_json::Value;

use super::launch::queued_event;
use super::send::{Work, compose};
use super::{Chats, Settled, day, repair};
use crate::chat::attach::Resolved;
use crate::chat::cli::drive::{Drive, Limits, Outcome, drive};
use crate::chat::cli::process::{Process, Spec};
use crate::chat::cli::resolve::Found;
use crate::chat::cli::{Agent, Hub, args, claude, env, mcp};
use crate::chat::context::TextAttachment;
use crate::chat::event::{ChatEvent, EventKind, Events};
use crate::chat::model::{Message, Reply, Stop};
use crate::chat::prompt;
use crate::chat::summary;
use crate::chat::turn::Ending;
use crate::chat::{ChatRequest, ChatTurn};

/// What a CLI turn needs besides the thread.
#[derive(Clone)]
pub struct Setup {
    pub agent: Agent,
    pub program: Found,
    /// This program, which the CLI starts as KastenFlow's MCP server.
    pub exe: PathBuf,
    /// The app's cache folder for the agents' settings (never the vault).
    pub cache: PathBuf,
    pub hub: Arc<Hub>,
    pub limits: Limits,
}

/// Ends a turn dropped half way, as a model's turn is.
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

struct Job {
    setup: Setup,
    kasten: Arc<Kasten>,
    events: Arc<dyn Events>,
    chat: String,
    turn: String,
    cancel: Arc<AtomicBool>,
    text: String,
}

fn failed(message: String) -> Outcome {
    Outcome {
        text: String::new(),
        session: None,
        ending: Ending::Error {
            message,
            kind: crate::chat::errors::FailKind::Other,
        },
    }
}

/// Starts the CLI for one message and drives it to its end. Blocks.
fn run_blocking(job: Job) -> Outcome {
    let Job {
        setup,
        kasten,
        events,
        chat,
        turn,
        cancel,
        text,
    } = job;
    let agent = setup.agent;
    let root = kasten.root().to_path_buf();
    let server = mcp::server_for(&setup.exe, &root);
    let session = setup.hub.sessions.get(&chat, agent);
    let (args, start, extra) = match agent {
        Agent::ClaudeCode => {
            let config = match mcp::write_claude_config(&setup.cache, &root, &chat, &server) {
                Ok(path) => path,
                Err(err) => return failed(err),
            };
            (
                args::claude_args(&mcp::plain(&config), session.as_deref()),
                vec![claude::initialize_line(), claude::user_line(&text)],
                Vec::new(),
            )
        }
        Agent::OpenCode => (
            args::opencode_args(session.as_deref()),
            vec![text.replace("\r\n", "\n")],
            args::opencode_env(&server),
        ),
    };
    let spec = Spec {
        program: setup.program.path.clone(),
        args,
        cwd: root,
        env: env::scrubbed(std::env::vars_os(), &extra),
    };
    let mut process = match Process::start(&spec) {
        Ok(process) => process,
        Err(err) => return failed(format!("{} could not be started: {err}", agent.label())),
    };
    let describe = |name: &str, input: &Value, result: &Result<Value, String>| {
        Some(summary::describe(&kasten, name, input, result))
    };
    let outcome = drive(
        &mut process,
        &start,
        &Drive {
            agent,
            events: events.as_ref(),
            chat: &chat,
            turn: &turn,
            cancel: &cancel,
            approvals: &setup.hub.approvals,
            limits: setup.limits,
            describe: &describe,
        },
    );
    if let Some(id) = &outcome.session {
        setup.hub.sessions.set(&chat, agent, id);
    }
    outcome
}

/// The words the CLI is sent for a message: the person's, with the context
/// they attached before them.
fn words(message: &Message) -> String {
    message.user_text().unwrap_or_default().to_owned()
}

/// Starts a turn of `request` answered by the CLI `setup` names; its ids at
/// once, and the work for the caller to spawn. A thread that is working takes
/// the message as a queued one, and the turn goes on with it when it ends.
pub fn send_cli(
    chats: &Chats,
    kasten: Arc<Kasten>,
    events: Arc<dyn Events>,
    request: ChatRequest,
    setup: Setup,
) -> Result<(ChatTurn, Work), String> {
    let chat = request.chat.trim().to_owned();
    if chat.is_empty() {
        return Err("A chat needs an id".to_owned());
    }
    if request.text.trim().is_empty()
        && request.context.is_empty()
        && request.attachments.is_empty()
    {
        return Err("There is nothing to send".to_owned());
    }
    if request.attachments.len() > super::send::MAX_ATTACHMENTS {
        return Err(format!(
            "A message carries at most {} attachments",
            super::send::MAX_ATTACHMENTS
        ));
    }
    if !kasten.has_history() {
        return Err("This vault keeps no history, so the chat's changes could not be undone. Turn on history in Settings first.".to_owned());
    }
    // Text the person attached goes with the message; pictures are not sent to the CLI.
    let attached = match chats.files() {
        Some(files) => {
            let mut resolved = files.resolve(&request.attachments);
            resolved.images.clear();
            resolved
        }
        None => Resolved {
            texts: request
                .attachments
                .iter()
                .map(|a| TextAttachment {
                    name: a.name.clone(),
                    text: "(This attachment could not be read: attachments are not available.)"
                        .to_owned(),
                })
                .collect(),
            images: Vec::new(),
        },
    };
    chats.ensure_loaded(&chat, &kasten);
    let events = chats.feed(&chat, events);
    let today = day(request.date.as_deref());
    let mut ready = None;
    if chats.running(&chat)
        && let Some(session) = chats.session_of(&chat)
    {
        let message = compose(&kasten, &session, &request, &attached);
        let queued = super::Queued {
            text: request.text.clone(),
            message,
        };
        match chats.enqueue(&chat, queued) {
            Ok(waiting) => {
                let ids: Vec<String> = request.attachments.iter().map(|a| a.id.clone()).collect();
                chats.refer_to(&chat, &ids);
                queued_event(events.as_ref(), &chat, &waiting.turn, &request.text, false);
                let answer = ChatTurn {
                    chat,
                    session: waiting.session,
                    turn: waiting.turn,
                    queued: true,
                };
                return Ok((answer, Box::pin(async {})));
            }
            Err(queued) => ready = Some(queued.message),
        }
    }
    let begun = chats.begin_on(&chat, Instant::now(), &today, prompt::system)?;
    let ids: Vec<String> = request.attachments.iter().map(|a| a.id.clone()).collect();
    chats.started(&chat, &request, &ids);
    let answer = ChatTurn {
        chat: chat.clone(),
        session: begun.session.id.clone(),
        turn: begun.turn.clone(),
        queued: false,
    };
    let guard = Guard {
        chats: chats.clone(),
        events: Arc::clone(&events),
        chat: chat.clone(),
        turn: begun.turn.clone(),
        armed: true,
    };
    let chats = chats.clone();
    let work = async move {
        let mut guard = guard;
        let Some(_place) = chats
            .take_place(events.as_ref(), &chat, &begun.turn, &begun.cancel)
            .await
        else {
            let _ = chats.settle(&chat, &begun.turn, None, &Ending::Done { stopped: true });
            guard.armed = false;
            let mut event = ChatEvent::new(&chat, &begun.turn, EventKind::Done);
            event.stopped = Some(true);
            events.emit(event);
            chats.persist(&chat);
            return;
        };
        let mut messages = begun.messages;
        repair(&mut messages);
        let before = messages.len();
        let message = match ready {
            Some(message) => message,
            None => {
                let (reader, session) = (Arc::clone(&kasten), begun.session.clone());
                tokio::task::spawn_blocking(move || compose(&reader, &session, &request, &attached))
                    .await
                    .unwrap_or_else(|err| {
                        Message::User(format!("(The attached context could not be read: {err})"))
                    })
            }
        };
        let mut text = words(&message);
        messages.push(message);
        let ending = loop {
            let job = Job {
                setup: setup.clone(),
                kasten: Arc::clone(&kasten),
                events: Arc::clone(&events),
                chat: chat.clone(),
                turn: begun.turn.clone(),
                cancel: Arc::clone(&begun.cancel),
                text: text.clone(),
            };
            let outcome = tokio::task::spawn_blocking(move || run_blocking(job))
                .await
                .unwrap_or_else(|err| failed(format!("The agent stopped unexpectedly: {err}")));
            let answered = !outcome.text.trim().is_empty();
            if answered {
                messages.push(Message::Assistant(Reply {
                    text: outcome.text.clone(),
                    calls: Vec::new(),
                    stop: Stop::End,
                    blocks: None,
                    items: None,
                }));
            } else if matches!(outcome.ending, Ending::Error { .. }) && messages.len() == before + 1
            {
                // Nothing came back: the message leaves no trace, so it can be sent again.
                messages.truncate(before);
            }
            let kept = Some((&begun.session, messages.clone(), begun.plan.clone()));
            match chats.settle(&chat, &begun.turn, kept, &outcome.ending) {
                Settled::Over => break outcome.ending,
                Settled::More(waiting) => {
                    let mut said = Vec::new();
                    for queued in waiting {
                        queued_event(events.as_ref(), &chat, &begun.turn, &queued.text, true);
                        said.push(words(&queued.message));
                        messages.push(queued.message);
                    }
                    text = said.join("\n\n");
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
        chats.persist(&chat);
    };
    Ok((answer, Box::pin(work)))
}
