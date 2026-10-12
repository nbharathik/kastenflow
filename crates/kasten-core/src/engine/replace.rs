//! Find and replace across a page and its sub-pages. `find_under` only
//! reads: it lists the pages with matches, each with the hash of the text
//! it looked at. `replace_under` takes what that preview showed (path,
//! hash and count per page) and, inside the write lock, changes every page
//! or none of them: if any page differs from the preview, nothing is
//! written. One commit, so one undo.

use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{Change, Kasten};
use crate::error::{Error, Result};
use crate::frontmatter::{split, still_readable};
use crate::history::Actor;
use crate::replace::{
    FindSpec, MatchSample, check_with, find_in_body, replace_in_body, samples_of, title_matches,
};
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::in_templates;

/// Pages one replace may change.
pub const MAX_REPLACE_NOTES: usize = 200;
/// Matches one replace may change.
pub const MAX_REPLACEMENTS: usize = 5_000;
/// Samples shown for each page.
const SAMPLES: usize = 3;

/// What the preview showed for a page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expected {
    pub path: String,
    /// The hash the preview gave for the page.
    pub hash: String,
    /// How many matches the preview counted in it.
    pub count: usize,
}

/// A replace: every match of `spec` in the pages `expect` lists, all under
/// the page `root` (an id or a path), becomes `with`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRequest {
    pub root: String,
    pub spec: FindSpec,
    pub with: String,
    pub expect: Vec<Expected>,
}

/// A page with matches, as the preview shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMatches {
    pub path: String,
    pub title: String,
    /// The hash of the page's text, to pass back in `Expected`.
    pub hash: String,
    /// Matches in the page's text (not its frontmatter or title).
    pub count: usize,
    /// The first few matches with the line around them.
    pub samples: Vec<MatchSample>,
    /// The page's title holds the text. Titles are not replaced: renaming
    /// a page rewrites the links to it.
    pub title_hit: bool,
    /// A locked page is never replaced in.
    pub locked: bool,
}

/// What a replace did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replaced {
    /// The commit it made, to undo it with; None if the vault keeps no history.
    pub commit: Option<String>,
    /// The pages changed, with how many matches each held.
    pub notes: Vec<(String, usize)>,
    pub total: usize,
}

fn stale() -> Error {
    Error::Invalid(
        "Some pages changed since the preview, so nothing was replaced. Look again.".to_owned(),
    )
}

/// `text` as it goes in a commit message: short.
fn shortened(text: &str) -> String {
    if text.chars().count() <= 40 {
        text.to_owned()
    } else {
        format!("{}…", text.chars().take(40).collect::<String>())
    }
}

/// What can be refused before any page is read.
fn check_request(req: &ReplaceRequest) -> Result<()> {
    req.spec.check()?;
    check_with(&req.with)?;
    if req.expect.is_empty() {
        return Err(Error::Invalid(
            "Nothing to replace: look first, then replace what was found".to_owned(),
        ));
    }
    if req.expect.len() > MAX_REPLACE_NOTES {
        return Err(Error::Invalid(format!(
            "At most {MAX_REPLACE_NOTES} pages can be replaced in at once"
        )));
    }
    let total = req
        .expect
        .iter()
        .fold(0usize, |sum, e| sum.saturating_add(e.count));
    if total > MAX_REPLACEMENTS {
        return Err(Error::Invalid(
            "At most 5,000 replacements can be made at once".to_owned(),
        ));
    }
    let mut seen = HashSet::new();
    for e in &req.expect {
        if !seen.insert(e.path.as_str()) {
            return Err(Error::Invalid(format!("{} is listed twice", e.path)));
        }
    }
    Ok(())
}

/// A page to change: what it held, what it will hold, and how many matches.
struct Edit {
    path: String,
    file: PathBuf,
    old: String,
    new: String,
    count: usize,
}

impl Kasten {
    /// The page `root` (an id or a path) and every page below it, by path,
    /// templates aside.
    fn scope_of(&self, root: &str) -> Result<Vec<String>> {
        let paths = self.index().under(root)?;
        if paths.is_empty() {
            return Err(Error::Invalid(format!("No page “{root}” to look under")));
        }
        Ok(paths.into_iter().filter(|p| !in_templates(p)).collect())
    }

