//! The index queries behind project summaries: each project's page, and its
//! notes, task notes, to-dos, newest note and newest update, each taken for
//! all projects at once in one grouped query (never one query per project).

use std::collections::{BTreeSet, HashMap};

use rusqlite::params;
use serde_json::Value;

use super::Index;
use crate::error::Result;

/// A project's page as the index holds it.
#[derive(Debug, Clone)]
pub struct ProjectRow {
    pub path: String,
    /// The folder under `projects/`.
    pub folder: String,
    pub id: Option<String>,
    pub title: String,
    pub icon: Option<String>,
    pub props: Value,
}

/// How many of something are open, done, and open with a day before today.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub open: u32,
    pub done: u32,
    pub overdue: u32,
}

/// The newest note of a project.
#[derive(Debug, Clone)]
pub struct Newest {
    pub path: String,
    pub title: String,
    pub kind: String,
    pub modified: u64,
}

/// The newest `project-update` note of a project.
#[derive(Debug, Clone)]
pub struct Update {
    pub path: String,
    pub title: String,
    pub date: Option<String>,
}

/// Everything about every project that one pass over the index gives.
#[derive(Debug, Default, Clone)]
pub struct ProjectRows {
    /// Project pages, by title.
    pub pages: Vec<ProjectRow>,
    /// Notes in each project, its page, templates and the rest of the vault left out.
    pub notes: HashMap<String, u32>,
    /// Notes tagged `task`, by their `status` and `due` properties.
    pub tasks: HashMap<String, Counts>,
    /// To-do lines in the project's notes (the page included), by their day.
    pub checklist: HashMap<String, Counts>,
    pub newest: HashMap<String, Newest>,
    pub updates: HashMap<String, Update>,
}

impl ProjectRows {
    /// These rows with what they hold of the projects in `folders` replaced by
    /// `fresh` (`Index::project_rows_for` for those folders): a project that
    /// is gone is dropped, one that is new comes in, and the pages stay in the
    /// order the index gives them (by title, then path).
    pub fn with_projects(&self, folders: &BTreeSet<String>, fresh: ProjectRows) -> ProjectRows {
        let mut out = self.clone();
        out.pages.retain(|page| !folders.contains(&page.folder));
        out.notes.retain(|folder, _| !folders.contains(folder));
        out.tasks.retain(|folder, _| !folders.contains(folder));
        out.checklist.retain(|folder, _| !folders.contains(folder));
        out.newest.retain(|folder, _| !folders.contains(folder));
        out.updates.retain(|folder, _| !folders.contains(folder));
        out.pages.extend(fresh.pages);
        // The index sorts by the lower-cased, trimmed title, then the path,
        // as bytes: the same order as these strings.
        out.pages
            .sort_by_cached_key(|page| (page.title.trim().to_lowercase(), page.path.clone()));
        out.notes.extend(fresh.notes);
        out.tasks.extend(fresh.tasks);
        out.checklist.extend(fresh.checklist);
        out.newest.extend(fresh.newest);
        out.updates.extend(fresh.updates);
        out
    }
}

/// A note that is the page of its project.
const NOT_THE_PAGE: &str = "n.path != 'projects/' || n.project || '/_project.md'";

