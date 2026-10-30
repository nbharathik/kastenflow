//! Every project at a glance, for the Projects hub: its state, what is due,
//! what it holds and when it last changed. The index answers for notes,
//! tasks and to-dos in a few grouped queries; boards and decks come from the
//! file cache. Reads and writes nothing.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

use super::Kasten;
use super::boards::project_of;
use super::projects::{HEALTHS, STATUSES};
use crate::error::{Error, Result};
use crate::index::{Counts, ProjectRows};

/// The index's answer for one day, with the version of the index file it was
/// read at (it moves when another program changes the file).
pub(super) struct KeptRows {
    version: i64,
    today: String,
    rows: Arc<ProjectRows>,
}

/// How many of something are open, done, and open past their day.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct TaskCounts {
    pub open: u32,
    pub done: u32,
    pub overdue: u32,
}

impl From<Counts> for TaskCounts {
    fn from(c: Counts) -> Self {
        TaskCounts {
            open: c.open,
            done: c.done,
            overdue: c.overdue,
        }
    }
}

/// The task note a project does next.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NextAction {
    pub id: String,
    pub path: String,
    pub title: String,
    /// Its `status` says Done.
    pub done: bool,
}

/// The newest thing in a project: a note, a board or a deck.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LatestActivity {
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
    pub path: String,
    pub title: String,
    /// The note's own kind, or `board` or `deck`.
    pub kind: String,
}

/// The newest note tagged `project-update`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LastUpdate {
    pub path: String,
    pub title: String,
    /// Its `date` property, else the day it was made.
    pub date: Option<String>,
}

/// One project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    /// The project page, `projects/<folder>/_project.md`.
    pub path: String,
    pub folder: String,
    pub id: Option<String>,
    pub title: String,
    pub icon: Option<String>,
    /// The page's one-line `summary` property.
    pub summary: Option<String>,
    pub archived: bool,
    /// Active, Paused or Done; a page with no status is Active, one with a
    /// status this version does not know reads as Other.
    pub status: String,
    pub health: Option<String>,
    pub next_action: Option<NextAction>,
    pub last_review: Option<String>,
    pub review_after: Option<String>,
    /// The review day has come, for a project that is neither Done nor archived.
    pub review_due: bool,
    /// Notes tagged `task`.
    pub tasks: TaskCounts,
    /// To-do lines.
    pub checklist: TaskCounts,
    pub latest: Option<LatestActivity>,
    pub last_update: Option<LastUpdate>,
    pub notes: u32,
    pub boards: u32,
    pub decks: u32,
}

/// The boards (or decks) of one project: how many, and the newest.
#[derive(Debug, Clone, Default)]
struct Files {
    count: u32,
    newest: Option<LatestActivity>,
}

impl Files {
    /// Counts the file at `path` for its project, if it is in one.
    fn add(by_project: &mut HashMap<String, Files>, path: &str, modified: u64, title: &str) {
        let Some(folder) = project_of(path) else {
            return;
        };
        let files = by_project.entry(folder).or_default();
        files.count += 1;
        if files.newest.as_ref().is_none_or(|n| modified > n.modified) {
            files.newest = Some(LatestActivity {
                modified,
                path: path.to_owned(),
                title: title.to_owned(),
                kind: String::new(),
            });
        }
    }
}

fn text(props: &Value, key: &str) -> Option<String> {
    props
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// A property that is a day, as `YYYY-MM-DD` (a time after it is dropped).
fn day(props: &Value, key: &str) -> Option<String> {
    let value = text(props, key)?;
    let head = value.get(..10)?;
    crate::dates::is_real_day(head).then(|| head.to_owned())
}

/// `value` as spelled in `allowed`, `Other` when it is none of them.
fn known(value: &str, allowed: &[&str]) -> String {
    allowed
        .iter()
        .find(|a| a.eq_ignore_ascii_case(value))
        .map_or("Other", |a| a)
        .to_owned()
}

fn is_archived(props: &Value) -> bool {
    match props.get("archived") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s.trim().eq_ignore_ascii_case("true"),
        _ => false,
    }
}

