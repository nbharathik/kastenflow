//! Section, property and tag edits, and appending to a journal day (the MCP
//! tools `replace_section`, `update_props`, `add_tags`, `remove_tags` and
//! `journal_append`). Each is one commit.

use serde_json::{Map, Value};

use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key_raw, split, still_readable, yaml_list};
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops::{self, ensure_id};
use crate::tags::{TagSchema, check_props, load_schemas, schema_yaml};
use crate::time::Instant;

fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

/// `tags` with `add` added and `remove` taken out, ignoring case and `#`.
pub(crate) fn adjust_tags(tags: &[String], add: &[String], remove: &[String]) -> Vec<String> {
    let clean = |t: &String| t.trim().trim_start_matches('#').trim().to_owned();
    let gone: Vec<String> = remove.iter().map(clean).collect();
    let mut out: Vec<String> = tags
        .iter()
        .filter(|t| !gone.iter().any(|g| g.eq_ignore_ascii_case(t)))
        .cloned()
        .collect();
    for tag in add.iter().map(clean).filter(|t| !t.is_empty()) {
        if tag.contains([',', '[', ']']) || tag.chars().any(char::is_control) {
            continue;
        }
        if !out.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
            out.push(tag);
        }
    }
    out
}

/// What a relation value names: a note's id, or the path of a note that
/// is given one.
enum Related {
    Id(String),
    Note(String),
}

/// The keys of the relation properties that the schemas of `tags` define.
pub(crate) fn relation_keys(schemas: &[TagSchema], tags: &[String]) -> Vec<String> {
    schemas
        .iter()
        .filter(|s| tags.iter().any(|t| t.eq_ignore_ascii_case(&s.name)))
        .flat_map(|s| &s.properties)
        .filter(|p| p.kind == "relation")
        .map(|p| p.key.clone())
        .collect()
}

/// `text` with the properties `checked` set (a null removes one) and `updated`
/// bumped. The pure step of `update_props`, which a staged change shares.
pub(crate) fn props_text(text: &str, checked: &Map<String, Value>, now: Instant) -> Result<String> {
    let parts = split(text);
    let eol = eol_of(text);
    let prefix = crate::props::set_props(parts.prefix, checked, eol)?;
    let prefix = crate::frontmatter::set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    still_readable(parts.prefix, &prefix)?;
    Ok(join(&prefix, parts.body, eol))
}

/// `text` with tags `add`ed and `remove`d and `updated` bumped; None when the
/// tags are already so. The pure step of `set_tags`, which a staged change
/// shares.
pub(crate) fn tags_text(
    text: &str,
    add: &[String],
    remove: &[String],
    now: Instant,
) -> Result<Option<String>> {
    let parts = split(text);
    let current = crate::frontmatter::Front::read(parts.prefix)
        .tags
        .map(|t| t.0)
        .unwrap_or_default();
    let tags = adjust_tags(&current, add, remove);
    if tags == current {
        return Ok(None);
    }
    let eol = eol_of(text);
    let list = (!tags.is_empty()).then(|| yaml_list(&tags));
    let prefix = set_key_raw(parts.prefix, "tags", list.as_deref(), eol);
    let prefix = crate::frontmatter::set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    still_readable(parts.prefix, &prefix)?;
    Ok(Some(join(&prefix, parts.body, eol)))
}

impl Kasten {
    /// Replaces the section under `heading` with `markdown`.
    pub fn replace_section(
        &self,
        actor: &Actor,
        path: &str,
        heading: &str,
        markdown: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        self.apply(actor, "replace_section", false, now.millis, |vault| {
            let current = vault.read(path)?;
            let body =
                crate::sections::replace_section(split(&current.text).body, heading, markdown)?;
            let note = ops::save_body(vault, path, &body, &current.hash, now)?
                .note()
                .clone();
            Ok(Change {
                message: format!(
                    "section: {} § {}",
                    note.meta.title,
                    heading.trim().trim_start_matches('#').trim()
                ),
                paths: vec![path.to_owned()],
                value: note,
            })
        })
    }

    /// Every tag schema in `tags/`.
    pub fn tag_schemas(&self) -> Result<Vec<TagSchema>> {
        load_schemas(&self.vault)
    }

