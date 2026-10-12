//! Ops that change the vault. Each writes atomically; saves notice changes
//! made on disk since the editor loaded a note and keep both versions;
//! deletes move notes to `.trash/`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::atomic::{create_atomic, write_atomic};
use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key, set_key_raw, split, still_readable, yaml_ok};
use crate::id::ulid_at;
use crate::note::NoteFile;
use crate::slug::slugify;
use crate::template_vars::{day_and_time, fill};
use crate::time::Instant;
use crate::vault::Vault;

pub use crate::save::{Saved, save_body};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Page,
    Card,
    Journal,
    Project,
    /// A saved chat, filed in `chats/` under its day and title.
    Chat,
    /// A card made from a highlight in a source; filed as a card is.
    Highlight,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Page => "page",
            Kind::Card => "card",
            Kind::Journal => "journal",
            Kind::Project => "project",
            Kind::Chat => "chat",
            Kind::Highlight => "highlight",
        }
    }
}

/// What to create. `date` is the creator's local day (YYYY-MM-DD), for
/// journal notes and the `{{date}}` placeholder.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNote {
    pub kind: Kind,
    pub title: String,
    pub date: String,
    /// Folder name under `projects/` to create the note in.
    #[serde(default)]
    pub project: Option<String>,
    /// Path of the page this becomes a sub-page of.
    #[serde(default)]
    pub parent: Option<String>,
    /// Name of a file in `templates/`, without `.md`.
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

pub(crate) fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

/// The first free `dir/name.md`, `dir/name-2.md`, …
pub(crate) fn free_path(vault: &Vault, dir: &str, name: &str) -> String {
    free_file(vault, dir, name, ".md")
}

/// `free_path` that also passes over `planned`, paths an op is about to use.
pub(crate) fn free_path_besides(
    vault: &Vault,
    dir: &str,
    name: &str,
    planned: &HashSet<String>,
) -> String {
    free_file_besides(vault, dir, name, ".md", planned)
}

/// The folder a new board or deck goes in: `sub` inside its project's
/// folder under `projects/` (which needs a `_project.md`), or the library.
pub(crate) fn kind_folder(vault: &Vault, project: Option<&str>, sub: &str) -> Result<String> {
    let Some(project) = project else {
        return Ok("library".to_owned());
    };
    if project.is_empty() || slugify(project) != project {
        return Err(Error::Invalid(format!("Not a project folder: {project}")));
    }
    let overview = vault
        .root()
        .join("projects")
        .join(project)
        .join("_project.md");
    if !overview.is_file() {
        return Err(Error::Invalid(format!("No project called {project}")));
    }
    Ok(format!("projects/{project}/{sub}"))
}

/// `free_path` for any kind of vault file, such as a board (`.canvas`) or a
/// deck (`.deck`).
pub(crate) fn free_file(vault: &Vault, dir: &str, name: &str, ext: &str) -> String {
    free_file_besides(vault, dir, name, ext, &HashSet::new())
}

