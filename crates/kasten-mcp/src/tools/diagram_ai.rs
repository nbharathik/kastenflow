//! The tools that draw and check diagrams: describe, find shapes, lint,
//! preview, new, edit and export. A diagram is made and changed by typed
//! steps (`diagram_new` builds a whole one from a spec, Mermaid or a template;
//! `diagram_edit` runs steps on the diagram as it is), so an agent never
//! writes XML or a style. Every write goes through the same core ops and
//! guardrails as the XML tools, and in a chat that previews its changes it is
//! staged with them.

use std::sync::Mutex;

use kasten_core::agent::{AgentOp, ChangeSet, Session};
use kasten_core::assets::NewAsset;
use kasten_core::diagrams::describe::describe;
use kasten_core::diagrams::lint::{Report, lint};
use kasten_core::diagrams::spec::{self, Input, templates};
use kasten_core::diagrams::steps::{self, Step};
use kasten_core::diagrams::{self, DiagramFile, Preview, shapes, title_of};
use kasten_core::{Error, Instant, Kasten, Result};
use serde_json::{Value, json};

use super::as_json;
use super::lookup::{Writes, locked};
use super::write::agent_in;
use crate::params_diagram::*;

/// The most findings of a lint told one by one in an answer.
const LISTED: usize = 15;

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// A lint report as an agent reads it.
pub(crate) fn lint_json(report: &Report) -> Value {
    json!({
        "summary": report.line(),
        "errors": report.errors,
        "warnings": report.warnings,
        "notes": report.infos,
        "issues": report.issues.iter().take(LISTED).collect::<Vec<_>>(),
        "more": report.issues.len().saturating_sub(LISTED),
        "skipped": report.skipped,
    })
}

/// The diagram a call names, with the chat's staged changes on top when it has some.
fn read_in(k: &Kasten, writes: &Writes, name: &str) -> Result<(String, DiagramFile)> {
    match writes {
        Writes::Staged(set) => {
            let set = locked(set);
            let path = k.resolve_diagram_staged(&set, name)?;
            let file = k.diagram_in(&set, &path)?;
            Ok((path, file))
        }
        Writes::Direct => {
            let path = k.resolve_diagram(name)?;
            let file = k.diagram(&path)?;
            Ok((path, file))
        }
    }
}

/// A diagram told to an agent: words, cells in page coordinates, free room, lint.
pub(crate) fn describe_json(path: &str, file: &DiagramFile, page: Option<&str>) -> Result<Value> {
    let d = describe(&file.xml, page)?;
    let report = lint(&file.xml, page)?;
    let mut out = as_json(&d)?;
    out["path"] = json!(path);
    out["title"] = json!(title_of(path));
    out["hash"] = json!(file.hash);
    out["preview"] = json!(file.preview);
    out["lint"] = lint_json(&report);
    Ok(out)
}

pub(crate) fn diagram_describe(k: &Kasten, a: DiagramPageArgs) -> Result<Value> {
    let path = k.resolve_diagram(&a.diagram)?;
    describe_json(&path, &k.diagram(&path)?, a.page.as_deref())
}

pub(crate) fn lint_report(path: &str, file: &DiagramFile, page: Option<&str>) -> Result<Value> {
    let mut out = lint_json(&lint(&file.xml, page)?);
    out["path"] = json!(path);
    Ok(out)
}

pub(crate) fn diagram_lint(k: &Kasten, a: DiagramPageArgs) -> Result<Value> {
    let path = k.resolve_diagram(&a.diagram)?;
    lint_report(&path, &k.diagram(&path)?, a.page.as_deref())
}