    /// Sets properties (null removes one), checked against the schemas of
    /// the note's tags. Relations name notes by id, path or title (a title
    /// several notes share must be a path, and templates are never related
    /// to); they are stored as ids, giving a note one if it has none.
    pub fn update_props(
        &self,
        actor: &Actor,
        path: &str,
        props: &Map<String, Value>,
        now: Instant,
    ) -> Result<NoteFile> {
        let schemas = self.tag_schemas()?;
        // The note a relation names, when not by id.
        let resolve = |item: &str| -> Result<String> {
            let missing = || Error::Invalid(format!("No note called “{item}” to relate to"));
            let path = match self.resolve(item) {
                Ok(path) if !crate::vault::in_templates(&path) => path,
                Err(Error::Invalid(shared)) if shared.starts_with("Several") => {
                    return Err(Error::Invalid(shared));
                }
                _ => return Err(missing()),
            };
            // The note is given an id: an agent may only write where it may.
            if actor.is_agent() {
                self.writable(&path)?;
            }
            Ok(path)
        };
        self.apply(actor, "update_props", false, now.millis, |vault| {
            let current = vault.read(path)?;
            let mut checked = check_props(&schemas, &current.meta.tags, props)?;
            let mut paths = vec![path.to_owned()];
            let relations = relation_keys(&schemas, &current.meta.tags);
            // Every name is found before any note is given an id, so a
            // name refused leaves the vault as it was.
            let mut named = Vec::new();
            for key in relations {
                let Some(Value::Array(items)) = checked.get(&key).cloned() else {
                    continue;
                };
                let mut found = Vec::new();
                for item in items.iter().filter_map(Value::as_str) {
                    found.push(match self.path_of_id(item)? {
                        Some(_) => Related::Id(item.to_owned()),
                        None => Related::Note(resolve(item)?),
                    });
                }
                named.push((key, found));
            }
            for (key, found) in named {
                let mut ids = Vec::new();
                for related in found {
                    let id = match related {
                        Related::Id(id) => id,
                        Related::Note(found) => {
                            let id = ensure_id(vault, &found, now)?;
                            paths.push(found);
                            id
                        }
                    };
                    ids.push(Value::String(id));
                }
                checked.insert(key, Value::Array(ids));
            }
            let current = vault.read(path)?;
            let text = props_text(&current.text, &checked, now)?;
            write_atomic(&vault.path_of(path)?, text.as_bytes())?;
            let note = vault.read(path)?;
            paths.sort();
            paths.dedup();
            Ok(Change {
                message: format!("props: {}", note.meta.title),
                paths,
                value: note,
            })
        })
    }

    /// Adds and removes tags.
    pub fn set_tags(
        &self,
        actor: &Actor,
        path: &str,
        add: &[String],
        remove: &[String],
        now: Instant,
    ) -> Result<NoteFile> {
        self.apply(actor, "tags", false, now.millis, |vault| {
            let current = vault.read(path)?;
            let Some(text) = tags_text(&current.text, add, remove, now)? else {
                return Ok(Change {
                    message: String::new(),
                    paths: vec![],
                    value: current,
                });
            };
            write_atomic(&vault.path_of(path)?, text.as_bytes())?;
            let note = vault.read(path)?;
            Ok(Change {
                message: format!("tags: {}", note.meta.title),
                paths: vec![path.to_owned()],
                value: note,
            })
        })
    }

    /// Adds Markdown to a journal day (made from the template if new), at
    /// the end or under `heading`.
    pub fn journal_append(
        &self,
        actor: &Actor,
        date: &str,
        markdown: &str,
        heading: Option<&str>,
        now: Instant,
    ) -> Result<NoteFile> {
        let day = self.journal(actor, date, now)?;
        self.append(actor, &day.meta.path, markdown, heading, now)
    }

    /// Writes `tags/<tag>.yaml` from a schema given as JSON.
    pub fn write_tag_schema(
        &self,
        actor: &Actor,
        tag: &str,
        schema: &Value,
        now: Instant,
    ) -> Result<String> {
        if !tag.chars().any(char::is_alphanumeric) {
            return Err(Error::Invalid(format!("Not a tag name: “{tag}”")));
        }
        let slug = crate::slug::slugify(tag);
        let yaml = schema_yaml(tag.trim().trim_start_matches('#'), schema)?;
        let path = format!("tags/{slug}.yaml");
        self.apply(actor, "update_tag_schema", false, now.millis, |vault| {
            let file = vault.file_of(&path, &[".yaml"])?;
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir)?;
            }
            write_atomic(&file, yaml.as_bytes())?;
            Ok(Change {
                message: format!("schema: {tag}"),
                paths: vec![path.clone()],
                value: path.clone(),
            })
        })
    }
}
