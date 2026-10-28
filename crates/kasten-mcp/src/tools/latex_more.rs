//! The tools that bring things into a LaTeX document: a picture
//! (latex_add_asset), a citation of a Reference (latex_cite) and a page or one
//! of its sections (latex_send_page). Each is one agent op, so each goes
//! through the guardrails and agent modes of every agent write (a locked
//! document is refused, Review holds a citation and a sent page) and is one
//! change in the agent's session. Kasten never runs a program to make a
//! picture: the client makes it and sends the PNG.

use kasten_core::agent::{AgentOp, Session};
use kasten_core::{Kasten, Result};
use serde_json::{Value, json};

use super::latex::path_in;
use super::lookup::Writes;
use super::write::agent_in;
use crate::params_latex_more::*;

/// `text` when it says something: none for a blank or missing value.
fn given(text: Option<String>) -> Option<String> {
    text.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty())
}

pub(crate) fn latex_add_asset(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexAddAssetArgs,
) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let op = AgentOp::AddLatexAsset {
        doc: doc.folder,
        name: a.name,
        base64: given(a.base64),
        vault_path: given(a.vault_path),
        reason: a.reason,
    };
    agent_in(k, s, writes, |_| Ok(op))
}

pub(crate) fn latex_cite(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexCiteArgs,
) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let (path, rel) = path_in(&doc, &a.file)?;
    let op = AgentOp::CiteReference {
        doc: doc.folder,
        file: path,
        key: a.key,
        at: a.at,
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}

pub(crate) fn latex_send_page(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexSendPageArgs,
) -> Result<Value> {
    let doc = a
        .doc
        .as_deref()
        .filter(|d| !d.trim().is_empty())
        .map(|d| k.latex_find_doc(d))
        .transpose()?
        .map(|doc| doc.folder);
    agent_in(k, s, writes, |lookup| {
        Ok(AgentOp::SendPageToLatex {
            page: lookup.resolve(&a.page)?,
            section: given(a.section),
            doc,
            title: given(a.title),
            template: a.template.unwrap_or_default(),
            project: given(a.project),
            reason: a.reason,
        })
    })
}
