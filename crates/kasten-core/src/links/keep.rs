//! Keeping links where they went: after an op changes titles, paths or
//! projects, a link that went to one note is rewritten to go there still.

use std::collections::{HashMap, HashSet};
use std::fs;

use super::{Directory, Place, Resolution, scan, title_key};
use crate::error::Result;
use crate::frontmatter::{join, split};
use crate::note::NoteMeta;
use crate::ops::eol_of;
use crate::rollback::Rollback;
use crate::vault::Vault;

/// `body` with each link that went to one note before an op, and would go
/// elsewhere after it, naming that note again: by title when the title
/// finds it, by path otherwise. `moved` maps old paths to new ones;
/// `from_before` and `from_after` are where the linking note was and is.
/// Links that asked which note, or found none, stay as written. None when
/// nothing changed.
pub fn keep_links(
    body: &str,
    before: &Directory,
    after: &Directory,
    moved: &HashMap<String, String>,
    from_before: Place,
    from_after: Place,
) -> Option<String> {
    let mut out = String::with_capacity(body.len() + 32);
    let mut last = 0;
    for span in scan::link_spans(body) {
        let inner = &body[span.clone()];
        let Some(kept) = kept(inner, before, after, moved, from_before, from_after) else {
            continue;
        };
        out.push_str(&body[last..span.start]);
        out.push_str(&kept);
        last = span.end;
    }
    if last == 0 {
        return None;
    }
    out.push_str(&body[last..]);
    Some(out)
}

/// The link's new inner text, when it has to change.
fn kept(
    inner: &str,
    before: &Directory,
    after: &Directory,
    moved: &HashMap<String, String>,
    from_before: Place,
    from_after: Place,
) -> Option<String> {
    let cut = inner.find(['|', '#']).unwrap_or(inner.len());
    let target = inner[..cut].trim();
    let Resolution::Note(was) = before.resolve(target, from_before) else {
        return None;
    };
    let now = after.note(
        moved
            .get(&was.path)
            .map_or(was.path.as_str(), String::as_str),
    )?;
    let (heading, alias) = split_rest(&inner[cut..]);
    // An alias that only repeated the title follows the title.
    let alias_was_title = alias.is_some_and(|a| title_key(a) == title_key(&was.title));
    let goes =
        matches!(after.resolve(target, from_after), Resolution::Note(n) if n.path == now.path);
    if goes && !(alias_was_title && was.title != now.title) {
        return None;
    }
    let (new_target, title_alias) = after.target_for(now, from_after);
    let alias = match alias {
        Some(own) if !alias_was_title => Some(own.to_owned()),
        _ => title_alias,
    };
    let mut text = new_target;
    if let Some(heading) = heading {
        text.push('#');
        text.push_str(heading);
    }
    if let Some(alias) = alias {
        text.push('|');
        text.push_str(&alias);
    }
    (text != inner).then_some(text)
}

/// The raw `#heading` and `|alias` after a link's target.
fn split_rest(rest: &str) -> (Option<&str>, Option<&str>) {
    match rest.strip_prefix('#') {
        Some(after) => match after.split_once('|') {
            Some((heading, alias)) => (Some(heading), Some(alias)),
            None => (Some(after), None),
        },
        None => (None, rest.strip_prefix('|')),
    }
}

/// Runs `keep_links` over the notes at `paths` (as they are after the op),
/// writing each that changes. `before` and `after` are every note's
/// metadata on either side of the op; `moved` maps old paths to new ones.
/// Returns the paths written.
pub fn keep_in_vault(
    vault: &Vault,
    before: &[NoteMeta],
    after: &[NoteMeta],
    moved: &HashMap<String, String>,
    paths: &[String],
) -> Result<Vec<String>> {
    keep_in_vault_with(vault, before, after, moved, paths, &mut Rollback::default())
}

/// `keep_in_vault`, noting every note it writes in `done` so that the caller
/// can put them back if a later step of its op fails.
pub(crate) fn keep_in_vault_with(
    vault: &Vault,
    before: &[NoteMeta],
    after: &[NoteMeta],
    moved: &HashMap<String, String>,
    paths: &[String],
    done: &mut Rollback,
) -> Result<Vec<String>> {
    let (was_dir, now_dir) = (Directory::new(before), Directory::new(after));
    let back: HashMap<&str, &str> = moved
        .iter()
        .map(|(from, to)| (to.as_str(), from.as_str()))
        .collect();
    let was_at: HashMap<&str, &NoteMeta> = before.iter().map(|n| (n.path.as_str(), n)).collect();
    let now_at: HashMap<&str, &NoteMeta> = after.iter().map(|n| (n.path.as_str(), n)).collect();
    let mut seen = HashSet::new();
    let mut written = Vec::new();
    for path in paths {
        if !seen.insert(path.as_str()) {
            continue;
        }
        let Some(now) = now_at.get(path.as_str()).copied() else {
            continue;
        };
        if now.kind == "template" || crate::vault::in_templates(path) {
            continue;
        }
        let was = was_at
            .get(back.get(path.as_str()).copied().unwrap_or(path))
            .copied()
            .unwrap_or(now);
        // Keeping links is the op's last step: a note that cannot be read
        // or written keeps its old links rather than undo what went before.
        let Ok(file) = vault.path_of(path) else {
            continue;
        };
        let Ok(text) = fs::read_to_string(&file) else {
            continue;
        };
        let parts = split(&text);
        let Some(body) = keep_links(
            parts.body,
            &was_dir,
            &now_dir,
            moved,
            Place::of(was),
            Place::of(now),
        ) else {
            continue;
        };
        let kept = join(parts.prefix, &body, eol_of(&text));
        if done
            .write(&file, kept.as_bytes(), Some(text.clone().into_bytes()))
            .is_ok()
        {
            written.push(path.clone());
        }
    }
    Ok(written)
}

/// After `moves`, keeps the links in `candidates` (paths before the moves)
/// and in the moved notes going where they went. Returns the paths written.
pub fn keep_after_moves(
    vault: &Vault,
    before: &[NoteMeta],
    moves: &[(String, String)],
    candidates: &[String],
) -> Result<Vec<String>> {
    if moves.is_empty() {
        return Ok(Vec::new());
    }
    let moved: HashMap<String, String> = moves.iter().cloned().collect();
    let mut after: Vec<NoteMeta> = before
        .iter()
        .filter(|n| !moved.contains_key(&n.path))
        .cloned()
        .collect();
    for (_, to) in moves {
        after.push(vault.read(to)?.meta);
    }
    let paths: Vec<String> = candidates
        .iter()
        .map(|p| moved.get(p).cloned().unwrap_or_else(|| p.clone()))
        .chain(moves.iter().map(|(_, to)| to.clone()))
        .collect();
    keep_in_vault(vault, before, &after, &moved, &paths)
}
