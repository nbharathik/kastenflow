//! Making a note, worked out without writing anything: the path, the text and
//! the parent's id. `create_note` writes what this plans, and a staged change
//! plans with the same code, so what a chat previews is what the vault gets.

use std::collections::HashSet;

use super::{Kind, NewNote, eol_of, folder_of, free_path_besides, template_text};
use crate::error::{Error, Result};
use crate::frontmatter::{Front, join, set_key, split, yaml_ok};
use crate::id::ulid_at;
use crate::slug::slugify;
use crate::template_vars::{day_and_time, fill};
use crate::time::Instant;
use crate::vault::Vault;

/// What making a note comes to, worked out without writing anything.
pub(crate) enum NotePlan {
    /// The note is there already (a journal day): nothing is made.
    Existing(String),
    /// A new file, and the parent's file when it has to be given an id first.
    New {
        path: String,
        text: String,
        parent: Option<(String, String)>,
    },
}

/// A note's id, and its text with an id added when it has none (None when
/// it has one). The pure step of `ensure_id`, which a staged change shares.
pub(crate) fn id_text(path: &str, text: &str, now: Instant) -> Result<(String, Option<String>)> {
    let parts = split(text);
    if let Some(id) = Front::text(&Front::read(parts.prefix).id) {
        return Ok((id, None));
    }
    // Unreadable frontmatter hides an `id:` it may have: a new one would
    // cut off everything pointing at the old.
    if !yaml_ok(parts.prefix) {
        return Err(Error::Invalid(format!(
            "{path} has frontmatter that cannot be read, so nothing can point at it yet; mend it first"
        )));
    }
    let id = ulid_at(now.millis);
    let eol = eol_of(text);
    let prefix = set_key(parts.prefix, "id", Some(&id), eol);
    Ok((id, Some(join(&prefix, parts.body, eol))))
}

/// Plans `create_note` with nothing written: the path (passing over `taken`,
/// paths a staged change means to use), the file's text and the parent's text
/// when it has no id yet. `staged_parent` is the parent's text when a staged
/// change holds it; else the vault's file is read. The pure step of
/// `create_note`, which a staged change shares.
pub(crate) fn plan_note(
    vault: &Vault,
    new: &NewNote,
    now: Instant,
    taken: &HashSet<String>,
    staged_parent: Option<&str>,
) -> Result<NotePlan> {
    let Some((day, _)) = day_and_time(&new.date) else {
        return Err(Error::Invalid(format!("Not a day: {}", new.date)));
    };
    let title = if new.kind == Kind::Journal {
        day.to_owned()
    } else {
        new.title.trim().to_owned()
    };
    if title.chars().any(char::is_control) {
        return Err(Error::Invalid(
            "A title is one line of text, without tabs or control characters".to_owned(),
        ));
    }
    let project = new.project.as_deref().map(slugify);
    let free = |dir: &str, name: &str| free_path_besides(vault, dir, name, taken);
    let path = match (new.kind, &new.parent, &project) {
        (Kind::Journal, _, _) => format!("journal/{}/{day}.md", &day[..4]),
        (Kind::Chat, _, _) => free("chats", &format!("{day}-{}", slugify(&title))),
        (Kind::Project, _, _) => {
            let mut folder = slugify(&title);
            let base = folder.clone();
            let mut n = 2;
            while vault.root().join("projects").join(&folder).exists() {
                folder = format!("{base}-{n}");
                n += 1;
            }
            format!("projects/{folder}/_project.md")
        }
        (_, Some(parent), _) => free(folder_of(parent), &slugify(&title)),
        (Kind::Card | Kind::Highlight, None, Some(p)) => {
            free(&format!("projects/{p}/cards"), &slugify(&title))
        }
        (_, None, Some(p)) => free(&format!("projects/{p}/pages"), &slugify(&title)),
        (Kind::Card | Kind::Highlight, None, None) => free("inbox", &slugify(&title)),
        (_, None, None) => free("library", &slugify(&title)),
    };
    if vault.exists(&path) {
        return Ok(NotePlan::Existing(path));
    }
    let template = match &new.template {
        Some(name) => template_text(vault, name)?,
        None => String::new(),
    };
    let text = fill(
        &template,
        &title,
        &new.date,
        project.as_deref().unwrap_or(""),
        now,
    );
    let parts = split(&text);
    let eol = eol_of(&text);
    let stamp = now.rfc3339();
    let mut prefix = parts.prefix.to_owned();
    // The parent's id, and its file when it has to be given one.
    let (parent_id, parent_file) = match new.parent.as_deref() {
        Some(p) => {
            let held = match staged_parent {
                Some(text) => text.to_owned(),
                None => vault.read(p)?.text,
            };
            let (id, text) = id_text(p, &held, now)?;
            (Some(id), text.map(|text| (p.to_owned(), text)))
        }
        None => (None, None),
    };
    let fields = [
        ("id", Some(ulid_at(now.millis))),
        ("title", Some(title.clone())),
        ("type", Some(new.kind.name().to_owned())),
        ("created", Some(stamp.clone())),
        ("updated", Some(stamp)),
        ("parent", parent_id),
        ("icon", new.icon.clone().filter(|i| !i.trim().is_empty())),
    ];
    for (key, value) in fields {
        if let Some(value) = value {
            prefix = set_key(&prefix, key, Some(&value), eol);
        }
    }
    Ok(NotePlan::New {
        path,
        text: join(&prefix, parts.body, eol),
        parent: parent_file,
    })
}
