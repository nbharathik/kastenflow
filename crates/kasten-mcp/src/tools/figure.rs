//! The tools that need the app's window: a diagram drawn as a PNG (kept in
//! `assets/` by `diagram_export`, or as a figure of a LaTeX document by
//! `diagram_to_latex_figure`), and the selection the person has made
//! (`get_selection`). The server draws nothing and reads no window: it asks the
//! app through the vault's mailbox and waits, and says plainly when the app is
//! closed or does not answer. What it keeps goes through the same guarded ops
//! as every agent write, in the agent's session.

use std::time::Duration;

use kasten_core::agent::{AgentOp, Session};
use kasten_core::assets::NewAsset;
use kasten_core::bridge::{Answer, Call, Seen};
use kasten_core::diagrams::title_of;
use kasten_core::latex::base64_decode;
use kasten_core::{Error, Instant, Kasten, Result};
use serde_json::{Value, json};

use super::lookup::Writes;
use super::write::agent_in;
use crate::bridge::mailbox_of;
use crate::params_diagram::ExportDiagramArgs;
use crate::params_figure::DiagramToFigureArgs;

/// How long the app gets to draw a picture (it may try the editor's picture, then its own draft).
const DRAW_WAIT: Duration = Duration::from_secs(60);
/// How long the app gets to start sharing the selection.
const SHARE_WAIT: Duration = Duration::from_secs(8);

pub(crate) const PNG_APP_CLOSED: &str = "The app is closed. Open KastenFlow on this vault and ask again: a diagram is drawn as a PNG by the app, so it must be open. An SVG can be exported without it.";
const PNG_TIMED_OUT: &str = "The app did not draw the picture in time. Check that KastenFlow is open and its window is showing, then ask again.";
const STAGED: &str = "The app draws a diagram as it is in the vault, and this chat holds changes that are not applied yet. Apply them first, then ask again.";

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

/// Asks the app to draw the diagram at `path` as a PNG: its answer (the PNG as
/// base64 and facts about it), or one plain sentence for why not.
fn draw(k: &Kasten, s: &Session, path: &str, page: Option<&str>) -> Result<Value> {
    let call = Call::DiagramPng {
        diagram: path.to_owned(),
        page: page.map(str::to_owned),
    };
    match mailbox_of(k)?.ask(&call, Some(s), DRAW_WAIT)? {
        Answer::AppClosed => Err(invalid(PNG_APP_CLOSED)),
        Answer::TimedOut => Err(invalid(PNG_TIMED_OUT)),
        Answer::Reply(reply) if reply.ok => Ok(reply.result),
        Answer::Reply(reply) => {
            Err(invalid(reply.error.unwrap_or_else(|| {
                "The app could not draw that diagram".to_owned()
            })))
        }
    }
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

/// `diagram_export` as a PNG: the app draws it, and it is kept in `assets/`
/// like the SVG is (never written over another file).
pub(crate) fn export_png(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: ExportDiagramArgs,
) -> Result<Value> {
    if matches!(writes, Writes::Staged(_)) {
        return Err(invalid(STAGED));
    }
    let path = k.resolve_diagram(&a.diagram)?;
    let drawn = draw(k, s, &path, a.page.as_deref())?;
    let bytes = base64_decode(text(&drawn, "png_base64"))?;
    let name = match a.page.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(page) => format!("{} - {page}.png", title_of(&path)),
        None => format!("{}.png", title_of(&path)),
    };
    let kept = k
        .add_asset(
            &s.actor(),
            &name,
            &bytes,
            &NewAsset::default(),
            Instant::now(),
        )?
        .path;
    Ok(json!({
        "path": kept,
        "format": "png",
        "bytes": bytes.len(),
        "width": drawn["width"],
        "height": drawn["height"],
        "from": drawn["from"],
        "warnings": drawn["warnings"],
        "use": format!("![]({kept})"),
        "staged": false,
    }))
}

/// A width for `\includegraphics`: a length TeX knows, written plainly.
fn figure_width(width: Option<&str>) -> Result<String> {
    let w = width
        .map(str::trim)
        .filter(|w| !w.is_empty())
        .unwrap_or("\\linewidth");
    let macros = ["\\linewidth", "\\textwidth", "\\columnwidth"];
    let split = w
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(w.len());
    let (number, unit) = w.split_at(split);
    let fine = macros.contains(&w)
        || (number.len() <= 6
            && number.parse::<f64>().is_ok_and(|n| n > 0.0 && n <= 1000.0)
            && (macros.contains(&unit) || ["cm", "mm", "pt", "in", "em"].contains(&unit)));
    if fine {
        Ok(w.to_owned())
    } else {
        Err(invalid(format!(
            "“{}” is not a width for a figure. Use \\linewidth, 0.8\\linewidth, \\textwidth, or a length such as 8cm, 120mm, 300pt or 3in",
            w.chars().take(40).collect::<String>()
        )))
    }
}

