//! What a build says to the agent that asked: errors and warnings with file
//! and line, the pages and size of the PDF, how long it took, and one plain
//! sentence on how it went.

use kasten_core::Kasten;
use kasten_core::latex::{Diagnostic, LatexDoc, Severity};
use serde_json::{Value, json};

use super::pages::page_count;
use crate::plugins::latex::build::{built_places, stem_of};
use crate::plugins::latex::collect::{pdf_path, pdf_stamp};
use crate::plugins::latex::service::{Ended, Outcome};

/// The most errors, warnings and notes listed one by one.
const MOST_ERRORS: usize = 100;
const MOST_WARNINGS: usize = 100;
const MOST_NOTES: usize = 10;
/// How many errors carry the context TeX printed after them.
const MOST_CONTEXTS: usize = 10;
/// The longest message passed on.
const MAX_MESSAGE: usize = 500;

fn plural(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

fn listed(d: &Diagnostic) -> Value {
    let severity = match d.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
        Severity::Info => "note",
    };
    json!({
        "severity": severity,
        "file": d.file,
        "line": d.line,
        "message": d.message.chars().take(MAX_MESSAGE).collect::<String>(),
    })
}

/// The size of the document's built PDF and its pages, when it has one.
pub fn pdf_facts(kasten: &Kasten, doc: &LatexDoc) -> (Option<u64>, Option<u32>) {
    let Some((_, out)) = built_places(kasten.root(), &doc.folder) else {
        return (None, None);
    };
    let stem = stem_of(&doc.main);
    let size = pdf_stamp(&pdf_path(&out, &stem)).map(|(len, _)| len);
    (size, size.and(page_count(&out, &stem)))
}

/// The answer to a build request that ran to its end.
pub fn built(kasten: &Kasten, doc: &LatexDoc, outcome: &Outcome) -> Value {
    describe(kasten, doc, outcome, None)
}

/// The answer to a preview build: the same count of errors and warnings, said
/// to be of the text in `files` (waiting for review), not of the saved files.
/// There is no PDF to tell of: the preview keeps none.
pub fn built_preview(
    kasten: &Kasten,
    doc: &LatexDoc,
    outcome: &Outcome,
    files: &[String],
) -> Value {
    describe(kasten, doc, outcome, Some(files))
}

fn describe(
    kasten: &Kasten,
    doc: &LatexDoc,
    outcome: &Outcome,
    preview: Option<&[String]>,
) -> Value {
    let of = |severity: Severity| {
        outcome
            .diagnostics
            .iter()
            .filter(move |d| d.severity == severity)
    };
    let (errors, warnings, notes) = (
        of(Severity::Error).count(),
        of(Severity::Warning).count(),
        of(Severity::Info).count(),
    );
    let mut shown: Vec<Value> = Vec::new();
    shown.extend(
        of(Severity::Error)
            .take(MOST_ERRORS)
            .enumerate()
            .map(|(at, d)| {
                let mut one = listed(d);
                // What TeX printed where it stopped, for the first few: enough to see the cause.
                if at < MOST_CONTEXTS
                    && let Some(context) = &d.context
                {
                    one["context"] = json!(context);
                }
                one
            }),
    );
    shown.extend(of(Severity::Warning).take(MOST_WARNINGS).map(listed));
    shown.extend(of(Severity::Info).take(MOST_NOTES).map(listed));
    let succeeded = outcome.ended == Ended::Done;
    let (size, pages) = if succeeded && preview.is_none() {
        pdf_facts(kasten, doc)
    } else {
        (None, None)
    };
    let summary = match (succeeded, errors, warnings) {
        (true, 0, 0) => "The build worked, with no errors or warnings".to_owned(),
        (true, 0, w) => format!("The build worked, with {}", plural(w, "warning")),
        (_, 0, _) => outcome.error.as_ref().map_or_else(
            || "The build failed".to_owned(),
            |err| format!("The build failed: {}", err.message),
        ),
        (_, e, w) => format!(
            "The build had {} and {}",
            plural(e, "error"),
            plural(w, "warning")
        ),
    };
    let mut told = json!({
        "doc": doc.folder,
        "built": true,
        "succeeded": succeeded,
        "errors": errors,
        "warnings": warnings,
        "notes": notes,
        "more": (errors + warnings + notes).saturating_sub(shown.len()),
        "diagnostics": shown,
        "pages": pages,
        "pdf_bytes": size,
        "build_ms": outcome.ms,
        "summary": summary,
    });
    if let Some(err) = &outcome.error {
        told["problem"] = json!(err.message);
    }
    if let Some(advice) = kasten.latex_engine_advice(doc, &outcome.diagnostics) {
        told["engine_advice"] = json!(advice);
    }
    if let Some(files) = preview {
        told["preview"] = json!(true);
        told["proposed_files"] = json!(files);
        told["summary"] = json!(format!(
            "Preview of your changes that wait for review (nothing is saved): {}",
            told["summary"].as_str().unwrap_or_default()
        ));
        told["note"] = json!(
            "This built the text you proposed in a scratch folder. The saved files, and the PDF in the app, are unchanged until the user accepts the changes."
        );
    }
    told
}
