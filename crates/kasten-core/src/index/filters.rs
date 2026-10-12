//! What a search query narrows by besides its words: `tag:` or `#tag`,
//! `project:`, `type:`, the days `before:` and `after:`, the days a note was
//! made or changed (`on:`, `created:`, `updated:`) and the pages below one
//! page (`under:`). Each is read out of the query here and turned into SQL.

use rusqlite::{ToSql, params};

use super::Index;
use crate::dates::{days_in_month, is_real_day};
use crate::error::Result;

/// A span of days, `YYYY-MM-DD`, both ends included; an end left out is open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DateRange {
    pub from: Option<String>,
    pub to: Option<String>,
}

impl DateRange {
    /// A day (`2026-10-06`), a month (`2026-10`), a year (`2026`) or a range
    /// of them, `a..b`, `a..` or `..b`; a month or year reaches its first
    /// and last day. None for anything else.
    pub fn parse(text: &str) -> Option<DateRange> {
        let (from, to) = text.split_once("..").unwrap_or((text, text));
        if from.is_empty() && to.is_empty() {
            return None;
        }
        let from = if from.is_empty() {
            None
        } else {
            Some(bound(from, false)?)
        };
        let to = if to.is_empty() {
            None
        } else {
            Some(bound(to, true)?)
        };
        Some(DateRange { from, to })
    }
}

/// The first (or last) day of a year, month or day.
fn bound(text: &str, last: bool) -> Option<String> {
    let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
    let parts: Vec<&str> = text.split('-').collect();
    match parts.as_slice() {
        [year] if digits(year, 4) && *year != "0000" => {
            Some(format!("{year}-{}", if last { "12-31" } else { "01-01" }))
        }
        [year, month] if digits(year, 4) && digits(month, 2) && *year != "0000" => {
            let number: u32 = month.parse().ok().filter(|m| (1..=12).contains(m))?;
            let day = if last {
                days_in_month(year.parse().ok()?, number)
            } else {
                1
            };
            Some(format!("{year}-{month}-{day:02}"))
        }
        [_, _, _] if is_real_day(text) => Some(text.to_owned()),
        _ => None,
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Filters {
    pub tags: Vec<String>,
    pub project: Option<String>,
    pub kind: Option<String>,
    /// Days, YYYY-MM-DD, compared with the note's own date.
    pub before: Option<String>,
    pub after: Option<String>,
    /// Made, or changed, on these days.
    pub on: Option<DateRange>,
    /// Made on these days (the note's `created`).
    pub created: Option<DateRange>,
    /// Changed on these days: the note's own date, as `before:` reads it.
    pub updated: Option<DateRange>,
    /// A page, by id or path, and every page below it.
    pub under: Option<String>,
}

/// Splits a query into search words (and "quoted phrases") and filters.
pub fn parse_query(query: &str) -> (Vec<String>, Filters) {
    let mut words = Vec::new();
    let mut filters = Filters::default();
    let mut rest = query.trim();
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('"') {
            let (phrase, tail) = after.split_once('"').unwrap_or((after, ""));
            words.push(phrase.to_owned());
            rest = tail.trim_start();
            continue;
        }
        // A path with spaces: `under:"library/my page.md"`.
        if let Some(after) = rest.strip_prefix("under:\"") {
            let (root, tail) = after.split_once('"').unwrap_or((after, ""));
            if !root.is_empty() {
                filters.under = Some(root.to_owned());
            }
            rest = tail.trim_start();
            continue;
        }
        let (token, tail) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
        rest = tail.trim_start();
        let value = |prefix: &str| {
            token
                .strip_prefix(prefix)
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
        };
        let range = |prefix: &str| token.strip_prefix(prefix).and_then(DateRange::parse);
        if let Some(tag) = value("tag:") {
            filters
                .tags
                .push(tag.trim_start_matches('#').to_lowercase());
        } else if let Some(project) = value("project:") {
            filters.project = Some(project.to_lowercase());
        } else if let Some(kind) = value("type:") {
            filters.kind = Some(kind.to_lowercase());
        } else if let Some(day) = value("before:") {
            filters.before = Some(day);
        } else if let Some(day) = value("after:") {
            filters.after = Some(day);
        } else if let Some(days) = range("on:") {
            filters.on = Some(days);
        } else if let Some(days) = range("created:") {
            filters.created = Some(days);
        } else if let Some(days) = range("updated:") {
            filters.updated = Some(days);
        } else if let Some(root) = value("under:") {
            filters.under = Some(root);
        } else if let Some(tag) = token.strip_prefix('#').filter(|t| !t.is_empty()) {
            filters.tags.push(tag.to_lowercase());
        } else {
            words.push(token.to_owned());
        }
    }
    (words, filters)
}

fn push(params: &mut Vec<Box<dyn ToSql>>, value: String) -> usize {
    params.push(Box::new(value));
    params.len()
}

/// A note's `created` that starts with a day, so comparing its first ten
/// characters compares days (a hand-written date may be anything).
const CREATED_DAY: &str = "n.created GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'";

/// `column` inside `range`, with its parameters.
fn within(column: &str, range: &DateRange, params: &mut Vec<Box<dyn ToSql>>) -> String {
    let mut parts = Vec::new();
    if let Some(from) = &range.from {
        parts.push(format!("{column} >= ?{}", push(params, from.clone())));
    }
    if let Some(to) = &range.to {
        parts.push(format!("{column} <= ?{}", push(params, to.clone())));
    }
    parts.join(" AND ")
}

/// The numbers of the page `root` (a note id, or a path with or without
/// `.md`) and every page below it through `parent`. `UNION` drops a row
/// seen before, so a page that is its own ancestor cannot loop forever.
fn subtree(root: usize, root_md: usize) -> String {
    format!(
        "WITH RECURSIVE sub(num, id) AS (
           SELECT num, id FROM notes WHERE id = ?{root} OR path = ?{root} OR path = ?{root_md}
           UNION
           SELECT c.num, c.id FROM notes c JOIN sub s ON c.parent = s.id
         ) SELECT num FROM sub"
    )
}