/// The picture's file name: the one given (`.png` added when it has no ending),
/// else the diagram's title (and the page's name).
fn figure_file(name: Option<&str>, path: &str, page: Option<&str>) -> String {
    match name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(given) if given.rsplit('/').next().is_some_and(|b| b.contains('.')) => {
            given.to_owned()
        }
        Some(given) => format!("{given}.png"),
        None => match page.map(str::trim).filter(|p| !p.is_empty()) {
            Some(page) => format!("{} {page}.png", title_of(path)),
            None => format!("{}.png", title_of(path)),
        },
    }
}

pub(crate) fn diagram_to_latex_figure(
    k: &Kasten,
    s: &Session,
    writes: Writes,
    a: DiagramToFigureArgs,
) -> Result<Value> {
    if matches!(writes, Writes::Staged(_)) {
        return Err(invalid(STAGED));
    }
    let width = figure_width(a.width.as_deref())?;
    let doc = k.latex_find_doc(&a.doc)?;
    if k.latex_is_locked(&doc) {
        return Err(invalid(format!(
            "“{}” is locked: read-only for agents. Ask the owner to unlock it in the document's settings",
            doc.title
        )));
    }
    let path = k.resolve_diagram(&a.diagram)?;
    let drawn = draw(k, s, &path, a.page.as_deref())?;
    let op = AgentOp::AddLatexAsset {
        doc: doc.folder.clone(),
        name: figure_file(a.name.as_deref(), &path, a.page.as_deref()),
        base64: Some(text(&drawn, "png_base64").to_owned()),
        vault_path: None,
        reason: a
            .reason
            .or_else(|| Some(format!("A picture of the diagram “{}”", title_of(&path)))),
    };
    let mut out = agent_in(k, s, writes, |_| Ok(op))?;
    let figure = text(&out["result"], "figure").to_owned();
    if !figure.is_empty() {
        let include = format!("\\includegraphics[width={width}]{{{figure}}}");
        out["result"]["include"] = json!(include);
        out["figure"] = json!(figure);
        out["include"] = json!(include);
    }
    out["diagram"] = json!(path);
    out["doc"] = json!(doc.folder);
    out["picture"] = json!({
        "width": drawn["width"],
        "height": drawn["height"],
        "from": drawn["from"],
        "warnings": drawn["warnings"],
    });
    Ok(out)
}

pub(crate) const SELECTION_APP_CLOSED: &str = "The app is closed, so there is no selection to read. The selection is only known while KastenFlow is open on this vault.";
const NOTHING_SELECTED: &str = "Nothing is selected in KastenFlow right now. Ask the user to select the words they mean, then ask again. Only text selected in a page, a PDF, a slide or a LaTeX file counts.";
const OUT_OF_DATE: &str = "The selection is out of date: the app has not renewed it for over a minute. Ask the user to select the words again, then ask again.";

fn told(status: &str, message: &str) -> Value {
    json!({ "status": status, "selection": [], "message": message })
}

/// What the user has selected in the app. The app is asked to share it (it
/// does so for two minutes after each ask), then the shared file is read.
pub(crate) fn get_selection(k: &Kasten) -> Result<Value> {
    let mailbox = mailbox_of(k)?;
    match mailbox.ask(&Call::WatchSelection {}, None, SHARE_WAIT)? {
        Answer::AppClosed => return Ok(told("app_closed", SELECTION_APP_CLOSED)),
        Answer::TimedOut => {
            return Err(invalid(
                "The app did not answer in time. Check that KastenFlow is open, then ask again.",
            ));
        }
        Answer::Reply(reply) if !reply.ok => {
            return Err(invalid(reply.error.unwrap_or_else(|| {
                "The app could not share the selection".to_owned()
            })));
        }
        Answer::Reply(_) => {}
    }
    Ok(match mailbox.read_selection(Instant::now().millis) {
        Seen::AppClosed => told("app_closed", SELECTION_APP_CLOSED),
        Seen::Nothing => told("nothing_selected", NOTHING_SELECTED),
        Seen::OutOfDate => told("out_of_date", OUT_OF_DATE),
        Seen::Selected(published) => json!({
            "status": "selected",
            "selection": published.snippets,
            "message": match published.snippets.len() {
                1 => "The user has 1 piece selected in KastenFlow.".to_owned(),
                n => format!("The user has {n} pieces selected in KastenFlow."),
            },
            "as_of": published.time,
        }),
    })
}
