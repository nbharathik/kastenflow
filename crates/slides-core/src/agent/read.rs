//! The tools that only look: the decks, one deck, a slide, the outline, the
//! layouts and theme to build with, the pictures, and lint.

use serde_json::{Value, json};

use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolOutput, ToolResult, images};
use crate::lint::{self, Options, Severity};
use crate::model::{Deck, Element, Slide};
use crate::outline;

/// The most lines of lint a tool prints; the rest are counted.
const MOST_LINES: usize = 60;

pub fn list_decks(store: &mut dyn Store) -> ToolResult {
    let decks = store.decks()?;
    let list: Vec<Value> = decks
        .iter()
        .map(|d| json!({ "name": d.name, "title": d.title, "slides": d.slides, "modified": d.modified, "problem": d.problem }))
        .collect();
    Ok(ToolOutput::json(json!({ "decks": list })))
}

/// The words a slide is known by: its title slot, else its first text, else its layout.
pub(super) fn slide_title(deck: &Deck, slide: &Slide) -> String {
    let words = |e: &Element| {
        e.text()
            .map(|t| {
                t.plain_text()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|t| !t.is_empty())
    };
    let title = slide
        .elements
        .iter()
        .filter(|e| e.base().placeholder.as_deref() == Some("title"))
        .find_map(words);
    title
        .or_else(|| {
            slide
                .elements
                .iter()
                .filter(|e| matches!(e, Element::Text(_)))
                .find_map(words)
        })
        .unwrap_or_else(|| {
            deck.theme
                .layout(&slide.layout)
                .map_or_else(|| slide.layout.clone(), |l| l.label.clone())
        })
}

/// The slide a call names: by id, or by its place counted from 1.
pub(super) fn slide_id(deck: &Deck, given: &Value) -> Result<String, ToolError> {
    let text = match given {
        Value::String(s) => s.trim().to_owned(),
        Value::Number(n) => n.to_string(),
        _ => {
            return Err(ToolError::new(
                "Name the slide with `slide`: its id (`s-…`) or its number, counting from 1.",
            ));
        }
    };
    if deck.slide(&text).is_some() {
        return Ok(text);
    }
    if let Ok(n) = text.parse::<usize>()
        && let Some(slide) = n.checked_sub(1).and_then(|i| deck.slides.get(i))
    {
        return Ok(slide.id.clone());
    }
    let ids: Vec<&str> = deck.slides.iter().map(|s| s.id.as_str()).collect();
    Err(ToolError::new(format!(
        "There is no slide `{text}` in the deck. Its slides are: {}.",
        ids.join(", ")
    )))
}

fn counts(deck: &Deck, store: &mut dyn Store) -> lint::Report {
    let refs = store.references();
    let measures = lint::estimate::measures_with(deck, refs.as_ref());
    lint::lint_deck_with(
        deck,
        &Options {
            measures: Some(&measures),
            refs: refs.as_ref(),
        },
    )
}

/// The report with the text laid out by the store's browser, when it has one, else estimated. True when measured.
fn measured_counts(deck: &Deck, store: &mut dyn Store) -> (lint::Report, bool) {
    let Some(measures) = store.measure(deck) else {
        return (counts(deck, store), false);
    };
    let refs = store.references();
    let report = lint::lint_deck_with(
        deck,
        &Options {
            measures: Some(&measures),
            refs: refs.as_ref(),
        },
    );
    (report, true)
}

pub fn get_deck(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (text, deck) = agent.read(store, &name)?;
    let report = counts(&deck, store);
    let mut lines = vec![format!(
        "{name}: \"{}\" ({} theme, {} by {}, {} slides, version {}). Lint: {}.",
        deck.title,
        deck.theme.name,
        deck.size.w,
        deck.size.h,
        deck.slides.len(),
        text.hash,
        lint::summary(&report),
    )];
    let mut slides = Vec::new();
    for (i, slide) in deck.slides.iter().enumerate() {
        let (e, w, n) = [Severity::Error, Severity::Warning, Severity::Info]
            .map(|s| {
                report
                    .of_slide(&slide.id)
                    .filter(|x| x.severity == s)
                    .count()
            })
            .into();
        let title = slide_title(&deck, slide);
        let mut notes = Vec::new();
        if slide.steps > 0 {
            notes.push(format!("{} steps", slide.steps));
        }
        if slide.hidden {
            notes.push("hidden".to_owned());
        }
        if slide.backup {
            notes.push("backup".to_owned());
        }
        for (count, word) in [(e, "error"), (w, "warning"), (n, "info")] {
            if count > 0 {
                notes.push(format!(
                    "{count} {word}{}",
                    if count == 1 { "" } else { "s" }
                ));
            }
        }
        lines.push(format!(
            "{:>3}  {}  {:<13} \"{}\"  {} elements{}{}",
            i + 1,
            slide.id,
            slide.layout,
            title,
            slide.elements.len(),
            if notes.is_empty() { "" } else { "  " },
            notes.join(", ")
        ));
        slides.push(json!({ "n": i + 1, "id": slide.id, "layout": slide.layout, "title": title, "elements": slide.elements.len(), "steps": slide.steps, "hidden": slide.hidden, "errors": e, "warnings": w, "info": n }));
    }
    let data = json!({ "deck": name, "title": deck.title, "theme": deck.theme.name, "size": { "w": deck.size.w, "h": deck.size.h }, "hash": text.hash, "slides": slides });
    Ok(ToolOutput {
        text: lines.join("\n"),
        data: Some(data),
        images: Vec::new(),
    })
}

pub fn get_slide(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (text, deck) = agent.read(store, &name)?;
    let id = slide_id(&deck, args.get("slide").unwrap_or(&Value::Null))?;
    let slide = deck
        .slide(&id)
        .ok_or_else(|| ToolError::new("That slide is not in the deck."))?;
    let report = counts(&deck, store);
    let issues: Vec<&lint::Issue> = report.of_slide(&id).collect();
    Ok(ToolOutput::json(json!({
        "deck": name,
        "hash": text.hash,
        "position": deck.index_of(&id).map_or(0, |i| i + 1),
        "slide": slide,
        "lint": issues,
    })))
}

pub fn get_outline(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    Ok(ToolOutput::text(outline::outline_of(&deck)))
}

pub fn list_layouts(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let layouts: Vec<Value> = deck
        .theme
        .layouts
        .iter()
        .map(|l| {
            let slots: Vec<Value> = l
                .placeholders
                .iter()
                .map(|p| json!({ "role": p.role, "kind": p.kind, "x": p.x, "y": p.y, "w": p.w, "h": p.h, "style": p.style, "list": p.list, "prompt": p.prompt }))
                .collect();
            // A layout someone made says so, and what it draws behind a slide, so an assistant knows what it is working with.
            json!({
                "name": l.name,
                "label": l.label,
                "slots": slots,
                "custom": !crate::themes::BUILT_IN_LAYOUTS.contains(&l.name.as_str()),
                "decoration": l.elements.len(),
                "background": l.background,
                "hidesMaster": l.hide_master,
                "newSlideDefault": deck.theme.new_slide_layout.as_deref() == Some(l.name.as_str()),
            })
        })
        .collect();
    Ok(ToolOutput::json(json!({ "layouts": layouts })))
}

pub fn get_theme(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let t = &deck.theme;
    Ok(ToolOutput::json(json!({
        "name": t.name,
        "colors": t.colors,
        "fonts": t.fonts,
        "textStyles": t.text_styles,
        "dimmedOpacity": t.dimmed_opacity,
        "highlight": t.highlight,
        "themes": crate::themes::all().iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
    })))
}

pub fn search_assets(store: &mut dyn Store, args: &Value) -> ToolResult {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_lowercase();
    let found: Vec<_> = store
        .assets()?
        .into_iter()
        .filter(|a| query.is_empty() || a.path.to_lowercase().contains(&query))
        .collect();
    let mut list = Vec::new();
    for asset in found.iter().take(50) {
        let size = store
            .read_asset(&asset.path)
            .ok()
            .and_then(|b| images::dimensions(&b));
        list.push(json!({ "path": asset.path, "bytes": asset.bytes, "width": size.map(|s| s.0), "height": size.map(|s| s.1) }));
    }
    Ok(ToolOutput::json(
        json!({ "assets": list, "total": found.len() }),
    ))
}

pub fn lint_deck(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let only = match args.get("slide") {
        Some(v) if !v.is_null() => Some(slide_id(&deck, v)?),
        _ => None,
    };
    let least = match args.get("severity").and_then(Value::as_str) {
        None | Some("info") => Severity::Info,
        Some("warning") => Severity::Warning,
        Some("error") => Severity::Error,
        Some(other) => {
            return Err(ToolError::new(format!(
                "`severity` is error, warning or info, not `{other}`."
            )));
        }
    };
    let (report, measured) = measured_counts(&deck, store);
    let view = lint::View {
        name: &name,
        least,
        slide: only.as_deref(),
        most: MOST_LINES,
    };
    let sizes = if measured {
        "Text was measured in a browser."
    } else {
        "Text sizes were estimated, not measured (no browser laid the words out), so text-overflow is a good guess."
    };
    let mut data = serde_json::to_value(&report).unwrap_or(Value::Null);
    data["textMeasured"] = json!(measured);
    Ok(ToolOutput {
        text: format!("{}\n{sizes}", lint::to_text(&report, &view)),
        data: Some(data),
        images: Vec::new(),
    })
}