pub(super) fn filter_sql(filters: &Filters, params: &mut Vec<Box<dyn ToSql>>) -> String {
    let mut sql = String::new();
    for tag in &filters.tags {
        params.push(Box::new(tag.clone()));
        sql.push_str(&format!(
            " AND n.num IN (SELECT num FROM tags WHERE tag = ?{})",
            params.len()
        ));
    }
    if let Some(project) = &filters.project {
        params.push(Box::new(project.clone()));
        sql.push_str(&format!(" AND lower(n.project) = ?{}", params.len()));
    }
    match &filters.kind {
        Some(kind) => {
            params.push(Box::new(kind.clone()));
            sql.push_str(&format!(" AND n.kind = ?{}", params.len()));
        }
        None => sql.push_str(" AND n.kind != 'template'"),
    }
    if let Some(day) = &filters.before {
        params.push(Box::new(day.clone()));
        sql.push_str(&format!(" AND n.day < ?{}", params.len()));
    }
    if let Some(day) = &filters.after {
        params.push(Box::new(day.clone()));
        sql.push_str(&format!(" AND n.day > ?{}", params.len()));
    }
    if let Some(days) = &filters.on {
        let made = within("substr(n.created, 1, 10)", days, params);
        let own = within("n.day", days, params);
        sql.push_str(&format!(" AND (({CREATED_DAY} AND {made}) OR {own})"));
    }
    if let Some(days) = &filters.created {
        let made = within("substr(n.created, 1, 10)", days, params);
        sql.push_str(&format!(" AND ({CREATED_DAY} AND {made})"));
    }
    if let Some(days) = &filters.updated {
        let own = within("n.day", days, params);
        sql.push_str(&format!(" AND {own}"));
    }
    if let Some(root) = &filters.under {
        let by_name = push(params, root.clone());
        let with_extension = push(params, format!("{root}.md"));
        sql.push_str(&format!(
            " AND n.num IN ({})",
            subtree(by_name, with_extension)
        ));
    }
    sql
}

