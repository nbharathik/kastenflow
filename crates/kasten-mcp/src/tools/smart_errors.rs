//! The errors a smart page reported while it was open in the app, as
//! `smart_read` tells them: read from the app's log in the vault's cache,
//! safely (a plain file of a sensible size, anything else is no log) and cut
//! to a size a model can read.

use kasten_core::smart::{ErrorLog, MAX_ERROR_RECORDS};
use kasten_core::{Kasten, NoteFile};
use serde_json::Value;

/// How much of the page's reported errors one `smart_read` carries.
const BUDGET: usize = 16_000;
/// The longest text of one error.
const LONGEST: usize = 600;
/// A log bigger than this is not read.
const LOG_BYTES: u64 = 1024 * 1024;

/// The page's last reported errors, newest last. None yet, or a log that does
/// not read, is an empty list.
pub(super) fn recent(k: &Kasten, note: &NoteFile) -> Vec<Value> {
    let Some(id) =
        note.meta.id.as_deref().filter(|id| {
            !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
    else {
        return Vec::new();
    };
    let file = k
        .root()
        .join(".kasten/cache/smart")
        .join(format!("{id}.log.json"));
    // A plain file of a sensible size; a link, a folder or a huge file is no log.
    let log: ErrorLog = std::fs::symlink_metadata(&file)
        .ok()
        .filter(|meta| meta.is_file() && meta.len() <= LOG_BYTES)
        .and_then(|_| std::fs::read_to_string(&file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let skip = log.records.len().saturating_sub(MAX_ERROR_RECORDS);
    // The newest errors that fit: a page can make its messages as long as it likes.
    let mut left = BUDGET;
    let mut out: Vec<Value> = Vec::new();
    for record in log.records.iter().skip(skip).rev() {
        let Ok(mut value) = serde_json::to_value(record) else {
            continue;
        };
        cut_strings(&mut value, LONGEST);
        let size = value.to_string().len();
        if size > left {
            break;
        }
        left -= size;
        out.push(value);
    }
    out.reverse();
    out
}

/// Every text inside `value` cut to `max` characters.
fn cut_strings(value: &mut Value, max: usize) {
    match value {
        Value::String(text) if text.chars().count() > max => {
            let cut: String = text.chars().take(max).collect();
            *text = format!("{cut}…");
        }
        Value::Array(items) => items.iter_mut().for_each(|v| cut_strings(v, max)),
        Value::Object(map) => map.values_mut().for_each(|v| cut_strings(v, max)),
        _ => {}
    }
}
