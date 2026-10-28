//! The tools that make a LaTeX document and write, add to and take out its
//! files: latex_create_document, latex_write_file, latex_append and
//! latex_delete_file. Each is one agent op, so each goes through the same
//! guardrails and agent modes as every agent write (a locked document is
//! refused, much taken out of a file waits for review, a new document waits in
//! a project on review) and is one change in the agent's session.

use kasten_core::agent::{AgentOp, Session};
use kasten_core::{Error, Kasten, Result};
use serde_json::{Value, json};

use super::latex::{path_in, source_of};
use super::lookup::Writes;
use super::write::agent_in;
use crate::params_latex_files::*;

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

/// `text` when it says something: none for a blank or missing value.
fn given(text: Option<String>) -> Option<String> {
    text.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty())
}

pub(crate) fn latex_create_document(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexCreateDocumentArgs,
) -> Result<Value> {
    let op = AgentOp::CreateLatexDoc {
        title: a.title,
        template: a.template.unwrap_or_default(),
        project: given(a.project),
        reason: a.reason,
    };
    agent_in(k, s, writes, |_| Ok(op))
}

pub(crate) fn latex_write_file(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexWriteFileArgs,
) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let (path, rel) = path_in(&doc, &a.file)?;
    let base = match given(a.base_hash) {
        // A new file: it must not be there yet.
        None => {
            if k.source(&path).is_ok() {
                return Err(invalid(format!(
                    "There is already a file {rel} in the document {}. Read it with latex_read and send its hash as base_hash to replace it, or use latex_edit or latex_append",
                    doc.title
                )));
            }
            String::new()
        }
        Some(hash) => {
            let current = source_of(k, &doc, &path, &rel)?;
            if current.hash != hash {
                return Err(invalid(format!(
                    "{rel} changed since you read it, so nothing was written. Read it again with latex_read and redo the change"
                )));
            }
            current.text
        }
    };
    let op = AgentOp::SaveSource {
        path,
        text: a.text,
        base,
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}

pub(crate) fn latex_append(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexAppendArgs,
) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let (path, rel) = path_in(&doc, &a.file)?;
    let current = source_of(k, &doc, &path, &rel)?;
    if current.hash != a.base_hash.trim() {
        return Err(invalid(format!(
            "{rel} changed since you read it, so nothing was written. Read it again with latex_read and redo the change"
        )));
    }
    let op = AgentOp::AppendLatexFile {
        path,
        base_hash: current.hash,
        text: a.text,
        after: a.after,
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}

pub(crate) fn latex_delete_file(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexDeleteFileArgs,
) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let (path, rel) = path_in(&doc, &a.file)?;
    // The file has to be there: a name that is not a file of the document is told so.
    if !k.latex_files(&doc)?.contains(&rel) {
        return Err(invalid(format!(
            "There is no file {rel} in the document {}. latex_read lists its files",
            doc.title
        )));
    }
    let op = AgentOp::TrashLatexFile {
        path,
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}