    /// The pages under `root` (the page itself and its sub-pages, all the
    /// way down) whose text, or title, holds the search text, with their
    /// hash and match count, at most `max_notes` of them (ask for one more
    /// than can be shown to know whether there are more). Nothing is
    /// written. The text is searched as written: a phrase broken by
    /// formatting, such as `foo **bar**`, is not found as `foo bar`.
    pub fn find_under(
        &self,
        root: &str,
        spec: &FindSpec,
        max_notes: usize,
    ) -> Result<Vec<NoteMatches>> {
        spec.check()?;
        let mut out = Vec::new();
        for path in self.scope_of(root)? {
            if out.len() >= max_notes {
                break;
            }
            let Ok(note) = self.vault.read(&path) else {
                continue;
            };
            let body = split(&note.text).body;
            let found = find_in_body(body, spec);
            let title_hit = title_matches(&note.meta.title, spec);
            if found.is_empty() && !title_hit {
                continue;
            }
            out.push(NoteMatches {
                samples: samples_of(body, &found, SAMPLES),
                count: found.len(),
                title: note.meta.title,
                hash: note.hash,
                locked: note.meta.locked,
                title_hit,
                path,
            });
        }
        Ok(out)
    }

    /// Replaces the search text in the pages the preview showed, in one
    /// commit. For a person only. Every page must be under `root`, a note
    /// (not the trash or a private folder), not locked, and exactly as the
    /// preview saw it (same hash, same count): otherwise nothing is written
    /// and the person is asked to look again. Only each page's text changes,
    /// never its frontmatter or title.
    pub fn replace_under(
        &self,
        actor: &Actor,
        req: &ReplaceRequest,
        now: Instant,
    ) -> Result<Replaced> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Find and replace across pages is for a person, not an agent".to_owned(),
            ));
        }
        check_request(req)?;
        let (mut replaced, commit) =
            self.apply_committing(actor, "replace_under", false, now.millis, &[], |vault| {
                let scope: HashSet<String> = self.scope_of(&req.root)?.into_iter().collect();
                let mut edits: Vec<Edit> = Vec::new();
                for expected in &req.expect {
                    // Only plain notes: never the trash or a private folder.
                    let file = vault.path_of(&expected.path)?;
                    if !scope.contains(&expected.path) {
                        return Err(Error::Invalid(format!(
                            "{} is not under that page, so it is not replaced",
                            expected.path
                        )));
                    }
                    let note = vault.read(&expected.path).map_err(|_| stale())?;
                    if note.hash != expected.hash {
                        return Err(stale());
                    }
                    if note.meta.locked {
                        return Err(Error::Invalid(format!(
                            "“{}” is locked, so nothing was replaced. Unlock it, or leave it out",
                            note.meta.title
                        )));
                    }
                    let parts = split(&note.text);
                    let (body, count) = replace_in_body(parts.body, &req.spec, &req.with)?;
                    if count != expected.count {
                        return Err(stale());
                    }
                    let new = format!("{}{body}", parts.prefix);
                    // The frontmatter is what it was, to the byte.
                    let after = split(&new);
                    if after.prefix != parts.prefix {
                        return Err(Error::Invalid(format!(
                            "That would change the frontmatter of {}, so nothing was replaced",
                            expected.path
                        )));
                    }
                    still_readable(parts.prefix, after.prefix)?;
                    edits.push(Edit {
                        path: expected.path.clone(),
                        file,
                        old: note.text,
                        new,
                        count,
                    });
                }
                // Every new text is worked out: now the writes, put back if
                // one fails.
                let mut done = Rollback::default();
                for edit in edits.iter().filter(|e| e.new != e.old) {
                    let before = Some(edit.old.clone().into_bytes());
                    if let Err(err) = done.write(&edit.file, edit.new.as_bytes(), before) {
                        done.put_back();
                        return Err(err.into());
                    }
                }
                let changed: Vec<&Edit> = edits.iter().filter(|e| e.new != e.old).collect();
                let notes: Vec<(String, usize)> =
                    changed.iter().map(|e| (e.path.clone(), e.count)).collect();
                let pages = match changed.len() {
                    1 => "1 page".to_owned(),
                    n => format!("{n} pages"),
                };
                Ok(Change {
                    message: format!(
                        "replace: “{}” → “{}” in {pages}",
                        shortened(&req.spec.query),
                        shortened(&req.with)
                    ),
                    paths: notes.iter().map(|(path, _)| path.clone()).collect(),
                    value: Replaced {
                        commit: None,
                        total: notes.iter().map(|(_, count)| count).sum(),
                        notes,
                    },
                })
            })?;
        replaced.commit = commit;
        Ok(replaced)
    }
}