impl Index {
    /// How many notes the index holds, and how many of them are not templates
    /// (for the health report).
    pub fn note_counts(&self) -> Result<(usize, usize)> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN kind != 'template' THEN 1 ELSE 0 END), 0) FROM notes",
            [],
            |r| Ok((r.get::<_, i64>(0)? as usize, r.get::<_, i64>(1)? as usize)),
        )?)
    }

    /// Paths of notes whose file name looks like a conflict copy, by path.
    pub fn conflict_candidates(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT path FROM notes WHERE path LIKE '%(conflict %' ORDER BY path",
        )?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// The index's schema version, as a number (0 when it is not one).
    pub fn schema(&self) -> u32 {
        super::SCHEMA_VERSION.parse().unwrap_or(0)
    }

    /// The rows project summaries are built from; `today` is the person's day,
    /// `YYYY-MM-DD`, which decides what is overdue.
    pub fn project_rows(&self, today: &str) -> Result<ProjectRows> {
        self.rows_in(today, None)
    }

    /// The same rows for the projects in `folders` alone: what to put in place
    /// of those a kept copy holds (`ProjectRows::with_projects`).
    pub fn project_rows_for(&self, today: &str, folders: &BTreeSet<String>) -> Result<ProjectRows> {
        let mut out = ProjectRows::default();
        for folder in folders {
            let one = self.rows_in(today, Some(folder))?;
            out.pages.extend(one.pages);
            out.notes.extend(one.notes);
            out.tasks.extend(one.tasks);
            out.checklist.extend(one.checklist);
            out.newest.extend(one.newest);
            out.updates.extend(one.updates);
        }
        Ok(out)
    }

    /// `project_rows`, for the project in folder `only` when there is one.
    fn rows_in(&self, today: &str, only: Option<&str>) -> Result<ProjectRows> {
        let mut out = ProjectRows::default();
        // For one project the queries name it (`notes_project` finds its
        // notes without a scan); for all of them they do not. A test of
        // "is it null" in the query would keep the planner from the index.
        let (one, args): (&str, Vec<&str>) = match only {
            Some(folder) => (" AND n.project = ?1", vec![folder]),
            None => ("", Vec::new()),
        };

        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT n.path, n.project, n.id, n.title, n.icon, n.props FROM notes n
             WHERE n.kind = 'project' AND n.project IS NOT NULL
               AND n.path = 'projects/' || n.project || '/_project.md'{one}
             ORDER BY n.title_key, n.path"
        ))?;
        let mut rows = stmt.query(rusqlite::params_from_iter(&args))?;
        while let Some(r) = rows.next()? {
            let props: String = r.get(5)?;
            out.pages.push(ProjectRow {
                path: r.get(0)?,
                folder: r.get(1)?,
                id: r.get(2)?,
                title: r.get(3)?,
                icon: r.get(4)?,
                props: serde_json::from_str(&props).unwrap_or(Value::Null),
            });
        }

        // Every note that belongs to a project, once: how many each has (its
        // page apart) and the newest, the first path on a tie. Only the
        // winners' titles are read afterwards.
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT n.project, n.path, n.modified FROM notes n
             WHERE n.project IS NOT NULL AND n.kind != 'template'{one}"
        ))?;
        let mut rows = stmt.query(rusqlite::params_from_iter(&args))?;
        while let Some(r) = rows.next()? {
            let project: String = r.get(0)?;
            let path: String = r.get(1)?;
            let modified = r.get::<_, i64>(2)? as u64;
            let is_page = path
                .strip_prefix("projects/")
                .and_then(|rest| rest.strip_prefix(project.as_str()))
                == Some("/_project.md");
            if !is_page {
                *out.notes.entry(project.clone()).or_default() += 1;
            }
            let better = out
                .newest
                .get(&project)
                .is_none_or(|n| modified > n.modified || (modified == n.modified && path < n.path));
            if better {
                out.newest.insert(
                    project,
                    Newest {
                        path,
                        title: String::new(),
                        kind: String::new(),
                        modified,
                    },
                );
            }
        }
        let mut stmt = self
            .conn
            .prepare_cached("SELECT title, kind FROM notes WHERE path = ?1")?;
        for newest in out.newest.values_mut() {
            (newest.title, newest.kind) =
                stmt.query_row([&newest.path], |r| Ok((r.get(0)?, r.get(1)?)))?;
        }

        // The to-do lines, counted per project in the table that holds them.
        let day_and_one = match only {
            Some(_) => " AND n.project = ?2",
            None => "",
        };
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT n.project,
                    SUM(CASE WHEN t.done = 0 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.done != 0 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.done = 0 AND t.due IS NOT NULL AND t.due < ?1 THEN 1 ELSE 0 END)
             FROM tasks t JOIN notes n ON n.num = t.num
             WHERE n.project IS NOT NULL AND n.kind != 'template'{day_and_one}
             GROUP BY n.project"
        ))?;
        let mut rows = match only {
            Some(folder) => stmt.query(params![today, folder])?,
            None => stmt.query(params![today])?,
        };
        while let Some(r) = rows.next()? {
            out.checklist.insert(
                r.get(0)?,
                Counts {
                    open: r.get(1)?,
                    done: r.get(2)?,
                    overdue: r.get(3)?,
                },
            );
        }

        // Task notes, found through the tags' index, so the notes that are
        // none are never touched: done by their status, overdue by their day.
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT n.project, n.props FROM notes n
             WHERE n.num IN (SELECT num FROM tags WHERE tag = 'task')
               AND n.project IS NOT NULL AND n.kind != 'template' AND {NOT_THE_PAGE}{one}"
        ))?;
        let mut rows = stmt.query(rusqlite::params_from_iter(&args))?;
        while let Some(r) = rows.next()? {
            let props: Value = serde_json::from_str(&r.get::<_, String>(1)?).unwrap_or(Value::Null);
            let done = props
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|s| s.trim().eq_ignore_ascii_case("done"));
            let due = props
                .get("due")
                .and_then(Value::as_str)
                .and_then(|d| d.get(..10));
            let counts = out.tasks.entry(r.get(0)?).or_default();
            if done {
                counts.done += 1;
            } else {
                counts.open += 1;
                if due.is_some_and(|d| d < today) {
                    counts.overdue += 1;
                }
            }
        }

        // The newest update, by its `date` property, else the day it was made;
        // the later one made on a tie, the first path after that.
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT n.project, n.path, n.title, n.props, n.created, n.modified FROM notes n
             WHERE n.num IN (SELECT num FROM tags WHERE tag = 'project-update')
               AND n.project IS NOT NULL AND n.kind != 'template' AND {NOT_THE_PAGE}{one}"
        ))?;
        let mut rows = stmt.query(rusqlite::params_from_iter(&args))?;
        let mut best: HashMap<String, (String, u64)> = HashMap::new();
        while let Some(r) = rows.next()? {
            let props: Value = serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or(Value::Null);
            let created: Option<String> = r.get(4)?;
            let date = props
                .get("date")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| created.and_then(|c| c.get(..10).map(str::to_owned)));
            let project: String = r.get(0)?;
            let path: String = r.get(1)?;
            let rank = (date.clone().unwrap_or_default(), r.get::<_, i64>(5)? as u64);
            let wins = match best.get(&project) {
                None => true,
                Some(there) if rank != *there => rank > *there,
                Some(_) => out.updates.get(&project).is_some_and(|u| path < u.path),
            };
            if wins {
                best.insert(project.clone(), rank);
                out.updates.insert(
                    project,
                    Update {
                        path,
                        title: r.get(2)?,
                        date,
                    },
                );
            }
        }
        Ok(out)
    }
}