impl Index {
    /// The paths of the page `root` (a note id, or a vault path with or
    /// without `.md`) and every page below it: the page first, then the
    /// others by path. Nothing if there is no such page.
    pub fn under(&self, root: &str) -> Result<Vec<String>> {
        let mut found = self.conn.prepare_cached(&format!(
            "SELECT n.path FROM notes n WHERE n.num IN ({}) ORDER BY n.path",
            subtree(1, 2)
        ))?;
        let rows = found.query_map(params![root, format!("{root}.md")], |r| {
            r.get::<_, String>(0)
        })?;
        let mut paths: Vec<String> = rows.collect::<std::result::Result<_, _>>()?;
        let mut page = self
            .conn
            .prepare_cached("SELECT path FROM notes WHERE id = ?1 OR path = ?1 OR path = ?2")?;
        let first: Option<String> = page
            .query_map(params![root, format!("{root}.md")], |r| r.get(0))?
            .next()
            .transpose()?;
        if let Some(first) = first
            && let Some(at) = paths.iter().position(|p| *p == first)
        {
            let page = paths.remove(at);
            paths.insert(0, page);
        }
        Ok(paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(from: Option<&str>, to: Option<&str>) -> Option<DateRange> {
        Some(DateRange {
            from: from.map(str::to_owned),
            to: to.map(str::to_owned),
        })
    }

    #[test]
    fn reads_a_day_a_month_a_year_or_a_range() {
        let parse = DateRange::parse;
        assert_eq!(
            parse("2026-10-06"),
            range(Some("2026-10-06"), Some("2026-10-06"))
        );
        assert_eq!(
            parse("2026-10"),
            range(Some("2026-10-01"), Some("2026-10-31"))
        );
        assert_eq!(
            parse("2026-02"),
            range(Some("2026-02-01"), Some("2026-02-28"))
        );
        assert_eq!(
            parse("2024-02"),
            range(Some("2024-02-01"), Some("2024-02-29"))
        );
        assert_eq!(parse("2026"), range(Some("2026-01-01"), Some("2026-12-31")));
        assert_eq!(
            parse("2026-09-01..2026-09-30"),
            range(Some("2026-09-01"), Some("2026-09-30"))
        );
        assert_eq!(
            parse("2026-09..2026-10"),
            range(Some("2026-09-01"), Some("2026-10-31"))
        );
        assert_eq!(parse("2026-10-01.."), range(Some("2026-10-01"), None));
        assert_eq!(parse("..2026-09"), range(None, Some("2026-09-30")));
        for bad in [
            "",
            "..",
            "soon",
            "2026-13",
            "2026-00",
            "2026-02-30",
            "26-10-06",
            "2026-1",
            "0000",
            "2026-10-06...2026-10-09",
            "2026-10-06..x",
            "2026-10-06-1",
            "2026/10",
        ] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn parses_filters_and_phrases() {
        let (words, filters) = parse_query(
            "tag:Paper #idea project:Photo-Organiser type:card before:2026-10-01 \"old notes\" diff",
        );
        assert_eq!(words, ["old notes", "diff"]);
        assert_eq!(filters.tags, ["paper", "idea"]);
        assert_eq!(filters.project.as_deref(), Some("photo-organiser"));
        assert_eq!(filters.kind.as_deref(), Some("card"));
        assert_eq!(filters.before.as_deref(), Some("2026-10-01"));
    }

    #[test]
    fn parses_date_and_page_filters() {
        let (words, filters) = parse_query(
            "plan on:2026-10-06 created:2026-10 updated:2026-09-01..2026-09-30 under:01HXABC",
        );
        assert_eq!(words, ["plan"]);
        assert_eq!(filters.on, range(Some("2026-10-06"), Some("2026-10-06")));
        assert_eq!(
            filters.created,
            range(Some("2026-10-01"), Some("2026-10-31"))
        );
        assert_eq!(
            filters.updated,
            range(Some("2026-09-01"), Some("2026-09-30"))
        );
        assert_eq!(filters.under.as_deref(), Some("01HXABC"));
        // Ids and paths keep their case.
        let (_, filters) = parse_query("under:Library/My-Page.md");
        assert_eq!(filters.under.as_deref(), Some("Library/My-Page.md"));
        let (words, filters) = parse_query("under:\"library/my page.md\" notes");
        assert_eq!(filters.under.as_deref(), Some("library/my page.md"));
        assert_eq!(words, ["notes"]);
    }

    #[test]
    fn a_value_that_is_not_a_date_or_not_there_is_a_word() {
        let (words, filters) = parse_query("on:soon created:2026-13 updated: under: created:..");
        assert_eq!(
            words,
            [
                "on:soon",
                "created:2026-13",
                "updated:",
                "under:",
                "created:.."
            ]
        );
        assert_eq!(filters, Filters::default());
    }
}
