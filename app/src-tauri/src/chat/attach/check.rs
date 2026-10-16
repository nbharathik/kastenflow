//! What an attachment must be to be kept: a picture of a kind, size and shape
//! a provider takes, or text that reads, cut to its cap. Each check answers in
//! a sentence naming the file.

use serde::{Deserialize, Serialize};

use super::sniff;
use super::{MAX_IMAGE, MAX_SIDE, MAX_TEXT_CHARS};
use crate::chat::AttachKind;

/// What is kept beside the bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct Meta {
    pub kind: AttachKind,
    pub mime: String,
    pub bytes: u64,
    pub chars: Option<usize>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// A name for the person to read: no folders, not empty, not long.
pub(super) fn clean(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).trim();
    let base: String = base.chars().filter(|c| !c.is_control()).take(200).collect();
    if base.is_empty() {
        "attachment".to_owned()
    } else {
        base
    }
}

pub(super) fn megabytes(bytes: usize) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

/// Whether `id` is what `put` makes: a SHA-256 in lower-case hex.
pub(super) fn is_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A picture checked and ready: its bytes, and what is known of it.
pub(super) fn picture(name: &str, bytes: &[u8]) -> Result<(Vec<u8>, Meta), String> {
    let Some(seen) = sniff::picture(bytes) else {
        return Err(if sniff::looks_like_svg(bytes) {
            format!(
                "“{name}” is an SVG, which is text rather than a picture the model can see; attach it as text"
            )
        } else {
            format!("“{name}” is not a PNG, JPEG, GIF or WebP picture")
        });
    };
    if bytes.len() > MAX_IMAGE {
        return Err(format!(
            "The picture “{name}” is {}; the most is {}. Make it smaller first",
            megabytes(bytes.len()),
            megabytes(MAX_IMAGE)
        ));
    }
    if let Some((w, h)) = seen.size
        && (w > MAX_SIDE || h > MAX_SIDE)
    {
        return Err(format!(
            "The picture “{name}” is {w} by {h} pixels; the most is {MAX_SIDE} on a side. Make it smaller first"
        ));
    }
    let meta = Meta {
        kind: AttachKind::Image,
        mime: seen.mime.to_owned(),
        bytes: bytes.len() as u64,
        chars: None,
        width: seen.size.map(|s| s.0),
        height: seen.size.map(|s| s.1),
    };
    Ok((bytes.to_vec(), meta))
}

/// Text checked and cut to its cap, with a marker saying how much went.
pub(super) fn text(name: &str, bytes: &[u8]) -> Result<(Vec<u8>, Meta), String> {
    if sniff::picture(bytes).is_some() {
        return Err(format!("“{name}” is a picture; attach it as a picture"));
    }
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let unreadable = || format!("“{name}” is not text KastenFlow can read (it must be UTF-8 text)");
    if bytes.contains(&0) {
        return Err(unreadable());
    }
    let whole = String::from_utf8(bytes.to_vec()).map_err(|_| unreadable())?;
    let total = whole.chars().count();
    let stored = if total > MAX_TEXT_CHARS {
        let kept = crate::chat::context::cut(&whole, MAX_TEXT_CHARS);
        let left = total - kept.chars().count();
        format!(
            "{kept}\n[Cut: the attachment had {total} characters; the last {left} are left out.]"
        )
    } else {
        whole
    };
    let meta = Meta {
        kind: AttachKind::Text,
        mime: "text/plain; charset=utf-8".to_owned(),
        bytes: stored.len() as u64,
        chars: Some(stored.chars().count()),
        width: None,
        height: None,
    };
    Ok((stored.into_bytes(), meta))
}
