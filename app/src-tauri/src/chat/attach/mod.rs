//! What the person attaches to a message: long text, pasted text, files
//! turned into text, and pictures. The window sends the bytes once
//! (`chat_attach`) and the message carries only the id; the bytes wait in the
//! app's data folder, one file per content (named by its SHA-256, so the same
//! thing attached twice is kept once), under `chat-attachments/<vault hash>/`.
//! Not in the vault: an attachment is part of a conversation, not of the notes.
//!
//! Limits: 25 MB a file, and 200 MB a vault, past which a new one is refused
//! in words: nothing is ever removed to make room, and nothing is removed on
//! its own (an attachment goes only when the person removes its chip or deletes
//! the chat that was the last to use it). Text must be UTF-8 and is cut at 200,000 characters with a
//! marker saying how much was left out. A picture must be a PNG, JPEG, GIF or
//! WebP by its first bytes (never an SVG, which is text), at most 5 MB and
//! 8,000 pixels a side. This side has no image decoder, so it does not shrink
//! a picture: the window does that before it sends one.

mod check;
mod sniff;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};

use check::{Meta, clean, is_id, megabytes, picture, text};

use super::context::attachment::TextAttachment;
use super::model::Image;
use super::store::disk::{read_json, write_atomic};
use super::store::{hex, remove, vault_hash};
use super::{AttachKind, AttachmentRef};

pub const MAX_FILE: usize = 25 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 200 * 1024 * 1024;
pub const MAX_IMAGE: usize = 5 * 1024 * 1024;
pub const MAX_SIDE: u32 = 8000;
/// The most characters of an attached text the model is given.
pub const MAX_TEXT_CHARS: usize = 200_000;
/// The most pictures one message carries, and all of them together.
pub const MAX_PICTURES: usize = 5;
pub const MAX_PICTURE_BYTES: usize = 20 * 1024 * 1024;

/// What `chat_attach` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    /// The SHA-256 of the stored bytes, in hex.
    pub id: String,
    pub kind: AttachKind,
    pub name: String,
    pub mime: String,
    pub bytes: u64,
    /// For text: the characters kept.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chars: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

/// The attachments of one vault.
pub struct Attachments {
    dir: PathBuf,
    /// The most bytes they may take together.
    cap: u64,
}

/// What a message's attachments come to.
#[derive(Debug, Default)]
pub struct Resolved {
    /// Text for the context block (a missing attachment is a sentence here).
    pub texts: Vec<TextAttachment>,
    pub images: Vec<Image>,
}

impl Attachments {
    /// The attachments of the vault at `vault_root`, under the app's `data` folder.
    pub fn open(data: &Path, vault_root: &str) -> Attachments {
        Attachments {
            dir: data.join("chat-attachments").join(vault_hash(vault_root)),
            cap: MAX_TOTAL,
        }
    }

    /// The same, with a smaller cap, to test the cap without filling a disk.
    #[cfg(test)]
    pub(crate) fn capped(mut self, cap: u64) -> Attachments {
        self.cap = cap;
        self
    }

    fn data_path(&self, id: &str) -> PathBuf {
        self.dir.join(id)
    }