impl Kasten {
    /// Every project, archived ones too, by title. `today` is the person's day
    /// (`YYYY-MM-DD`): it decides what is overdue and which reviews are due.
    pub fn project_summaries(&self, today: &str) -> Result<Vec<ProjectSummary>> {
        if !crate::dates::is_real_day(today) {
            return Err(Error::Invalid(format!(
                "Today is a day written YYYY-MM-DD, not “{today}”"
            )));
        }
        let rows = self.kept_project_rows(today)?;
        // Boards and decks by project: how many, and the newest.
        let walked = self.walk_facts(&[".canvas", ".deck"])?;
        let mut boards: HashMap<String, Files> = HashMap::new();
        for (file, facts) in walked.boards {
            Files::add(&mut boards, &file.path, file.modified, &facts.title);
        }
        let mut decks: HashMap<String, Files> = HashMap::new();
        for (file, facts) in walked.decks {
            if !crate::deck::is_template(&file.path) {
                Files::add(&mut decks, &file.path, file.modified, &facts.title);
            }
        }

        let mut out = Vec::with_capacity(rows.pages.len());
        for page in &rows.pages {
            let props = &page.props;
            let archived = is_archived(props);
            let status =
                text(props, "status").map_or_else(|| "Active".to_owned(), |s| known(&s, &STATUSES));
            let review_after = day(props, "review_after");
            let review_due = review_after.as_deref().is_some_and(|d| d <= today)
                && status != "Done"
                && !archived;
            let next_action = match text(props, "next_action") {
                Some(id) => self.next_action(&id)?,
                None => None,
            };
            let mut latest = rows.newest.get(&page.folder).map(|n| LatestActivity {
                modified: n.modified,
                path: n.path.clone(),
                title: n.title.clone(),
                kind: n.kind.clone(),
            });
            let board = boards.get(&page.folder).cloned().unwrap_or_default();
            let deck = decks.get(&page.folder).cloned().unwrap_or_default();
            for (kind, files) in [("board", &board), ("deck", &deck)] {
                if let Some(newest) = &files.newest
                    && latest.as_ref().is_none_or(|l| newest.modified > l.modified)
                {
                    latest = Some(LatestActivity {
                        kind: kind.to_owned(),
                        ..newest.clone()
                    });
                }
            }
            out.push(ProjectSummary {
                summary: text(props, "summary"),
                archived,
                health: text(props, "health").map(|h| known(&h, &HEALTHS)),
                last_review: day(props, "last_review"),
                review_after,
                review_due,
                next_action,
                tasks: rows
                    .tasks
                    .get(&page.folder)
                    .copied()
                    .unwrap_or_default()
                    .into(),
                checklist: rows
                    .checklist
                    .get(&page.folder)
                    .copied()
                    .unwrap_or_default()
                    .into(),
                latest,
                last_update: rows.updates.get(&page.folder).map(|u| LastUpdate {
                    path: u.path.clone(),
                    title: u.title.clone(),
                    date: u
                        .date
                        .as_deref()
                        .and_then(|d| d.get(..10))
                        .filter(|d| crate::dates::is_real_day(d))
                        .map(str::to_owned),
                }),
                notes: rows.notes.get(&page.folder).copied().unwrap_or(0),
                boards: board.count,
                decks: deck.count,
                path: page.path.clone(),
                folder: page.folder.clone(),
                id: page.id.clone(),
                title: page.title.clone(),
                icon: page.icon.clone(),
                status,
            });
        }
        Ok(out)
    }

    /// The index's rows for `today`, read once and kept. After a change made
    /// through this engine, only the projects whose notes changed are read
    /// again and put in place of their old rows; everything is read again when
    /// the day changes, when another program changed the index file (the app
    /// and the MCP server share one) or when the index was rebuilt. Ten
    /// thousand notes are most of what the summaries cost, and a hub asks
    /// again every time something changes.
    fn kept_project_rows(&self, today: &str) -> Result<Arc<ProjectRows>> {
        let mut index = self.index();
        let version = index.data_version();
        let mut kept = self
            .kept_project_rows
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let touched = index.take_touched();
        let current = kept
            .as_ref()
            .filter(|found| found.version == version && found.today == today);
        let rows = match current {
            Some(found) if touched.is_empty() => return Ok(Arc::clone(&found.rows)),
            Some(found) if !touched.all => {
                let fresh = index.project_rows_for(today, &touched.projects);
                match fresh {
                    Ok(fresh) => Arc::new(found.rows.with_projects(&touched.projects, fresh)),
                    Err(err) => {
                        index.restore_touched(touched);
                        return Err(err);
                    }
                }
            }
            _ => match index.project_rows(today) {
                Ok(rows) => Arc::new(rows),
                Err(err) => {
                    index.restore_touched(touched);
                    return Err(err);
                }
            },
        };
        *kept = Some(KeptRows {
            version,
            today: today.to_owned(),
            rows: Arc::clone(&rows),
        });
        Ok(rows)
    }

    /// The note a stored next action names, if it is still there.
    fn next_action(&self, id: &str) -> Result<Option<NextAction>> {
        let index = self.index();
        let Some(path) = index.by_id(id)? else {
            return Ok(None);
        };
        let Some(note) = index.note(&path)? else {
            return Ok(None);
        };
        let done = text(&note.props, "status").is_some_and(|s| s.eq_ignore_ascii_case("done"));
        Ok(Some(NextAction {
            id: id.to_owned(),
            path,
            title: note.title,
            done,
        }))
    }
}
