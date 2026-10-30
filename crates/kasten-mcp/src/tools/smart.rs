//! The smart page tools: smart_create, smart_read, smart_edit, smart_write_file,
//! smart_delete_file and smart_render (smart_check is in `smart_check`). A
//! smart page is a page with `layout: smart` and a folder of code beside it.
//! Reads change nothing. Every change is an agent op, so the page's lock keeps
//! an agent out, Review holds the change for the person, a file changed since
//! it was read is never written over, and Undo takes a session's work back.
//! The tools work whether or not the person has smart pages running in the
//! app; only drawing needs the app.

use kasten_core::agent::{AgentOp, Session, SmartNewFile};
use kasten_core::frontmatter::{read_map, split};
use kasten_core::smart::{
    INDEX_FILE, MANIFEST_FILE, SMART_LAYOUT, SmartManifest, check_path, is_text_file, manifest_text,
};
use kasten_core::{Error, Kasten, NoteFile, Result};
use serde_json::{Value, json};

use super::as_json;
use super::lookup::Writes;
use super::write::agent_in;
use super::{smart_data, smart_errors};
use crate::params_smart::*;

/// How much file text one `smart_read` carries; the rest is read by name.
const TEXT_BUDGET: usize = 60_000;
/// How many files one `smart_read` lists (a folder filled by hand may hold thousands).
const FILES_SHOWN: usize = 200;

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