fn free_file_besides(
    vault: &Vault,
    dir: &str,
    name: &str,
    ext: &str,
    planned: &HashSet<String>,
) -> String {
    let join = |file: String| {
        if dir.is_empty() {
            file
        } else {
            format!("{dir}/{file}")
        }
    };
    let taken =
        |rel: &str| planned.contains(rel) || vault.file_of(rel, &[ext]).is_ok_and(|p| p.exists());
    let mut n = 1;
    loop {
        let candidate = join(if n == 1 {
            format!("{name}{ext}")
        } else {
            format!("{name}-{n}{ext}")
        });
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

pub(crate) fn folder_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// A note's id, giving it one first if it has none (for sub-pages and
/// relations, which point at ids).
pub(crate) fn ensure_id(vault: &Vault, parent: &str, now: Instant) -> Result<String> {
    let note = vault.read(parent)?;
    if let Some(id) = note.meta.id {
        return Ok(id);
    }
    let parts = split(&note.text);
    // Unreadable frontmatter hides an `id:` it may have: a new one would
    // cut off everything pointing at the old.
    if !yaml_ok(parts.prefix) {
        return Err(Error::Invalid(format!(
            "{parent} has frontmatter that cannot be read, so nothing can point at it yet; mend it first"
        )));
    }
    let id = ulid_at(now.millis);
    let eol = eol_of(&note.text);
    let prefix = set_key(parts.prefix, "id", Some(&id), eol);
    write_atomic(
        &vault.path_of(parent)?,
        join(&prefix, parts.body, eol).as_bytes(),
    )?;
    Ok(id)
}

/// Creates a note from a template or empty, and returns it. Never replaces
/// an existing file.
pub fn create_note(vault: &Vault, new: &NewNote, now: Instant) -> Result<NoteFile> {
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
    let path = match (new.kind, &new.parent, &project) {
        (Kind::Journal, _, _) => format!("journal/{}/{day}.md", &day[..4]),
        (Kind::Chat, _, _) => free_path(vault, "chats", &format!("{day}-{}", slugify(&title))),
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
        (_, Some(parent), _) => free_path(vault, folder_of(parent), &slugify(&title)),
        (Kind::Card | Kind::Highlight, None, Some(p)) => {
            free_path(vault, &format!("projects/{p}/cards"), &slugify(&title))
        }
        (_, None, Some(p)) => free_path(vault, &format!("projects/{p}/pages"), &slugify(&title)),
        (Kind::Card | Kind::Highlight, None, None) => free_path(vault, "inbox", &slugify(&title)),
        (_, None, None) => free_path(vault, "library", &slugify(&title)),
    };
    if vault.exists(&path) {
        return vault.read(&path);
    }
    let template = match &new.template {
        Some(name) => vault.read(&format!("templates/{}.md", slugify(name)))?.text,
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
    let parent = new
        .parent
        .as_deref()
        .map(|p| ensure_id(vault, p, now))
        .transpose()?;
    let fields = [
        ("id", Some(ulid_at(now.millis))),
        ("title", Some(title.clone())),
        ("type", Some(new.kind.name().to_owned())),
        ("created", Some(stamp.clone())),
        ("updated", Some(stamp)),
        ("parent", parent),
        ("icon", new.icon.clone().filter(|i| !i.trim().is_empty())),
    ];
    for (key, value) in fields {
        if let Some(value) = value {
            prefix = set_key(&prefix, key, Some(&value), eol);
        }
    }
    create_atomic(
        &vault.path_of(&path)?,
        join(&prefix, parts.body, eol).as_bytes(),
    )?;
    vault.read(&path)
}

/// Keys the page header may change. The id is created once and never changes.
const HEADER_KEYS: [&str; 3] = ["title", "icon", "cover"];

/// Keys with a fixed set of values: a page's own layout over the app's
/// defaults, where links opened from the page go, how its sections are
/// drawn, and the lock that makes it read-only for agents (cleared, not set
/// to false). A value set by hand that is not one of these is left as it is
/// (another tool's `layout: post` stays untouched).
const CHOICE_KEYS: [(&str, &[&str]); 6] = [
    ("font", &["sans", "serif", "mono"]),
    ("width", &["normal", "full"]),
    ("text", &["small", "normal", "large", "xl"]),
    ("locked", &["true"]),
    (
        "opens",
        &["here", "tab", "right", "peek-side", "peek-center", "stack"],
    ),
    ("layout", &["sections"]),
];

/// Sets or removes one header key, editing only its line, and bumps `updated`.
pub fn set_meta(
    vault: &Vault,
    rel: &str,
    key: &str,
    value: Option<&str>,
    now: Instant,
) -> Result<NoteFile> {
    let layout = CHOICE_KEYS.iter().find(|(k, _)| *k == key);
    if !HEADER_KEYS.contains(&key) && layout.is_none() {
        return Err(Error::Invalid(format!(
            "The page header cannot change `{key}`"
        )));
    }
    if let (Some((_, values)), Some(value)) = (layout, value)
        && !values.contains(&value)
    {
        return Err(Error::Invalid(format!(
            "A page's {key} is one of: {}",
            values.join(", ")
        )));
    }
    if value.is_some_and(|v| v.chars().any(char::is_control)) {
        return Err(Error::Invalid(format!(
            "A page's {key} is one line of text, without control characters"
        )));
    }
    let current = vault.read(rel)?;
    let parts = split(&current.text);
    let eol = eol_of(&current.text);
    // The lock is a YAML boolean, `locked: true`, as people write it by hand.
    let mut prefix = if key == "locked" {
        set_key_raw(parts.prefix, key, value, eol)
    } else {
        set_key(parts.prefix, key, value, eol)
    };
    prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    still_readable(parts.prefix, &prefix)?;
    write_atomic(
        &vault.path_of(rel)?,
        join(&prefix, parts.body, eol).as_bytes(),
    )?;
    vault.read(rel)
}

/// Makes a card a page or a page a card: sets `type` (and `updated`), the
/// rest of the file as it was. Other kinds stay what they are.
pub fn set_kind(vault: &Vault, rel: &str, kind: &str, now: Instant) -> Result<NoteFile> {
    if !matches!(kind, "card" | "page") {
        return Err(Error::Invalid(format!(
            "A note can become a card or a page, not a {kind}"
        )));
    }
    let current = vault.read(rel)?;
    let from = current.meta.kind.as_str();
    if !matches!(from, "card" | "page") {
        return Err(Error::Invalid(format!("A {from} cannot become a {kind}")));
    }
    if from == kind {
        return Ok(current);
    }
    let parts = split(&current.text);
    let eol = eol_of(&current.text);
    let mut prefix = set_key(parts.prefix, "type", Some(kind), eol);
    prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    still_readable(parts.prefix, &prefix)?;
    write_atomic(
        &vault.path_of(rel)?,
        join(&prefix, parts.body, eol).as_bytes(),
    )?;
    vault.read(rel)
}

/// Moves a note to `.trash/<time>/<path>`, never deleting it. Returns where it
/// went, relative to the vault. (The engine's `trash` takes sub-pages too.)
pub fn trash_note(vault: &Vault, rel: &str, now: Instant) -> Result<String> {
    let mut went = crate::trash::trash_all(vault, &[rel.to_owned()], now)?;
    Ok(went.remove(0))
}
