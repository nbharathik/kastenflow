//! Making notes: from a template, with tags and properties, or as a quick
//! capture in the inbox, each as one commit.

use serde_json::{Map, Value};

use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key_raw, split, still_readable, yaml_list};
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops::{self, NewNote};
use crate::slug::slugify;
use crate::tags::TagSchema;
use crate::time::Instant;
use crate::vault::Vault;

/// `all` with the given `tags` added (case ignored, `#` and blanks dropped).
pub(crate) fn with_tags(mut all: Vec<String>, tags: &[String]) -> Vec<String> {
    for tag in tags
        .iter()
        .map(|t| t.trim().trim_start_matches('#'))
        .filter(|t| !t.is_empty())
    {
        if !all.iter().any(|a| a.eq_ignore_ascii_case(tag)) {
            all.push(tag.to_owned());
        }
    }
    all
}

/// The properties of a new note checked against the tags it will have (its
/// template's and the given ones); none when there are none.
pub(crate) fn new_props(
    vault: &Vault,
    schemas: &[TagSchema],
    new: &NewNote,
    tags: &[String],
    props: &Map<String, Value>,
) -> Result<Option<Map<String, Value>>> {
    if props.is_empty() {
        return Ok(None);
    }
    let from_template = match &new.template {
        Some(name) => {
            vault
                .read(&format!("templates/{}.md", slugify(name)))?
                .meta
                .tags
        }
        None => Vec::new(),
    };
    let all = with_tags(from_template, tags);
    Ok(Some(crate::tags::check_props(schemas, &all, props)?))
}

/// The text of a note just made (`created`) with its body, the given tags
/// and the checked properties put in. The pure step of `create_with_body`,
/// which a staged change shares.
pub(crate) fn finished_text(
    created: &str,
    body: &str,
    tags: &[String],
    checked: Option<&Map<String, Value>>,
) -> Result<String> {
    let parts = split(created);
    let eol = if created.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut prefix = parts.prefix.to_owned();
    let had = crate::frontmatter::Front::read(parts.prefix)
        .tags
        .map(|t| t.0)
        .unwrap_or_default();
    let all = with_tags(had.clone(), tags);
    if all != had {
        prefix = set_key_raw(&prefix, "tags", Some(&yaml_list(&all)), eol);
    }
    if let Some(checked) = checked {
        prefix = crate::props::set_props(&prefix, checked, eol)?;
    }
    let body = if body.trim().is_empty() {
        parts.body.to_owned()
    } else if body.ends_with('\n') {
        body.to_owned()
    } else {
        format!("{body}{eol}")
    };
    still_readable(parts.prefix, &prefix)?;
    Ok(join(&prefix, &body, eol))
}

impl Kasten {
    pub fn create(&self, actor: &Actor, new: &NewNote, now: Instant) -> Result<NoteFile> {
        self.apply(actor, "create_note", false, now.millis, |vault| {
            let note = ops::create_note(vault, new, now)?;
            let mut paths = vec![note.meta.path.clone()];
            paths.extend(new.parent.clone());
            paths.extend(self.keep_for_new(vault, &note.meta)?);
            let verb = if note.meta.kind == "journal" {
                "journal"
            } else {
                "create"
            };
            Ok(Change {
                message: format!("{verb}: {}", note.meta.title),
                paths,
                value: note,
            })
        })
    }

    /// Creates a note with a body and extra tags in one commit; `verb`
    /// names it in the message (`create`, `capture`).
    #[allow(clippy::too_many_arguments)]
    pub fn create_with_body(
        &self,
        actor: &Actor,
        new: &NewNote,
        body: &str,
        tags: &[String],
        props: &serde_json::Map<String, serde_json::Value>,
        verb: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        if let Some(name) = &new.template {
            ops::not_an_action(name)?;
        }
        let schemas = if props.is_empty() {
            Vec::new()
        } else {
            self.tag_schemas()?
        };
        self.apply(actor, "create_note", false, now.millis, |vault| {
            // Check the properties before writing anything, against the
            // tags the note will have (its template's and the given ones),
            // so a refusal leaves no file behind.
            let checked = new_props(vault, &schemas, new, tags, props)?;
            let created = ops::create_note(vault, new, now)?;
            let text = finished_text(&created.text, body, tags, checked.as_ref())?;
            let path = created.meta.path.clone();
            write_atomic(&vault.path_of(&path)?, text.as_bytes())?;
            let note = vault.read(&path)?;
            let mut paths = vec![path];
            paths.extend(new.parent.clone());
            paths.extend(self.keep_for_new(vault, &note.meta)?);
            Ok(Change {
                message: format!("{verb}: {}", note.meta.title),
                paths,
                value: note,
            })
        })
    }

    /// Saves a chat as a note of type `chat` in `chats/`,
    /// named by `date`, the person's day (YYYY-MM-DD), and its title, with
    /// `markdown` as its body: one commit. A title that is taken on that day
    /// gets the next free name, as other notes do.
    pub fn save_chat(
        &self,
        actor: &Actor,
        title: &str,
        markdown: &str,
        date: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        // Brackets and bars would break links to it, and a title is one line.
        let clean = crate::sources::one_line(&title.replace(['[', ']', '|'], " "));
        let clean: String = clean.chars().take(100).collect();
        let new = NewNote {
            kind: crate::ops::Kind::Chat,
            title: match clean.trim() {
                "" => "Chat".to_owned(),
                t => t.to_owned(),
            },
            date: date.to_owned(),
            project: None,
            parent: None,
            template: None,
            icon: None,
        };
        self.create_with_body(actor, &new, markdown, &[], &Default::default(), "chat", now)
    }

    /// A quick note in the inbox; its first
    /// line is its title.
    pub fn capture(
        &self,
        actor: &Actor,
        markdown: &str,
        tags: &[String],
        now: Instant,
    ) -> Result<NoteFile> {
        self.capture_in(actor, markdown, tags, None, now)
    }

    /// A quick note as a card: in the inbox, or in `project`'s cards (its
    /// folder under `projects/`, which must be there). Its first line is
    /// its title and the rest its body (capture.rs).
    pub fn capture_in(
        &self,
        actor: &Actor,
        markdown: &str,
        tags: &[String],
        project: Option<&str>,
        now: Instant,
    ) -> Result<NoteFile> {
        if let Some(project) = project {
            let folder = self.vault.root().join("projects").join(project);
            if project.is_empty() || slugify(project) != project || !folder.is_dir() {
                return Err(Error::Invalid(format!("No project called {project}")));
            }
        }
        let (title, body) = crate::capture::split(markdown);
        let new = NewNote {
            kind: crate::ops::Kind::Card,
            title: crate::sources::one_line(&title).replace(['[', ']', '|'], ""),
            date: now.rfc3339()[..10].to_owned(),
            project: project.map(str::to_owned),
            parent: None,
            template: None,
            icon: None,
        };
        self.create_with_body(
            actor,
            &new,
            &body,
            tags,
            &Default::default(),
            "capture",
            now,
        )
    }
}