/// The smart page `reference` names (its id, title or path); why not when it
/// is not one.
pub(super) fn smart_page(k: &Kasten, reference: &str) -> Result<NoteFile> {
    let note = k.read(&k.resolve(reference)?)?;
    // Off for the page's project (else the vault): the agent is told to ask the person.
    k.smart_gate_page(&note.meta.path)?;
    let layout = read_map(split(&note.text).prefix).ok().and_then(|keys| {
        keys.get("layout")
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    if layout.as_deref() != Some(SMART_LAYOUT) {
        return Err(invalid(format!(
            "“{}” is not a smart page: its layout is not “{SMART_LAYOUT}”. smart_create makes one; only a person turns an existing page into one",
            note.meta.title
        )));
    }
    Ok(note)
}

/// A file name as the page's folder keeps it.
fn rel_of(file: &str) -> Result<String> {
    let named = file.trim().trim_start_matches("./");
    check_path(named)?;
    Ok(named.to_owned())
}

/// The file of the page, or why there is none.
fn file_of(k: &Kasten, note: &NoteFile, rel: &str) -> Result<kasten_core::smart::SmartBytes> {
    k.smart_file(&note.meta.path, rel).map_err(|err| match err {
        Error::NotFound(_) => invalid(format!(
            "There is no file {rel} in the page “{}”. smart_read lists its files",
            note.meta.title
        )),
        other => other,
    })
}

pub(crate) fn smart_create(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: SmartCreateArgs,
) -> Result<Value> {
    let mut files: Vec<SmartNewFile> = a
        .files
        .iter()
        .map(|f| SmartNewFile {
            path: f.path.trim().trim_start_matches("./").to_owned(),
            content: f.content.clone(),
        })
        .collect();
    let own_manifest = files.iter().any(|f| f.path == MANIFEST_FILE);
    if own_manifest && (a.queries.is_some() || a.views.is_some()) {
        return Err(invalid(
            "Give the queries and views either as arguments or inside your own smart.yaml, not both",
        ));
    }
    if !own_manifest {
        let mut manifest = json!({ "title": a.title.trim() });
        if let Some(queries) = &a.queries {
            manifest["queries"] = Value::Object(queries.clone());
        }
        if let Some(views) = &a.views {
            manifest["views"] = Value::Object(views.clone());
        }
        let manifest: SmartManifest = serde_json::from_value(manifest).map_err(|err| {
            invalid(format!(
                "The queries or views are not in the shape smart.yaml takes: {err}"
            ))
        })?;
        let problems = manifest.validate();
        if !problems.is_empty() {
            return Err(invalid(problems.join(" ")));
        }
        files.push(SmartNewFile {
            path: MANIFEST_FILE.to_owned(),
            content: manifest_text(&manifest)?,
        });
    }
    agent_in(k, s, writes, |l| {
        let parent = a.parent.as_deref().map(|p| l.resolve(p)).transpose()?;
        Ok(AgentOp::SmartCreate {
            title: a.title,
            project: a.project,
            parent,
            files,
            reason: a.reason,
        })
    })
}

pub(crate) fn smart_read(k: &Kasten, a: SmartReadArgs) -> Result<Value> {
    let note = smart_page(k, &a.page)?;
    let page = note.meta.path.clone();
    if let Some(file) = a.file.as_deref().filter(|f| !f.trim().is_empty()) {
        let rel = rel_of(file)?;
        let bytes = file_of(k, &note, &rel)?;
        let mut out = json!({
            "page": page,
            "file": rel,
            "hash": bytes.hash,
            "locked": note.meta.locked,
        });
        match bytes.text() {
            Some(text) => out["text"] = json!(text),
            None => out["note"] = json!("This file is not text (a picture): a person adds those"),
        }
        return Ok(out);
    }
    let listing = k.smart_read(&page)?;
    let mut order: Vec<_> = listing.files.iter().collect();
    order.sort_by_key(|f| {
        (
            f.path != INDEX_FILE,
            f.path != MANIFEST_FILE,
            f.path.clone(),
        )
    });
    let mut left = TEXT_BUDGET;
    let mut files = Vec::new();
    let more = order.len().saturating_sub(FILES_SHOWN);
    for f in order.into_iter().take(FILES_SHOWN) {
        let mut entry = json!({ "path": f.path, "size": f.size, "allowed": f.allowed });
        if f.allowed
            && let Ok(bytes) = k.smart_file(&page, &f.path)
        {
            entry["hash"] = json!(bytes.hash);
            if let Some(text) = bytes.text() {
                if text.len() <= left {
                    left -= text.len();
                    entry["text"] = json!(text);
                } else {
                    entry["text"] = Value::Null;
                    entry["note"] =
                        json!("Too big to show with the others: read it with the file argument");
                }
            }
        }
        files.push(entry);
    }
    let errors = smart_errors::recent(k, &note);
    let mut out = json!({
        "page": page,
        "title": note.meta.title,
        "id": note.meta.id,
        "locked": note.meta.locked,
        "folder": listing.dir,
        "folderExists": listing.exists,
        "totalBytes": listing.total_bytes,
        "files": files,
        "manifest": as_json(&listing.manifest)?,
        "problems": listing.problems.iter().take(50).collect::<Vec<_>>(),
        "errors": errors,
        "data": match &listing.manifest {
            Some(manifest) => smart_data::data(k, manifest),
            None => json!({}),
        },
    });
    if more > 0 {
        out["moreFiles"] = json!(more);
        out["filesNote"] = json!(format!(
            "{more} more files are not listed. Read one by name with the file argument, or take out the files the page does not use"
        ));
    }
    if errors_empty(&out) {
        out["errorsNote"] = json!(
            "No errors reported. The app records them while the page is open; open the page there to see it run, then read this again"
        );
    }
    Ok(out)
}

fn errors_empty(out: &Value) -> bool {
    out["errors"].as_array().is_some_and(Vec::is_empty)
}

/// `s` with every line break a Windows one (`\r\n`).
fn to_crlf(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\n', "\r\n")
}

/// `text` with its one `search` put right; why not when it is not there once.
/// A file written with Windows line breaks throughout is searched with the
/// line breaks the model sent made the same, and what goes in has them too, so
/// the file keeps its line breaks and never gets a mixed set.
fn replaced(text: &str, rel: &str, step: usize, search: &str, replace: &str) -> Result<String> {
    let n = step + 1;
    if search.is_empty() {
        return Err(invalid(format!(
            "Step {n}: search is empty. Give the text to replace, exactly as it is in the file"
        )));
    }
    let crlf = text.contains("\r\n") && !text.replace("\r\n", "").contains('\n');
    let (search, replace) = if crlf {
        (to_crlf(search), to_crlf(replace))
    } else {
        (search.to_owned(), replace.to_owned())
    };
    let (search, replace) = (search.as_str(), replace.as_str());
    let Some(first) = text.find(search) else {
        return Err(invalid(format!(
            "Step {n}: the text to replace is not in {rel}. Read the file again with smart_read and copy the text exactly, spaces and line breaks included"
        )));
    };
    // A second place counts even when it overlaps the first ("aa" in "aaa").
    let skip = text[first..].chars().next().map_or(1, char::len_utf8);
    if text[first + skip..].contains(search) {
        let times = text.matches(search).count().max(2);
        return Err(invalid(format!(
            "Step {n}: the text to replace is in {rel} {times} times. Add some of the lines around it so it matches once"
        )));
    }
    Ok(text.replacen(search, replace, 1))
}

pub(crate) fn smart_edit(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: SmartEditArgs,
) -> Result<Value> {
    let note = smart_page(k, &a.page)?;
    let rel = rel_of(&a.file)?;
    let current = file_of(k, &note, &rel)?;
    if current.hash != a.base_hash.trim() {
        return Err(invalid(format!(
            "{rel} changed since you read it, so nothing was written. Read it again with smart_read and redo the change"
        )));
    }
    let Some(before) = current.text() else {
        return Err(invalid(format!(
            "{rel} is not a text file, so it cannot be edited"
        )));
    };
    if a.steps.is_empty() {
        return Err(invalid(
            "steps is empty: give at least one replace or rewrite",
        ));
    }
    let mut text = before.to_owned();
    for (index, step) in a.steps.iter().enumerate() {
        text = match step {
            SmartStep::Replace { search, replace } => {
                replaced(&text, &rel, index, search, replace)?
            }
            SmartStep::Rewrite { content } => content.clone(),
        };
    }
    if text == before {
        return Err(invalid(
            "The steps leave the file as it is, so there is nothing to change",
        ));
    }
    let op = AgentOp::SmartWrite {
        page: note.meta.path,
        path: rel.clone(),
        content: text,
        base: current.hash,
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}

pub(crate) fn smart_write_file(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: SmartWriteFileArgs,
) -> Result<Value> {
    let note = smart_page(k, &a.page)?;
    let rel = rel_of(&a.file)?;
    if !is_text_file(&rel) {
        return Err(invalid(format!(
            "{rel} is not a text file: you write html, js, css, json, svg and txt files and smart.yaml. A person adds pictures"
        )));
    }
    let op = AgentOp::SmartWrite {
        page: note.meta.path,
        path: rel.clone(),
        content: a.content,
        base: a.base_hash.map(|h| h.trim().to_owned()).unwrap_or_default(),
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}

pub(crate) fn smart_delete_file(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: SmartDeleteFileArgs,
) -> Result<Value> {
    let note = smart_page(k, &a.page)?;
    let rel = rel_of(&a.file)?;
    let op = AgentOp::SmartDelete {
        page: note.meta.path,
        path: rel.clone(),
        reason: a.reason,
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    out["file"] = json!(rel);
    Ok(out)
}

/// Asks the person to turn smart pages on. Nothing is turned on by it: the
/// request waits in the proposals list in every mode.
pub(crate) fn request_smart_pages(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: RequestSmartPagesArgs,
) -> Result<Value> {
    let op = AgentOp::RequestSmartPages {
        reason: a.reason,
        project: a.project,
    };
    agent_in(k, s, writes, |_| Ok(op))
}

/// What `smart_render` says where it cannot draw.
const CANNOT_DRAW: &str = "This program cannot draw a smart page. A page needs the KastenFlow window to run in, and the browser this program draws slides with only loads slides. Use smart_check for what is wrong with the files and smart_read for the errors the page reported while it was open in the app.";

pub(crate) fn smart_render(k: &Kasten, a: SmartRenderArgs) -> Result<Value> {
    let note = smart_page(k, &a.page)?;
    if let Some(view) = a.view.as_deref().filter(|v| !v.trim().is_empty()) {
        let manifest = k.smart_manifest(&note.meta.path)?;
        let names: Vec<String> = manifest
            .map(|m| m.views.keys().cloned().collect())
            .unwrap_or_default();
        if !names.iter().any(|n| n == view.trim()) {
            return Err(invalid(format!(
                "The page “{}” has no view called “{}”. {}",
                note.meta.title,
                view.trim(),
                if names.is_empty() {
                    "It has no named views.".to_owned()
                } else {
                    format!("Its views are: {}", names.join(", "))
                }
            )));
        }
    }
    Ok(json!({
        "page": note.meta.path,
        "drawn": false,
        "reason": CANNOT_DRAW,
    }))
}
