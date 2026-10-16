//! Text the person attached to a message (pasted text, a file read as text)
//! as one more part of the context block: `<attachment name="…">…</attachment>`,
//! fenced like the rest, so what the file says can close no tag and speak as
//! the person. The block's 60,000-character budget applies to it too, and a
//! cut says how many characters were left out.

use super::{Part, attr, quoted};

/// An attached text, as the model is given it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextAttachment {
    pub name: String,
    pub text: String,
}

/// The attachment as a part of the context block.
pub fn part(attached: &TextAttachment) -> Part {
    Part {
        name: format!("attachment {}", quoted(&attached.name)),
        open: format!("<attachment name=\"{}\">", attr(&attached.name)),
        body: attached.text.clone(),
        close: "</attachment>".to_owned(),
    }
}

/// Whether a part is an attachment (its cut is counted in characters).
pub(super) fn is_attachment(part: &Part) -> bool {
    part.open.starts_with("<attachment ")
}
