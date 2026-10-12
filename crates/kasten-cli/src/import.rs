//! `kasten import` and `kasten undo`: notes from Obsidian, a Markdown
//! folder, a Notion export or a Heptabase backup moved in as one commit,
//! and one commit (such as an import) taken back.

use std::path::PathBuf;

use kasten_core::Instant;
use kasten_core::history::Actor;
use kasten_core::import::{ImportKind, ImportOptions, ImportSummary};

use crate::args::Args;
use crate::commands::{Outcome, json_text, open};
use crate::show::say;

fn kind(name: &str) -> Result<ImportKind, String> {
    match name.to_lowercase().as_str() {
        "obsidian" => Ok(ImportKind::Obsidian),
        "markdown" | "md" => Ok(ImportKind::Markdown),
        "notion" => Ok(ImportKind::Notion),
        "heptabase" => Ok(ImportKind::Heptabase),
        other => Err(format!(
            "Not a kind of import: {other} (obsidian, markdown, notion or heptabase)"
        )),
    }
}

/// "8 notes, 2 journal days, 1 board, 3 files"
fn counts(s: &ImportSummary) -> String {
    let parts: Vec<String> = [
        (s.notes, "note", "notes"),
        (s.days + s.days_appended, "journal day", "journal days"),
        (s.boards, "board", "boards"),
        (s.files, "file", "files"),
        (s.tags, "tag", "tags"),
    ]
    .into_iter()
    .filter(|(n, _, _)| *n > 0)
    .map(|(n, one, many)| format!("{n} {}", if n == 1 { one } else { many }))
    .collect();
    if parts.is_empty() {
        "nothing".to_owned()
    } else {
        parts.join(", ")
    }
}

fn article(kind: ImportKind) -> String {
    let label = kind.label();
    let a = if label.starts_with(['A', 'E', 'I', 'O', 'U']) {
        "an"
    } else {
        "a"
    };
    format!("{a} {label}")
}

/// `kasten import FOLDER [--kind K] [--project TITLE] [--dry-run]`
pub fn import(args: &Args) -> Outcome {
    let source = args
        .positional
        .get(1)
        .map(PathBuf::from)
        .ok_or_else(|| format!("Which folder? {} import FOLDER [--kind obsidian|markdown|notion|heptabase] [--project TITLE] [--dry-run]", crate::program()))?;
    let options = ImportOptions {
        kind: args.value("--kind").map(kind).transpose()?,
        project: args.value("--project").map(str::to_owned),
    };
    let kasten = open(args)?;
    let now = Instant::now();
    if args.has("--dry-run") {
        let plan = kasten
            .plan_import(&source, &options, now)
            .map_err(|e| e.to_string())?;
        if args.has("--json") {
            say!("{}", json_text(serde_json::json!(plan)));
            return Ok(0);
        }
        say!(
            "Would import {} into “{}”: {}.",
            article(plan.kind),
            plan.project,
            counts(&plan)
        );
        for warning in &plan.warnings {
            say!("  {warning}");
        }
        return Ok(0);
    }
    let done = kasten
        .import(&Actor::Human, &source, &options, now)
        .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!("{}", json_text(serde_json::json!(done)));
        return Ok(0);
    }
    let s = &done.summary;
    say!(
        "Imported {} into “{}” ({}): {}.",
        article(s.kind),
        s.project,
        s.project_path,
        counts(s)
    );
    for warning in &s.warnings {
        say!("  {warning}");
    }
    if let Some(commit) = &done.commit {
        say!("Undo it with: {} undo {commit}", crate::program());
    }
    Ok(0)
}

/// `kasten undo COMMIT`
pub fn undo(args: &Args) -> Outcome {
    let rev = args
        .positional
        .get(1)
        .ok_or_else(|| format!("Which commit? {} undo COMMIT", crate::program()))?;
    let kasten = open(args)?;
    let undone = kasten
        .undo_commit(rev, Instant::now())
        .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!("{}", json_text(serde_json::json!(undone)));
    } else if let Some(conflict) = &undone.conflict {
        say!(
            "Nothing undone: {} ({}) changed after “{}”.",
            conflict.path,
            conflict.detail,
            conflict.summary
        );
    } else {
        let log = kasten.log(None, 1).map_err(|e| e.to_string())?;
        let summary = log.first().map_or("", |c| c.summary.as_str());
        say!("Undid “{}”.", summary.trim_start_matches("undo: "));
    }
    Ok(if undone.conflict.is_some() { 1 } else { 0 })
}