pub(crate) fn diagram_find_shapes(a: FindShapesArgs) -> Result<Value> {
    let limit = a.limit.unwrap_or(20).clamp(1, 100);
    let found = shapes::find(&a.query, a.library.as_deref(), limit);
    let words: Vec<String> = a
        .query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect();
    let matching: Vec<Value> = templates()
        .iter()
        .filter(|t| {
            let text = format!("{} {} {}", t.id, t.title, t.about).to_lowercase();
            !words.is_empty() && words.iter().any(|w| text.contains(w.as_str()))
        })
        .map(|t| json!({"id": t.id, "title": t.title, "about": t.about, "use": "diagram_new with template"}))
        .collect();
    let mut out = json!({
        "shapes": found.iter().map(|s| json!({
            "key": s.key, "title": s.title, "library": s.library(), "w": s.w, "h": s.h, "style": s.style,
        })).collect::<Vec<_>>(),
        "templates": matching,
        "use": "add_node{shape: key} puts the shape on a diagram; its style is added for you",
    });
    if a.query.trim().is_empty() && a.library.is_none() {
        out["libraries"] = json!(
            shapes::libraries()
                .into_iter()
                .map(|(name, shapes)| json!({"name": name, "shapes": shapes}))
                .collect::<Vec<_>>()
        );
    }
    if found.is_empty() {
        out["note"] =
            json!("No shape matches; try one word, or a library with an empty query to list it");
    }
    Ok(out)
}

/// The steps an agent sent, read, with the step a bad one is.
pub(crate) fn read_steps(values: &[Value]) -> Result<Vec<Step>> {
    values
        .iter()
        .enumerate()
        .map(|(i, v)| {
            serde_json::from_value(v.clone())
                .map_err(|e| invalid(format!("Step {} is not a step: {e}", i + 1)))
        })
        .collect()
}

/// Whether the diagram will have a draft picture drawn by the program.
fn picture_of(xml: &str) -> &'static str {
    if diagrams::draft_for(xml).is_some() {
        "draft"
    } else {
        "none"
    }
}

/// Adds what an agent wants to know to the answer of a write: inside the
/// result when it has one (done, staged), else beside it.
fn with(mut out: Value, extra: Value) -> Value {
    let target = if out["result"].is_object() {
        &mut out["result"]
    } else {
        &mut out
    };
    if let (Some(into), Some(from)) = (target.as_object_mut(), extra.as_object()) {
        for (key, value) in from {
            into.insert(key.clone(), value.clone());
        }
    }
    out
}

