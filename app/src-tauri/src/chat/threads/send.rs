//! Starting turns: a new message (`send`, which queues instead when the
//! thread is working) or the next step of a paused or interrupted thread
//! (`resume_with`). The ids come back at once; the work that answers is a
//! future for the caller to spawn, and what it does arrives as events.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use kasten_core::Kasten;
use kasten_core::agent::Session;

use super::launch::{Launch, Mode, Sending, launch, queued_event};
use super::{Chats, Queued, day};
use crate::chat::attach::{MAX_PICTURE_BYTES, MAX_PICTURES, Resolved};
use crate::chat::capabilities::{DEFAULT_WINDOW, ModelCapabilities};
use crate::chat::context::{self, TextAttachment};
use crate::chat::event::Events;
use crate::chat::model::{Image, Message, Model};
use crate::chat::{ChatRequest, ChatTurn};

/// The most attachments one message carries.
pub const MAX_ATTACHMENTS: usize = 10;

/// Work to spawn: it answers the message, and then the thread is free.
pub type Work = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

/// What the chosen model is known to take: how much it reads at once, and
/// whether it reads pictures.
#[derive(Debug, Clone)]
pub struct Profile {
    /// Tokens.
    pub window: usize,
    pub vision: bool,
    /// Whether `vision` is known (false for a local server's model).
    pub vision_known: bool,
    /// The model's name, for the words that name it.
    pub model: String,
}

impl Default for Profile {
    /// A model nothing is known about, taken to read anything: for tests and
    /// callers that do not look.
    fn default() -> Profile {
        Profile {
            window: DEFAULT_WINDOW as usize,
            vision: true,
            vision_known: true,
            model: String::new(),
        }
    }
}

impl Profile {
    /// What the capability table says about a model.
    pub fn of(caps: &ModelCapabilities) -> Profile {
        Profile {
            window: caps.context_window as usize,
            vision: caps.vision,
            vision_known: caps.vision_known,
            model: caps.model.clone(),
        }
    }
}

/// The person's words with their chips and attached text before them, and
/// their pictures with them. Reads the vault: not for an async thread.
pub(super) fn compose(
    kasten: &Kasten,
    session: &Session,
    request: &ChatRequest,
    attached: &Resolved,
) -> Message {
    let text = context::message_with(
        kasten,
        session,
        &request.context,
        &request.excerpts,
        &attached.texts,
        &request.text,
    );
    if attached.images.is_empty() {
        Message::User(text)
    } else {
        Message::UserImages {
            text,
            images: attached.images.clone(),
        }
    }
}

/// Whether the model may be sent these pictures, or the sentence that says why not.
fn may_send(profile: &Profile, request: &ChatRequest, images: &[Image]) -> Result<(), String> {
    if images.is_empty() {
        return Ok(());
    }
    if images.len() > MAX_PICTURES {
        return Err(format!(
            "A message carries at most {MAX_PICTURES} pictures; {} were attached",
            images.len()
        ));
    }
    let bytes: usize = images.iter().map(|i| i.data.len() / 4 * 3).sum();
    if bytes > MAX_PICTURE_BYTES {
        return Err(format!(
            "The pictures come to {} MB; a message carries at most {} MB of them",
            bytes / 1024 / 1024,
            MAX_PICTURE_BYTES / 1024 / 1024
        ));
    }
    // The person may try a model nobody knows about; a model known not to
    // read pictures is never sent any.
    let allowed = request.settings.as_ref().and_then(|s| s.allow_images) == Some(true);
    if profile.vision || (allowed && !profile.vision_known) {
        return Ok(());
    }
    let name = if profile.model.is_empty() {
        "This model"
    } else {
        &profile.model
    };
    Err(if profile.vision_known {
        format!(
            "{name} does not read pictures. Choose a model that does, or send the message without them."
        )
    } else {
        format!(
            "{name} may not read pictures. Choose a model that does, or allow pictures for this chat to try anyway."
        )
    })
}

/// Starts a turn of `request` with `model`: its ids at once, and the work
/// that answers it as events, for the caller to spawn. A thread that is
/// working takes the message as a queued one instead (`queued` in the ids).
#[cfg(test)]
pub fn send<M: Model + 'static>(
    chats: &Chats,
    kasten: Arc<Kasten>,
    events: Arc<dyn Events>,
    model: M,
    request: ChatRequest,
) -> Result<(ChatTurn, Work), String> {
    send_with(chats, kasten, events, model, request, Profile::default())
}

/// `send`, for a model whose window and reading of pictures are known.
pub fn send_with<M: Model + 'static>(
    chats: &Chats,
    kasten: Arc<Kasten>,
    events: Arc<dyn Events>,
    model: M,
    request: ChatRequest,
    profile: Profile,
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
    if request.attachments.len() > MAX_ATTACHMENTS {
        return Err(format!(
            "A message carries at most {MAX_ATTACHMENTS} attachments"
        ));
    }
    // As with MCP: without history, the chat's changes could not be undone.
    if !kasten.has_history() {
        return Err("This vault keeps no history, so the chat's changes could not be undone. Turn on history in Settings first.".to_owned());
    }
    let attached = match chats.files() {
        Some(files) => files.resolve(&request.attachments),
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
    may_send(&profile, &request, &attached.images)?;
    chats.ensure_loaded(&chat, &kasten);
    let events = chats.feed(&chat, events);
    let today = day(request.date.as_deref());
    let writes = request.writes;
    let mut ready = None;
    if chats.running(&chat)
        && let Some(session) = chats.session_of(&chat)
    {
        let message = compose(&kasten, &session, &request, &attached);
        let queued = Queued {
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
            // The turn ended a moment ago: this message starts the next.
            Err(queued) => ready = Some(queued.message),
        }
    }
    launch(Launch {
        chats: chats.clone(),
        kasten,
        events,
        model,
        profile,
        chat,
        today,
        writes,
        mode: Mode::Send(Box::new(Sending {
            request,
            attached,
            ready,
        })),
    })
}

/// Lets a paused, interrupted or failed thread go on from where it is, with a
/// fresh budget.
pub fn resume_with<M: Model + 'static>(
    chats: &Chats,
    kasten: Arc<Kasten>,
    events: Arc<dyn Events>,
    model: M,
    chat: &str,
    profile: Profile,
) -> Result<(ChatTurn, Work), String> {
    let Some(facts) = chats.resume_facts(chat, &kasten) else {
        return Err("There is no saved chat with that name".to_owned());
    };
    if chats.running(chat) {
        return Err("This chat is still answering; stop it first".to_owned());
    }
    if !facts.status.can_continue() || !facts.started {
        return Err("There is nothing to continue in this chat".to_owned());
    }
    if !kasten.has_history() {
        return Err("This vault keeps no history, so the chat's changes could not be undone. Turn on history in Settings first.".to_owned());
    }
    let events = chats.feed(chat, events);
    launch(Launch {
        chats: chats.clone(),
        kasten,
        events,
        model,
        profile,
        chat: chat.to_owned(),
        // The prompt keeps the day of the person's last message: this side
        // does not know their time zone.
        today: String::new(),
        writes: facts.writes,
        mode: Mode::Resume,
    })
}
