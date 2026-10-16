//! Staging the ops on notes: add to a note, replace a section, set
//! properties, change tags, make a note, add to a journal day. Each runs the
//! pure step the real op runs and puts the text it makes into the set.

use std::collections::HashSet;

use serde_json::{Map, Value};

use super::super::Kasten;
use super::super::create::{finished_text, new_props};
use super::super::edit::{props_text, relation_keys, tags_text};
use super::super::execute::{agent_kind, day_of, note_ref};
use super::plan::Planned;
use crate::agent::{AgentOp, ChangeSet, FileKind, NewFile};
use crate::error::{Error, Result};
use crate::frontmatter::{Front, split};
use crate::note::{NoteFile, content_hash, meta_for};
use crate::ops::{self, NewNote, NotePlan};
use crate::save::saved_text;
use crate::sections::{append_under, replace_section};
use crate::tags::check_props;
use crate::time::Instant;

/// What a change to a note's text comes to.
enum Edit {
    Unchanged,
    Changed(String),
    /// Not previewed: it waits for review, for this reason.
    Review(String),
}

impl From<Option<String>> for Edit {
    fn from(text: Option<String>) -> Edit {
        text.map_or(Edit::Unchanged, Edit::Changed)
    }
}

/// A note as the set leaves it, told as a tool tells a write.
fn told(path: &str, text: &str, set: &ChangeSet) -> NoteFile {
    NoteFile {
        meta: meta_for(path, text, set.created),
        hash: content_hash(text),
        text: text.to_owned(),
    }
}

fn quoted(title: &str) -> String {
    format!("“{}”", title.trim())
}

impl Kasten {
    /// Changes the note at `path` in the set. `change` is given its text (the
    /// set's, else the vault's) and says what it comes to; `words` makes the
    /// step's summary from the note after the change.
    fn finish_edit(
        &self,
        set: &mut ChangeSet,
        path: &str,
        words: impl FnOnce(&NoteFile) -> String,
        change: impl FnOnce(&str) -> Result<Edit>,
    ) -> Result<Planned> {
        let (current, base) = self.starting_from(set, path, FileKind::Note)?;
        let (text, changed) = match change(&current)? {
            Edit::Review(why) => return Ok(Planned::Review(why)),
            Edit::Changed(text) if text != current => (text, true),
            Edit::Changed(_) | Edit::Unchanged => (current, false),
        };
        if changed {
            self.put_text(set, path, FileKind::Note, base, text.clone())?;
        }
        let note = told(path, &text, set);
        Ok(Planned::Staged {
            paths: if changed {
                vec![path.to_owned()]
            } else {
                vec![]
            },
            summary: words(&note),
            result: note_ref(&note),
        })
    }

