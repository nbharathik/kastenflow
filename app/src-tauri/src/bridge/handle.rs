//! What the app does for a request from the mailbox. The request has been read
//! and checked by the core (it names a place inside the vault and nothing
//! else), and is checked again here: the plugin is on, the folder is a LaTeX
//! document of this vault. A build is the app's own (its engine, its sandbox
//! rules); keeping the PDF is the core's agent op, which reads the PDF from the
//! build cache itself, so what comes from the asker is never a path or a byte.

use std::time::Duration;

use kasten_core::agent::{AgentOp, Session};
use kasten_core::bridge::{Call, MAX_WAIT_MS, Request};
use kasten_core::latex::{LatexDoc, pdf_path as export_path};
use kasten_core::{Instant, Kasten};
use serde_json::{Value, json};

use super::report;
use super::side::Side;
use crate::plugins::latex::build::{built_places, stem_of};
use crate::plugins::latex::collect::{pdf_path, pdf_stamp};
use crate::plugins::latex::service::Ended;

/// How long keeping a PDF waits for a build it has to make first.
const BUILD_FOR_EXPORT: Duration = Duration::from_secs(150);
/// The least a build request waits.
const MIN_WAIT_MS: u64 = 1_000;

/// How long a client's ask for the selection waits for the window's first
/// word on it, so the file it reads next is not the one before.
const SELECTION_WAIT: Duration = Duration::from_millis(2_500);

/// The answer to `call` from `request`: a result, or one sentence for why not.
pub fn handle(side: &dyn Side, request: Request, call: Call) -> Result<Value, String> {
    match call {
        Call::DiagramPng { diagram, page } => super::diagram::png(side, &diagram, page.as_deref()),
        Call::WatchSelection {} => watch_selection(side),
        call => latex(side, request, call),
    }
}

/// Shares the selection for two minutes more, and waits for the window to
/// publish it (it does so at once when it is shared anew).
fn watch_selection(side: &dyn Side) -> Result<Value, String> {
    let asked = Instant::now().millis;
    side.share_selection(asked)?;
    let started = std::time::Instant::now();
    while !side.selection_published_since(asked) && started.elapsed() < SELECTION_WAIT {
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(json!({
        "shared": true,
        "for_seconds": kasten_core::bridge::WATCH_MS / 1000,
        "published": side.selection_published_since(asked),
    }))
}

/// The LaTeX requests: building a document and keeping its PDF.
fn latex(side: &dyn Side, request: Request, call: Call) -> Result<Value, String> {
    side.latex_on()?;
    let kasten = side.kasten()?;
    let doc = document(&kasten, call.doc())?;
    match call {
        Call::LatexBuild {
            wait_ms, preview, ..
        } => {
            let wait = Duration::from_millis(wait_ms.clamp(MIN_WAIT_MS, MAX_WAIT_MS));
            // Changes that wait for review are built where they cannot touch the files or the last good PDF.
            if preview
                && let Some(session) = &request.session
                && let Some(done) = preview_build(side, &kasten, &doc, &session.id, wait)?
            {
                return Ok(done);
            }
            let outcome = side.build(&doc, wait)?;
            if outcome.ended == Ended::Cancelled {
                return Err(
                    "The build was replaced by a newer one in the app: ask again".to_owned(),
                );
            }
            Ok(report::built(&kasten, &doc, &outcome))
        }
        Call::LatexExportPdf { reason, .. } => export(side, &kasten, &doc, request.session, reason),
        _ => Err("The app does not know how to do that".to_owned()),
    }
}

/// The answer for a build of what the waiting changes of `session` would make
/// of `doc`; none when it has no waiting changes (the saved files are then
/// what there is to build).
fn preview_build(
    side: &dyn Side,
    kasten: &Kasten,
    doc: &LatexDoc,
    session: &str,
    wait: Duration,
) -> Result<Option<Value>, String> {
    let files = kasten
        .latex_proposed(&doc.folder, session)
        .map_err(|err| err.to_string())?;
    if files.is_empty() {
        return Ok(None);
    }
    let names: Vec<String> = files.keys().cloned().collect();
    let made = side.build_preview(doc, files.into_iter().collect(), wait)?;
    if made.outcome.ended == Ended::Cancelled {
        return Err("The preview build was stopped: ask again".to_owned());
    }
    if made.outcome.ended == Ended::Failed
        && made.fetched_packages
        && made
            .outcome
            .error
            .as_ref()
            .is_some_and(|e| e.kind == "timeout")
    {
        return Err(super::side::STILL_FETCHING.to_owned());
    }
    Ok(Some(report::built_preview(
        kasten,
        doc,
        &made.outcome,
        &names,
    )))
}

/// The LaTeX document whose folder is `folder`, among this vault's.
fn document(kasten: &Kasten, folder: &str) -> Result<LatexDoc, String> {
    let folder = folder.trim_end_matches('/');
    kasten
        .latex_docs()
        .map_err(|err| err.to_string())?
        .into_iter()
        .find(|d| d.folder == folder)
        .ok_or_else(|| "That folder is not a LaTeX document of this vault".to_owned())
}

/// Whether the document must be built before its PDF is kept: there is no
/// PDF yet, or a source file is newer than it.
fn needs_build(kasten: &Kasten, doc: &LatexDoc) -> bool {
    let Some((_, out)) = built_places(kasten.root(), &doc.folder) else {
        return true;
    };
    let Some((_, made)) = pdf_stamp(&pdf_path(&out, &stem_of(&doc.main))) else {
        return true;
    };
    let base = kasten.root().join(&doc.folder);
    kasten.latex_files(doc).map_or(true, |files| {
        files.iter().any(|file| {
            std::fs::metadata(base.join(file))
                .and_then(|m| m.modified())
                .is_ok_and(|changed| changed > made)
        })
    })
}

fn export(
    side: &dyn Side,
    kasten: &Kasten,
    doc: &LatexDoc,
    session: Option<Session>,
    reason: Option<String>,
) -> Result<Value, String> {
    let session = session.ok_or(
        "The request does not say whose it is, so the PDF cannot be kept in anyone's name",
    )?;
    if needs_build(kasten, doc) {
        let outcome = side.build(doc, BUILD_FOR_EXPORT)?;
        match outcome.ended {
            Ended::Done => {}
            Ended::Cancelled => {
                return Err(
                    "The build was replaced by a newer one in the app: ask again".to_owned(),
                );
            }
            Ended::Failed => {
                let said = report::built(kasten, doc, &outcome);
                return Err(format!(
                    "There is no new PDF to keep. {}. Fix the errors (latex_build says where) and ask again",
                    said["summary"].as_str().unwrap_or("The build failed")
                ));
            }
        }
    }
    let op = AgentOp::ExportLatexPdf {
        doc: doc.folder.clone(),
        reason: reason
            .map(|r| r.trim().to_owned())
            .filter(|r| !r.is_empty())
            .or_else(|| Some("Kept at the agent's request".to_owned())),
    };
    let outcome = kasten
        .agent_run(&session, &op, Instant::now())
        .map_err(|err| err.to_string())?;
    let mut told = serde_json::to_value(&outcome).map_err(|err| err.to_string())?;
    let (size, pages) = report::pdf_facts(kasten, doc);
    told["session"] = json!(session.id);
    told["pages"] = json!(pages);
    told["size_bytes"] = json!(size);
    told["pdf_path"] = json!(export_path(doc));
    if told["status"] == "done" {
        told["path"] = told["result"]["path"].clone();
    }
    Ok(told)
}