    fn meta_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    /// The ids and sizes of the stored bytes.
    fn stored(&self) -> Vec<(String, u64)> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                let meta = entry.metadata().ok()?;
                (is_id(&name) && meta.is_file()).then_some((name, meta.len()))
            })
            .collect()
    }

    /// The bytes the attachments of this vault take. Only a report, and the
    /// measure a new attachment is refused by.
    pub fn total(&self) -> u64 {
        self.stored().iter().map(|(_, bytes)| bytes).sum()
    }

    fn remove(&self, id: &str) -> bool {
        let gone = remove::file(&self.dir, &self.data_path(id));
        remove::file(&self.dir, &self.meta_path(id));
        gone
    }

    /// Whether `add` more bytes fit. If not, the sentence that says so;
    /// nothing is removed to make room.
    fn check_room(&self, add: u64) -> Result<(), String> {
        let total = self.total();
        if total + add > self.cap {
            return Err(format!(
                "The attachments of chats in this vault take {} of the {} they may. Delete old chats to make room",
                megabytes(total as usize),
                megabytes(self.cap as usize)
            ));
        }
        Ok(())
    }

    /// Keeps `bytes` as an attachment of the kind the window says it is,
    /// after checking it is.
    pub fn put(
        &self,
        name: &str,
        declared: AttachKind,
        bytes: &[u8],
    ) -> Result<AttachmentInfo, String> {
        let name = clean(name);
        if bytes.is_empty() {
            return Err(format!("“{name}” is empty"));
        }
        if bytes.len() > MAX_FILE {
            return Err(format!(
                "“{name}” is {}; the most is {}",
                megabytes(bytes.len()),
                megabytes(MAX_FILE)
            ));
        }
        let (stored, meta) = match declared {
            AttachKind::Image => picture(&name, bytes)?,
            AttachKind::Text => text(&name, bytes)?,
        };
        let id = hex(&Sha256::digest(&stored));
        let path = self.data_path(&id);
        if !path.exists() {
            self.check_room(stored.len() as u64)?;
            write_atomic(&path, &stored).map_err(|e| format!("“{name}” could not be kept: {e}"))?;
        }
        if !self.meta_path(&id).exists() {
            let json = serde_json::to_vec(&meta).map_err(|e| e.to_string())?;
            write_atomic(&self.meta_path(&id), &json)
                .map_err(|e| format!("“{name}” could not be kept: {e}"))?;
        }
        Ok(AttachmentInfo {
            id,
            kind: meta.kind,
            name,
            mime: meta.mime,
            bytes: meta.bytes,
            chars: meta.chars,
            width: meta.width,
            height: meta.height,
        })
    }

    /// The stored bytes of attachment `id`.
    pub fn bytes(&self, id: &str) -> Result<Vec<u8>, String> {
        if !is_id(id) {
            return Err("That is not an attachment".to_owned());
        }
        fs::read(self.data_path(id)).map_err(|_| "That attachment is no longer stored".to_owned())
    }

    fn meta(&self, id: &str) -> Option<Meta> {
        read_json::<Meta>(&self.meta_path(id)).ok()
    }

    /// Forgets attachment `id` unless a saved chat refers to it. Only the
    /// person's own doing calls this: removing a chip they added, or deleting
    /// the chat that was the last to use it.
    pub fn drop_unused(&self, id: &str, referenced: &HashSet<String>) -> bool {
        is_id(id) && !referenced.contains(id) && self.remove(id)
    }

    /// The text and pictures a message's attachments stand for. One that can
    /// no longer be read is a sentence in the text, never a silent gap.
    pub fn resolve(&self, refs: &[AttachmentRef]) -> Resolved {
        let mut out = Resolved::default();
        let mut seen = HashSet::new();
        for item in refs.iter().filter(|r| seen.insert(r.id.clone())) {
            let gone = |why: &str| TextAttachment {
                name: item.name.clone(),
                text: format!(
                    "(This attachment could not be read: {why}. Ask the person to attach it again.)"
                ),
            };
            let kind = self.meta(&item.id).map_or(item.kind, |m| m.kind);
            match (kind, self.bytes(&item.id)) {
                (_, Err(_)) => out.texts.push(gone("it is no longer stored")),
                (AttachKind::Text, Ok(bytes)) => match String::from_utf8(bytes) {
                    Ok(text) => out.texts.push(TextAttachment {
                        name: item.name.clone(),
                        text,
                    }),
                    Err(_) => out.texts.push(gone("it is not text")),
                },
                (AttachKind::Image, Ok(bytes)) => match sniff::picture(&bytes) {
                    Some(seen) => out.images.push(Image {
                        id: item.id.clone(),
                        name: item.name.clone(),
                        mime: seen.mime.to_owned(),
                        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
                    }),
                    None => out.texts.push(gone("it is not a picture")),
                },
            }
        }
        out
    }

    /// Gives back the bytes of the pictures in `messages` that a saved chat
    /// lost them from (the bytes are not saved with a thread).
    pub fn restore_pictures(&self, messages: &mut [super::model::Message]) {
        use super::model::Message;
        for message in messages {
            if let Message::UserImages { images, .. } = message {
                for image in images {
                    if image.data.is_empty()
                        && let Ok(bytes) = self.bytes(&image.id)
                    {
                        image.data = base64::engine::general_purpose::STANDARD.encode(bytes);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
