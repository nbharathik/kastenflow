//! Keeping the links to a diagram where they went when its file is renamed
//! or moved: `![[Name.drawio]]` and `[[folder/Name.drawio|alias]]` in pages
//! name the file, not the person's title, so a page would show nothing
//! after the file's name changed. Only the target is rewritten; the heading
//! and the alias after it, and every other byte of the page, stay.

use std::fs;

use crate::atomic::write_atomic;
use crate::error::Result;
use crate::frontmatter::{join, split};
use crate::links::scan::link_spans;
use crate::ops::eol_of;
use crate::vault::Vault;

fn name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// `body` with each link to `old` naming `new` instead, or None when no
/// link did. A link by path always follows; one by file name alone does
/// only when `bare_follows`: when another diagram has the same file name,
/// it was not clear which one the link meant, and it is left as written.
pub(crate) fn retarget(body: &str, old: &str, new: &str, bare_follows: bool) -> Option<String> {
    let (old_name, new_name) = (name_of(old), name_of(new));
    let mut out = String::with_capacity(body.len() + 16);
    let mut last = 0;
    for span in link_spans(body) {
        let inner = &body[span.clone()];
        let cut = inner.find(['|', '#']).unwrap_or(inner.len());
        let raw = &inner[..cut];
        let target = raw.trim();
        let replacement = if target == old {
            new
        } else if bare_follows && target.eq_ignore_ascii_case(old_name) {
            new_name
        } else {
            continue;
        };
        let lead = &raw[..raw.len() - raw.trim_start().len()];
        let trail = &raw[raw.trim_end().len()..];
        out.push_str(&body[last..span.start]);
        out.push_str(lead);
        out.push_str(replacement);
        out.push_str(trail);
        last = span.start + cut;
    }
    if last == 0 {
        return None;
    }
    out.push_str(&body[last..]);
    Some(out)
}

/// Rewrites the links in every page that named the diagram at `old`, which
/// is now at `new`. Returns the pages written.
pub(crate) fn relink_pages(
    vault: &Vault,
    old: &str,
    new: &str,
    bare_follows: bool,
) -> Result<Vec<String>> {
    let needle = name_of(old).to_ascii_lowercase();
    let mut written = Vec::new();
    for note in vault.files(".md")? {
        let Ok(file) = vault.path_of(&note.path) else {
            continue;
        };
        let Ok(text) = fs::read_to_string(&file) else {
            continue;
        };
        if !text.to_ascii_lowercase().contains(&needle) {
            continue;
        }
        let parts = split(&text);
        let Some(body) = retarget(parts.body, old, new, bare_follows) else {
            continue;
        };
        write_atomic(&file, join(parts.prefix, &body, eol_of(&text)).as_bytes())?;
        written.push(note.path);
    }
    Ok(written)
}