pub(crate) fn diagram_new(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: NewDiagramArgs,
) -> Result<Value> {
    let given = [a.spec.is_some(), a.mermaid.is_some(), a.template.is_some()];
    if given.iter().filter(|g| **g).count() != 1 {
        return Err(invalid(format!(
            "Give exactly one of spec, mermaid or template. A spec looks like {}; the templates are {}",
            spec::example(),
            templates()
                .iter()
                .map(|t| t.id)
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    let input = match (a.spec, a.mermaid, a.template) {
        (Some(spec), ..) => Input::Spec(serde_json::from_value(spec).map_err(|e| {
            invalid(format!(
                "The spec is not one: {e}. It looks like {}",
                spec::example()
            ))
        })?),
        (_, Some(text), _) => Input::Mermaid(text),
        (.., Some(id)) => Input::Template(id),
        _ => return Err(invalid("Give a spec, mermaid or template")),
    };
    let (mut description, ignored) = spec::resolve(input, &a.title)?;
    if let Some(layout) = a.layout {
        description.layout = Some(layout);
    }
    let built = spec::build(Input::Spec(description), &a.title)?;
    let report = lint(&built.xml, None)?;
    let (title, project, xml) = (a.title.clone(), a.project.clone(), built.xml.clone());
    let out = agent_in(k, s, writes, |_| {
        Ok(AgentOp::CreateDiagram {
            title,
            project,
            xml,
        })
    })?;
    let mut extra = json!({
        "preset": built.preset,
        "ids": built.applied.ids,
        "lint": lint_json(&report),
        "picture": picture_of(&built.xml),
    });
    if !ignored.is_empty() {
        extra["ignored"] = json!(ignored);
    }
    if !built.applied.notes.is_empty() {
        extra["notes"] = json!(built.applied.notes);
    }
    Ok(with(out, extra))
}

pub(crate) fn diagram_edit(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: EditDiagramArgs,
) -> Result<Value> {
    let list = read_steps(&a.steps)?;
    let mut told: Option<Value> = None;
    let (page, preset) = (a.page.clone(), a.preset.clone());
    let out = agent_in(k, s, writes, |l| {
        let path = l.resolve_diagram(&a.diagram)?;
        let xml = l.diagram_xml(&path)?;
        // The steps are made once here to tell the agent what they come to; the op makes them again
        // on the diagram as it is when it runs.
        let edited = steps::replay(&xml, page.as_deref(), preset.as_deref(), &list)?;
        let report = lint(&edited.xml, page.as_deref())?;
        told = Some(json!({
            "ids": edited.applied.ids,
            "lint": lint_json(&report),
            "picture": picture_of(&edited.xml),
            "notes": edited.applied.notes,
        }));
        Ok(AgentOp::EditDiagram {
            path,
            page,
            preset,
            steps: list,
            reason: a.reason.clone(),
            summary: String::new(),
        })
    })?;
    Ok(with(out, told.unwrap_or(Value::Null)))
}

/// The picture of a diagram as SVG text: the editor's own when it drew one
/// for this very source, else the program's draft.
fn picture_text(
    k: &Kasten,
    writes: &Writes,
    path: &str,
    file: &DiagramFile,
) -> Result<(String, &'static str, Vec<String>)> {
    if file.preview == Preview::Fresh
        && !matches!(writes, Writes::Staged(_))
        && let Some(svg) = k.diagram_preview(path)?
    {
        return Ok((svg, "editor", Vec::new()));
    }
    match diagrams::draw::draft(&file.xml, None) {
        Ok(draft) => Ok((draft.svg, "draft", draft.warnings)),
        Err(why) => Err(invalid(format!(
            "A picture of this diagram cannot be drawn without the diagram editor: {why}. Open the diagram in KastenFlow once and it is drawn"
        ))),
    }
}

pub(crate) fn diagram_preview(k: &Kasten, writes: Writes, a: DiagramPageArgs) -> Result<Value> {
    let (path, file) = read_in(k, &writes, &a.diagram)?;
    let (svg, from, warnings) = match &a.page {
        Some(page) => match diagrams::draw::draft(&file.xml, Some(page)) {
            Ok(draft) => (draft.svg, "draft", draft.warnings),
            Err(why) => return Err(invalid(format!("The page cannot be drawn: {why}"))),
        },
        None => picture_text(k, &writes, &path, &file)?,
    };
    Ok(json!({
        "path": path,
        "picture": from,
        "svg": svg,
        "warnings": warnings,
        "note": if from == "draft" { "A draft drawn by the program: boxes, arrows and words in their places. The diagram editor draws the exact picture when the diagram is next opened in KastenFlow" } else { "Drawn by the diagram editor" },
    }))
}

pub(crate) fn diagram_export(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: ExportDiagramArgs,
) -> Result<Value> {
    let format = a.format.trim().to_lowercase();
    if format != "svg" {
        return Err(invalid(if format == "png" {
            "A PNG needs a program that draws SVG; this one does not. Export svg, which a note or a slide can use as it is".to_owned()
        } else {
            format!("The formats are svg and png, not “{format}”")
        }));
    }
    let (path, file) = read_in(k, &writes, &a.diagram)?;
    let (svg, from, warnings) = match &a.page {
        Some(page) => {
            let draft = diagrams::draw::draft(&file.xml, Some(page))
                .map_err(|why| invalid(format!("The page cannot be drawn: {why}")))?;
            (draft.svg, "draft", draft.warnings)
        }
        None => picture_text(k, &writes, &path, &file)?,
    };
    // What is kept in the vault is cleaned first: the drawing, and nothing that runs or fetches.
    let clean = diagrams::sanitize::sanitize(&svg)?;
    let name = format!("{}.svg", title_of(&path));
    let kept = match &writes {
        Writes::Staged(set) => keep_staged(k, set, s, &name, clean.svg.as_bytes())?,
        Writes::Direct => {
            k.add_asset(
                &s.actor(),
                &name,
                clean.svg.as_bytes(),
                &NewAsset::default(),
                Instant::now(),
            )?
            .path
        }
    };
    let mut out = json!({
        "path": kept,
        "format": "svg",
        "bytes": clean.svg.len(),
        "from": from,
        "warnings": warnings,
        "use": format!("![]({kept})"),
        "staged": matches!(writes, Writes::Staged(_)),
    });
    if !clean.removed.is_empty() {
        out["removed"] = json!(clean.removed);
    }
    Ok(out)
}

fn keep_staged(
    k: &Kasten,
    set: &Mutex<ChangeSet>,
    s: &Session,
    name: &str,
    bytes: &[u8],
) -> Result<String> {
    k.stage_asset(&mut locked(set), s, name, bytes, Instant::now())
}
