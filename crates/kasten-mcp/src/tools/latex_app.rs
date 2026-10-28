//! The LaTeX tools that need the desktop app: building a document now
//! (`latex_build` with `wait`) and keeping its PDF (`latex_export_pdf`). The
//! MCP server runs no TeX: it asks the app through the vault's mailbox
//! (kasten-core's `bridge`) and waits. The app is the one that builds, with its
//! own engine and sandbox rules, and that keeps the PDF (an agent op, so the
//! agent modes hold, in the agent's session); the PDF's bytes never pass
//! through here. When the app is closed, or does not answer in time, the
//! answer says so in one sentence.

use std::time::Duration;

use kasten_core::agent::{AgentOp, Session};
use kasten_core::bridge::{Answer, Call, MAX_WAIT_MS};
use kasten_core::latex::LatexDoc;
use kasten_core::{Error, Kasten, Result};
use serde_json::{Value, json};

use super::lookup::Writes;
use super::write::agent_in;
use crate::bridge::mailbox_of;
use crate::params_latex::LatexExportPdfArgs;

/// How long a build is waited for unless the caller says, and the most it may be.
pub(crate) const DEFAULT_WAIT_SECS: u64 = 90;
pub(crate) const MAX_WAIT_SECS: u64 = MAX_WAIT_MS / 1000;
/// The least a caller can ask to wait.
const MIN_WAIT_SECS: u64 = 1;
/// How long keeping a PDF is waited for: a build if one is needed, then the write.
const EXPORT_WAIT: Duration = Duration::from_secs(150);

pub(crate) const APP_CLOSED: &str =
    "The app is closed. Open KastenFlow on this vault and ask again: building needs the app open.";
pub(crate) const BUILD_TIMED_OUT: &str = "The build did not finish in time. It may still be running in the app: read the last build in a moment, or ask again with a longer timeout_seconds.";
const EXPORT_TIMED_OUT: &str =
    "The PDF was not kept in time: the app did not answer. Check that it is open, then ask again.";

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

/// What came back from the app as the tool's answer or a plain error.
fn answered(answer: Answer, timed_out: &str) -> Result<Value> {
    match answer {
        Answer::AppClosed => Err(invalid(APP_CLOSED)),
        Answer::TimedOut => Err(invalid(timed_out)),
        Answer::Reply(reply) if reply.ok => Ok(reply.result),
        Answer::Reply(reply) => Err(invalid(
            reply
                .error
                .unwrap_or_else(|| "The app could not do that".to_owned()),
        )),
    }
}

/// The time to wait a build: `seconds` or the default, within the limits.
pub(crate) fn wait_for(seconds: Option<u64>) -> Duration {
    Duration::from_secs(
        seconds
            .unwrap_or(DEFAULT_WAIT_SECS)
            .clamp(MIN_WAIT_SECS, MAX_WAIT_SECS),
    )
}

/// Asks the app to build `doc` now and waits up to `timeout` for the result.
/// The app is told to stop waiting a little earlier, so it can say that the
/// build is still going before this gives up.
pub(crate) fn build_and_wait(
    k: &Kasten,
    session: Option<&Session>,
    doc: &LatexDoc,
    timeout: Duration,
) -> Result<Value> {
    let wait_ms = (timeout.as_millis() as u64)
        .saturating_sub(2_000)
        .max(1_000);
    let call = Call::LatexBuild {
        doc: doc.folder.clone(),
        wait_ms,
    };
    let answer = mailbox_of(k)?.ask(&call, session, timeout)?;
    let mut out = answered(answer, BUILD_TIMED_OUT)?;
    out["main"] = json!(doc.main);
    out["engine"] = json!(doc.engine);
    out["waited"] = json!(true);
    Ok(out)
}

pub(crate) fn latex_export_pdf(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexExportPdfArgs,
) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    if k.latex_is_locked(&doc) {
        return Err(invalid(format!(
            "“{}” is locked: read-only for agents. Ask the owner to unlock it in the document's settings",
            doc.title
        )));
    }
    let mailbox = mailbox_of(k)?;
    let mut out = match writes {
        // The app builds if it must and keeps the PDF in this session.
        Writes::Direct => {
            let call = Call::LatexExportPdf {
                doc: doc.folder.clone(),
                reason: a.reason.map(|r| r.chars().take(300).collect()),
            };
            answered(mailbox.ask(&call, Some(s), EXPORT_WAIT)?, EXPORT_TIMED_OUT)?
        }
        // A chat that previews its changes: the app builds, and keeping the PDF waits with the rest.
        Writes::Staged(_) => {
            build_and_wait(k, Some(s), &doc, wait_for(None))?;
            let op = AgentOp::ExportLatexPdf {
                doc: doc.folder.clone(),
                reason: a.reason,
            };
            agent_in(k, s, writes, |_| Ok(op))?
        }
    };
    out["doc"] = json!(doc.folder);
    Ok(out)
}
