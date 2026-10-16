//! Checks on a diagram, in the manner of the Slides lint: each rule says
//! which cell, what is wrong and what to do, rules that were not run are
//! listed in `skipped`, and a report counts errors, warnings and notes.
//! Checks that need to know where an edge runs estimate it from the middles
//! of its ends and its waypoints, and say so.

mod crossings;
mod geometry;
mod rules;
mod style_rules;

#[cfg(test)]
mod tests;

use serde::Serialize;

use super::model::{Doc, Page};
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// One finding.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Issue {
    pub rule: &'static str,
    pub severity: Severity,
    /// The page it is on.
    pub page: String,
    /// The cell, when it is about one.
    pub cell: Option<String>,
    pub message: String,
    pub hint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Report {
    pub issues: Vec<Issue>,
    pub errors: usize,
    pub warnings: usize,
    pub infos: usize,
    /// Rules that were not run, and why.
    pub skipped: Vec<String>,
}

/// More than this many nodes on a page is a warning; more than twice, an error.
pub const MANY_NODES: usize = 40;
pub const TOO_MANY_NODES: usize = 120;
/// Above this many edges the crossing checks are skipped.
pub const MAX_EDGES_CHECKED: usize = 400;

/// What the rules collect.
pub(crate) struct Sink<'a> {
    pub page: &'a Page,
    pub issues: Vec<Issue>,
    pub skipped: Vec<String>,
}

impl Sink<'_> {
    pub fn add(
        &mut self,
        rule: &'static str,
        severity: Severity,
        cell: Option<&str>,
        message: String,
        hint: &str,
    ) {
        self.issues.push(Issue {
            rule,
            severity,
            page: self.page.name.clone(),
            cell: cell.map(str::to_owned),
            message,
            hint: hint.to_owned(),
        });
    }
}

/// Checks the diagram in `xml`; `page` limits it to one page.
pub fn lint(xml: &str, page: Option<&str>) -> Result<Report> {
    let doc = Doc::parse(xml)?;
    let only = page.map(|p| doc.find_page(Some(p))).transpose()?;
    let mut issues = Vec::new();
    let mut skipped = Vec::new();
    for (i, p) in doc.pages.iter().enumerate() {
        if only.is_some_and(|o| o != i) {
            continue;
        }
        let mut sink = Sink {
            page: p,
            issues: Vec::new(),
            skipped: Vec::new(),
        };
        rules::run(&mut sink);
        style_rules::run(&mut sink);
        crossings::run(&mut sink);
        issues.extend(sink.issues);
        skipped.extend(sink.skipped.into_iter().map(|s| format!("{}: {s}", p.name)));
    }
    issues.sort_by_key(|a| a.severity);
    let count = |s: Severity| issues.iter().filter(|i| i.severity == s).count();
    Ok(Report {
        errors: count(Severity::Error),
        warnings: count(Severity::Warning),
        infos: count(Severity::Info),
        issues,
        skipped,
    })
}

impl Report {
    /// The report in a line: `2 errors, 1 warning, 3 notes`.
    pub fn line(&self) -> String {
        let n =
            |n: usize, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
        format!(
            "{}, {}, {}",
            n(self.errors, "error", "errors"),
            n(self.warnings, "warning", "warnings"),
            n(self.infos, "note", "notes")
        )
    }
}
