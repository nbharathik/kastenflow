//! Ops for page comments and web text highlights, which live in sidecar files beside their page.
//!
//! A comment is added, resolved, reopened or attached to another place; there
//! is no delete, and a comment never changes the page's Markdown. Each op
//! writes only the page's `.comments.json` and is one commit that Undo takes
//! back. The page must be in the vault (not in the trash), and an agent may
//! comment only where it may write (not on a locked page or a template).
//! Highlights on captured pages are in `annotations/highlights.rs`.

mod highlights;

use std::fs;
use std::io::ErrorKind;

use super::{Change, Kasten, Problem};
use crate::atomic::write_atomic;
use crate::comments::{self, Anchor, Comment, Comments, NewComment};
use crate::companions::{self, COMMENTS, HIGHLIGHTS};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::id::ulid_at;
use crate::note::NoteFile;
use crate::text_highlights::TextHighlights;
use crate::time::Instant;
use crate::vault::Vault;

/// What an actor signs with: `you`, or `agent:<client>`.
pub(super) fn author_of(actor: &Actor) -> String {
    match actor {
        Actor::Human => "you".to_owned(),
        Actor::Agent { client, .. } | Actor::Approved { client, .. } => format!("agent:{client}"),
    }
}

/// The text of the sidecar `rel` (ending `suffix`), or None if there is no such file.
pub(super) fn read_sidecar(vault: &Vault, rel: &str, suffix: &str) -> Result<Option<String>> {
    match fs::read_to_string(vault.file_of(rel, &[suffix])?) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn read_comments(vault: &Vault, page: &str) -> Result<Comments> {
    let rel = comments::sidecar_of(page)?;
    read_sidecar(vault, &rel, COMMENTS)?
        .map_or_else(|| Ok(Comments::new()), |t| Comments::parse(&t))
}

impl Kasten {
    /// The page an annotation goes on, read: it must be in the vault, not the
    /// trash and not a template; an agent must also be allowed to write it.
    pub(super) fn annotated(&self, actor: &Actor, page: &str) -> Result<NoteFile> {
        if actor.is_agent() {
            self.writable(page)?;
        }
        if crate::vault::in_templates(page) {
            return Err(Error::Invalid(
                "A template has no comments or highlights".to_owned(),
            ));
        }
        self.vault.read(page)
    }

    /// The comments on `page`, in the order they were made, resolved ones
    /// included.
    pub fn comments(&self, page: &str) -> Result<Vec<Comment>> {
        self.vault.read(page)?;
        Ok(read_comments(&self.vault, page)?.comments())
    }

    /// Changes `page`'s comments file in one commit: `change` edits it and
    /// gives its result with the commit message, or None for the message when
    /// nothing changed (then nothing is written).
    fn edit_comments<T>(
        &self,
        actor: &Actor,
        op: &str,
        page: &str,
        now: Instant,
        change: impl FnOnce(&mut Comments, &str) -> Result<(T, Option<String>)>,
    ) -> Result<T> {
        self.apply(actor, op, false, now.millis, |vault| {
            let note = self.annotated(actor, page)?;
            let mut file = read_comments(vault, page)?;
            let (value, message) = change(&mut file, &note.meta.title)?;
            let Some(message) = message else {
                return Ok(Change {
                    value,
                    paths: Vec::new(),
                    message: String::new(),
                });
            };
            let rel = comments::sidecar_of(page)?;
            write_atomic(
                &vault.file_of(&rel, &[COMMENTS])?,
                file.to_text().as_bytes(),
            )?;
            Ok(Change {
                value,
                paths: vec![rel],
                message,
            })
        })
    }

    /// Adds a comment to `page`, signed by the actor.
    pub fn add_comment(
        &self,
        actor: &Actor,
        page: &str,
        new: &NewComment,
        now: Instant,
    ) -> Result<Comment> {
        new.check()?;
        self.edit_comments(actor, "add_comment", page, now, |file, title| {
            let id = format!("c-{}", ulid_at(now.millis));
            let added = file.add(&id, new, &author_of(actor), &now.rfc3339())?;
            Ok((added, Some(format!("comment: {title}"))))
        })
    }

    /// Resolves comment `id`, or with `resolved` false opens it again.
    /// Saying what is already so writes and commits nothing.
    pub fn resolve_comment(
        &self,
        actor: &Actor,
        page: &str,
        id: &str,
        resolved: bool,
        now: Instant,
    ) -> Result<Comment> {
        let op = if resolved {
            "resolve_comment"
        } else {
            "reopen_comment"
        };
        self.edit_comments(actor, op, page, now, |file, title| {
            let at = now.rfc3339();
            let by = author_of(actor);
            let (comment, changed) =
                file.resolve(id, resolved.then_some((at.as_str(), by.as_str())))?;
            let message = changed.then(|| {
                let how = if resolved { "resolved" } else { "reopened" };
                format!("comment: {title} ({how})")
            });
            Ok((comment, message))
        })
    }

    /// Attaches comment `id` to another place on the page (its section and
    /// quote), as when the words it was about have changed.
    pub fn reanchor_comment(
        &self,
        actor: &Actor,
        page: &str,
        id: &str,
        anchor: &Anchor,
        now: Instant,
    ) -> Result<Comment> {
        self.edit_comments(actor, "reanchor_comment", page, now, |file, title| {
            let (comment, changed) = file.reanchor(id, anchor)?;
            Ok((
                comment,
                changed.then(|| format!("comment: {title} (moved)")),
            ))
        })
    }

    /// What is wrong with the sidecar files of pages, for `verify`: a comments
    /// or highlights file whose page is not in the vault any more (`comments-orphan`,
    /// `highlights-orphan`), and one that cannot be read (`comments`, `highlights`).
    /// A PDF's own highlights file under `sources/` is not looked at.
    pub fn comment_problems(&self) -> Result<Vec<Problem>> {
        let mut out = Vec::new();
        let problem = |kind: &str, path: &str, detail: String| Problem {
            kind: kind.to_owned(),
            path: Some(path.to_owned()),
            detail,
        };
        for stat in self.vault.files_among(&companions::SUFFIXES)? {
            let path = stat.path;
            let kind = if path.ends_with(COMMENTS) {
                "comments"
            } else {
                "highlights"
            };
            let Some(note) = companions::note_of(&path) else {
                continue;
            };
            if !self.vault.exists(&note) {
                // A PDF's file keeps its name when the PDF is gone; that is not a page's.
                if path.starts_with("sources/") && path.ends_with(HIGHLIGHTS) {
                    continue;
                }
                out.push(problem(
                    &format!("{kind}-orphan"),
                    &path,
                    format!("These {kind} belong to {note}, which is not in the vault. If the page was renamed or moved outside KastenFlow, rename this file to follow it"),
                ));
                continue;
            }
            if path.ends_with(HIGHLIGHTS) && companions::pdf_owns_highlights(&self.vault, &note) {
                continue;
            }
            let readable = fs::read_to_string(self.vault.root().join(&path))
                .map_err(Error::from)
                .and_then(|text| {
                    if kind == "comments" {
                        Comments::parse(&text).map(|_| ())
                    } else {
                        TextHighlights::parse(&text).map(|_| ())
                    }
                });
            if let Err(err) = readable {
                out.push(problem(kind, &path, err.to_string()));
            }
        }
        Ok(out)
    }
}
