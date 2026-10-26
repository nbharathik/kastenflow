//! The LaTeX tools: latex_list, latex_read, latex_edit and latex_build. A
//! document is a folder with a root `.tex` file; the files are named relative
//! to the folder, as the person sees them. Reads change nothing. A change is a
//! source op that goes through the same guardrails as every agent write: a
//! locked document is refused, a change that takes out much of a file waits
//! for review, and the file is written against the text the agent read, so a
//! change a person made meanwhile is kept. The app builds; `latex_build` only
//! reads what the last build said.

use kasten_core::agent::{AgentOp, Session};
use kasten_core::latex::{LastBuild, LatexDoc};
use kasten_core::{Error, Kasten, Result};
use serde_json::{Value, json};

use super::as_json;
use super::lookup::Writes;
use super::write::agent_in;
use crate::params_latex::*;

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

pub(crate) fn latex_list(k: &Kasten) -> Result<Value> {
    let mut docs = k.latex_docs()?;
    for doc in &mut docs {
        doc.locked = k.latex_is_locked(doc);
    }
    let mut out = json!({ "documents": as_json(&docs)? });
    if docs.is_empty() {
        out["note"] = json!(
            "There are no LaTeX documents in this vault yet. A person starts one in the app."
        );
    }
    Ok(out)
}

/// The file `file` of `doc` as a vault path. `file` is relative to the
/// document's folder; the folder in front of it is accepted too.
fn path_in(doc: &LatexDoc, file: &str) -> Result<(String, String)> {
    let named = file.trim().trim_start_matches("./");
    let rel = named
        .strip_prefix(&format!("{}/", doc.folder))
        .unwrap_or(named);
    if rel.is_empty()
        || rel.starts_with(['/', '\\'])
        || rel.contains(['\\', ':', '\0'])
        || rel
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(invalid(format!(
            "“{file}” is not a file of the document {}: name it relative to the document's folder, such as sections/intro.tex",
            doc.title
        )));
    }
    Ok((format!("{}/{rel}", doc.folder), rel.to_owned()))
}

/// The source file at `path`; a file that is not there is said in the
/// document's words.
fn source_of(
    k: &Kasten,
    doc: &LatexDoc,
    path: &str,
    rel: &str,
) -> Result<kasten_core::latex::SourceFile> {
    k.source(path).map_err(|err| match err {
        Error::NotFound(_) => invalid(format!(
            "There is no file {rel} in the document {}. latex_read lists its files",
            doc.title
        )),
        other => other,
    })
}

/// The file a read means: `file`, else the file `doc` itself names, else the root.
fn file_to_read(doc: &LatexDoc, a: &LatexReadArgs) -> Option<String> {
    if let Some(file) = a.file.as_deref().filter(|f| !f.trim().is_empty()) {
        return Some(file.to_owned());
    }
    a.doc
        .trim()
        .strip_prefix(&format!("{}/", doc.folder))
        .filter(|rest| !rest.is_empty())
        .map(str::to_owned)
}

pub(crate) fn latex_read(k: &Kasten, a: LatexReadArgs) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let file = file_to_read(&doc, &a).unwrap_or_else(|| doc.main.clone());
    let (path, rel) = path_in(&doc, &file)?;
    let source = source_of(k, &doc, &path, &rel)?;
    Ok(json!({
        "doc": doc.folder,
        "file": rel,
        "path": source.path,
        "text": source.text,
        "hash": source.hash,
        "locked": k.latex_is_locked(&doc),
        "files": k.latex_files(&doc)?,
    }))
}

/// `text` with its one `search` put right; why not when it is not there once.
fn replaced(text: &str, rel: &str, a: &LatexEditArgs) -> Result<String> {
    if a.search.is_empty() {
        return Err(invalid(
            "search is empty: give the text to replace, exactly as it is in the file",
        ));
    }
    let Some(first) = text.find(&a.search) else {
        return Err(invalid(format!(
            "The text to replace is not in {rel}. Read the file again with latex_read and copy the text exactly, spaces and line breaks included"
        )));
    };
    // A second place counts even when it overlaps the first ("aa" in "aaa").
    let step = text[first..].chars().next().map_or(1, char::len_utf8);
    if text[first + step..].contains(&a.search) {
        let n = text.matches(&a.search).count().max(2);
        return Err(invalid(format!(
            "The text to replace is in {rel} {n} times. Add some of the lines around it so it matches once"
        )));
    }
    Ok(text.replacen(&a.search, &a.replace, 1))
}

pub(crate) fn latex_edit(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: LatexEditArgs,
) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let (path, rel) = path_in(&doc, &a.file)?;
    let current = source_of(k, &doc, &path, &rel)?;
    if current.hash != a.base_hash.trim() {
        return Err(invalid(format!(
            "{rel} changed since you read it, so nothing was written. Read it again with latex_read and redo the change"
        )));
    }
    let text = replaced(&current.text, &rel, &a)?;
    if text == current.text {
        return Err(invalid(
            "replace is the same as search, so there is nothing to change",
        ));
    }
    let op = AgentOp::SaveSource {
        path,
        text,
        base: current.text,
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}

/// The sentence that tells where the build is made.
const BUILD_IN_THE_APP: &str = "Build from the app; this tool reads diagnostics of the last build. KastenFlow builds a LaTeX document while it is open in its window.";

fn build_json(doc: &LatexDoc, last: &LastBuild) -> Result<Value> {
    let mut out = json!({
        "doc": doc.folder,
        "main": doc.main,
        "engine": doc.engine,
        "built": last.built,
    });
    if !last.built {
        out["note"] = json!(format!(
            "There is no build of {} to read yet. {BUILD_IN_THE_APP}",
            doc.title
        ));
        return Ok(out);
    }
    out["stale"] = json!(last.stale);
    out["errors"] = json!(last.errors);
    out["warnings"] = json!(last.warnings);
    out["notes"] = json!(last.notes);
    out["more"] = json!(last.more);
    out["diagnostics"] = as_json(&last.diagnostics)?;
    out["summary"] = json!(match (last.errors, last.warnings) {
        (0, 0) => "The last build had no errors or warnings".to_owned(),
        (e, w) => format!(
            "The last build had {e} error{} and {w} warning{}",
            if e == 1 { "" } else { "s" },
            if w == 1 { "" } else { "s" }
        ),
    });
    if last.stale {
        out["note"] = json!(
            "A file changed after this build, so it may be out of date. The app builds the document while it is open: read this again in a moment."
        );
    }
    Ok(out)
}

pub(crate) fn latex_build(k: &Kasten, a: LatexBuildArgs) -> Result<Value> {
    let doc = k.latex_find_doc(&a.doc)?;
    let last = k.latex_last_build(&doc)?;
    build_json(&doc, &last)
}