    /// Stages an op on a note, or None for an op that is not one.
    pub(super) fn plan_note_op(
        &self,
        set: &mut ChangeSet,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Option<Planned>> {
        Ok(Some(match op {
            AgentOp::Append {
                path,
                markdown,
                heading,
            } => self.finish_edit(
                set,
                path,
                |n| format!("Add to {}", quoted(&n.meta.title)),
                |cur| {
                    let body = append_under(split(cur).body, markdown, heading.as_deref())?;
                    Ok(saved_text(cur, &body, now).into())
                },
            )?,
            AgentOp::ReplaceSection {
                path,
                heading,
                markdown,
            } => self.finish_edit(
                set,
                path,
                |n| {
                    let heading = heading.trim().trim_start_matches('#').trim();
                    format!("Replace “{heading}” in {}", quoted(&n.meta.title))
                },
                |cur| {
                    let body = replace_section(split(cur).body, heading, markdown)?;
                    Ok(saved_text(cur, &body, now).into())
                },
            )?,
            AgentOp::Tags { path, add, remove } => self.finish_edit(
                set,
                path,
                |n| format!("Change the tags of {}", quoted(&n.meta.title)),
                |cur| Ok(tags_text(cur, add, remove, now)?.into()),
            )?,
            AgentOp::UpdateProps { path, props } => {
                let schemas = self.tag_schemas()?;
                self.finish_edit(
                    set,
                    path,
                    |n| format!("Set properties of {}", quoted(&n.meta.title)),
                    |cur| {
                        let tags = Front::read(split(cur).prefix)
                            .tags
                            .map(|t| t.0)
                            .unwrap_or_default();
                        let checked = check_props(&schemas, &tags, props)?;
                        let relations = relation_keys(&schemas, &tags);
                        if relations
                            .iter()
                            .any(|key| matches!(checked.get(key), Some(Value::Array(_))))
                        {
                            return Ok(Edit::Review(
                                "Relations between notes are not previewed, so this waits for your review"
                                    .to_owned(),
                            ));
                        }
                        Ok(Edit::Changed(props_text(cur, &checked, now)?))
                    },
                )?
            }
            AgentOp::JournalAppend {
                date,
                markdown,
                heading,
            } => {
                let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
                if !set.is_new(&path) && !self.vault.exists(&path) {
                    if crate::template_vars::day_and_time(date).is_none() {
                        return Err(Error::Invalid(format!("Not a day: {date}")));
                    }
                    return Ok(Some(Planned::Review(format!(
                        "The journal for {date} does not exist yet, and making a page is not previewed, so this waits for your review"
                    ))));
                }
                self.finish_edit(
                    set,
                    &path,
                    |_| format!("Add to the journal for {date}"),
                    |cur| {
                        let body = append_under(split(cur).body, markdown, heading.as_deref())?;
                        Ok(saved_text(cur, &body, now).into())
                    },
                )?
            }
            AgentOp::CreateNote {
                note_type,
                title,
                body,
                project,
                tags,
                props,
                parent,
                template,
            } => {
                let new = NewNote {
                    kind: agent_kind(note_type)?,
                    title: title.clone(),
                    date: day_of(now),
                    project: project.clone(),
                    parent: parent.clone(),
                    template: template.clone(),
                    icon: None,
                };
                self.plan_create(set, &new, (body, tags, props), "create_note", now)?
            }
            AgentOp::Capture { markdown, tags } => {
                let (title, body) = crate::capture::split(markdown);
                let new = NewNote {
                    kind: ops::Kind::Card,
                    title: crate::sources::one_line(&title).replace(['[', ']', '|'], ""),
                    date: day_of(now),
                    project: None,
                    parent: None,
                    template: None,
                    icon: None,
                };
                self.plan_create(set, &new, (&body, tags, &Map::new()), "capture", now)?
            }
            _ => return Ok(None),
        }))
    }

    /// Stages a new note, with its body, tags and properties.
    fn plan_create(
        &self,
        set: &mut ChangeSet,
        new: &NewNote,
        (body, tags, props): (&str, &[String], &Map<String, Value>),
        op: &str,
        now: Instant,
    ) -> Result<Planned> {
        if let Some(name) = &new.template {
            ops::not_an_action(name)?;
        }
        let schemas = if props.is_empty() {
            Vec::new()
        } else {
            self.tag_schemas()?
        };
        let checked = new_props(&self.vault, &schemas, new, tags, props)?;
        let taken: HashSet<String> = set
            .created_files
            .iter()
            .map(|f| f.provisional.clone())
            .collect();
        let staged_parent = new
            .parent
            .as_deref()
            .and_then(|p| set.text_of(p))
            .map(str::to_owned);
        let NotePlan::New { path, text, parent } =
            ops::plan_note(&self.vault, new, now, &taken, staged_parent.as_deref())?
        else {
            return Err(Error::Invalid(format!(
                "{} is there already",
                new.title.trim()
            )));
        };
        self.vault.path_of(&path)?;
        let text = finished_text(&text, body, tags, checked.as_ref())?;
        let mut paths = vec![path.clone()];
        // A parent without an id is given one, as it always was.
        if let Some((parent_path, parent_text)) = parent {
            let (_, base) = self.starting_from(set, &parent_path, FileKind::Note)?;
            self.put_text(set, &parent_path, FileKind::Note, base, parent_text)?;
            paths.push(parent_path);
        }
        let note = told(&path, &text, set);
        self.put_new(
            set,
            NewFile {
                provisional: path,
                title: note.meta.title.clone(),
                op: op.to_owned(),
                text,
                kind: FileKind::Note,
            },
        )?;
        let verb = if op == "capture" { "Capture" } else { "Create" };
        Ok(Planned::Staged {
            paths,
            summary: format!("{verb} {}", quoted(&note.meta.title)),
            result: note_ref(&note),
        })
    }
}
