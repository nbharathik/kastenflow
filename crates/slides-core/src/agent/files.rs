//! The tools that reach past the deck: pictures in, files out, decks put aside.

use serde_json::{Value, json};

use super::images::{self, Kind};
use super::read::slide_id;
use super::session::Agent;
use super::store::{Draw, Store, StoreError};
use super::{Image, ToolError, ToolOutput, ToolResult};
use crate::outline;

/// The largest picture `add_asset` takes, in bytes.
const MOST_BYTES: usize = 25 * 1024 * 1024;
/// The most of an exported outline written into the answer, in characters.
const MOST_OUTLINE: usize = 20_000;

fn extension_for(kind: Kind) -> &'static str {
    kind.extensions()[0]
}

pub fn add_asset(store: &mut dyn Store, args: &Value) -> ToolResult {
    let given = args
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|n| !n.is_empty());
    let bytes = match (
        args.get("base64").and_then(Value::as_str),
        args.get("path").and_then(Value::as_str),
    ) {
        (Some(data), None) => images::base64(data).ok_or_else(|| {
            ToolError::new(
                "`base64` is not valid base64. Give the file's bytes as standard base64 text.",
            )
        })?,
        (None, Some(path)) => store.read_file(path)?,
        _ => {
            return Err(ToolError::new(
                "Give the picture either as `base64` (its bytes) or as `path` (a file inside the folder the decks are in), and a `name` for it.",
            ));
        }
    };
    if bytes.is_empty() || bytes.len() > MOST_BYTES {
        return Err(ToolError::new(format!(
            "A picture is between 1 byte and {} MB.",
            MOST_BYTES / 1024 / 1024
        )));
    }
    let kind = images::sniff(&bytes).ok_or_else(|| {
        ToolError::new(
            "That is not a picture KastenFlow Slides uses. PNG, JPEG, GIF, WebP and SVG are.",
        )
    })?;
    let from_path = args
        .get("path")
        .and_then(Value::as_str)
        .and_then(|p| p.rsplit('/').next());
    let name = given
        .or(from_path)
        .ok_or_else(|| ToolError::new("Give the picture a `name`, such as `figure.png`."))?;
    // The name must end in an extension that fits what the bytes are.
    let name = match name.rsplit_once('.') {
        Some((_, ext))
            if kind
                .extensions()
                .contains(&ext.to_ascii_lowercase().as_str()) =>
        {
            name.to_owned()
        }
        Some((stem, _)) => format!("{stem}.{}", extension_for(kind)),
        None => format!("{name}.{}", extension_for(kind)),
    };
    let path = store.add_asset(&name, &bytes)?;
    let size = images::dimensions(&bytes);
    Ok(ToolOutput::json(
        json!({ "path": path, "bytes": bytes.len(), "width": size.map(|s| s.0), "height": size.map(|s| s.1) }),
    ))
}

pub fn export(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let format = args.get("format").and_then(Value::as_str).unwrap_or("pptx");
    let (_, deck) = agent.read(store, &name)?;
    match format {
        "pptx" => {
            let (bytes, warnings) = store.make_pptx(&deck)?;
            let written = store.write_export(&name, "pptx", &bytes)?;
            Ok(ToolOutput::json(
                json!({ "format": "pptx", "path": written.path, "bytes": written.bytes, "slides": deck.slides.len(), "warnings": warnings }),
            ))
        }
        "markdown" | "md" => {
            let text = outline::outline_of(&deck);
            let written = store.write_export(&name, "md", text.as_bytes())?;
            let shown: String = text.chars().take(MOST_OUTLINE).collect();
            Ok(ToolOutput::json(
                json!({ "format": "markdown", "path": written.path, "bytes": written.bytes, "outline": shown }),
            ))
        }
        "pdf" | "png" | "html" => Err(ToolError::new(format!(
            "Export to {format} is not available in this build. Export `pptx` or `markdown`, or open the deck in KastenFlow Slides and use File, Download."
        ))),
        other => Err(ToolError::new(format!(
            "`format` is pptx or markdown, not `{other}`."
        ))),
    }
}

pub fn import_pptx(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| {
            ToolError::new("`path` is the PowerPoint file, inside the folder the decks are in.")
        })?;
    let made = store.import_pptx(path, args.get("title").and_then(Value::as_str))?;
    agent.remember(made.deck.clone());
    Ok(ToolOutput::json(json!({
        "deck": made.deck.name,
        "hash": made.deck.hash,
        "pictures": made.pictures,
        "warnings": made.warnings,
        "next": "get_deck shows the slides; lint_deck what to fix. Objects a deck cannot hold were kept as raw elements: leave them where they are.",
    })))
}

pub fn trash_deck(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let place = store.trash(&name)?;
    agent.forget(&name);
    Ok(ToolOutput::json(
        json!({ "deck": name, "trashedTo": place, "note": "Nothing is deleted: a person can restore it from there." }),
    ))
}

/// `render_slide` and `render_grid`: a picture of a slide, or of every slide, for the agent to look at.
pub fn render(agent: &mut Agent, store: &mut dyn Store, args: &Value, grid: bool) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let mut answer = json!({ "deck": name });
    let what = if grid {
        Draw::Grid
    } else {
        let id = slide_id(&deck, args.get("slide").unwrap_or(&Value::Null))?;
        let index = deck.slides.iter().position(|s| s.id == id).unwrap_or(0);
        let step = match args.get("step").filter(|v| !v.is_null()) {
            None => None,
            Some(v) => Some(v.as_u64().and_then(|n| u32::try_from(n).ok()).ok_or_else(|| {
                ToolError::new("`step` is a whole number counting from 0: the click the slide is drawn at. Leave it out for the slide as it ends.")
            })?),
        };
        let scale = match args.get("scale").filter(|v| !v.is_null()) {
            None => 1.0,
            Some(v) => v
                .as_f64()
                .filter(|s| (0.25..=4.0).contains(s))
                .ok_or_else(|| {
                    ToolError::new("`scale` is the pixels to each unit of the slide, from 0.25 to 4; 1 is the default.")
                })? as f32,
        };
        answer["slide"] = json!(id);
        answer["number"] = json!(index + 1);
        answer["step"] = json!(step);
        Draw::Slide {
            slide: index,
            step,
            scale,
        }
    };
    let drawn = store.draw(&deck, what).map_err(|e| match e {
        // Where nothing draws, lint is what is left to see with.
        StoreError::Unavailable(m) if m.contains("Chrome") || m.contains("not available") => {
            ToolError::new(format!(
                "{m} Use lint_deck to find layout problems (overlaps, text that overflows, contrast), and ask the person to look at the deck in KastenFlow Slides."
            ))
        }
        StoreError::Unavailable(m) => ToolError::new(m),
        other => other.into(),
    })?;
    answer["width"] = json!(drawn.width);
    answer["height"] = json!(drawn.height);
    answer["warnings"] = json!(drawn.warnings);
    let mut out = ToolOutput::json(answer);
    out.images.push(Image {
        mime: "image/png".to_owned(),
        bytes: drawn.png,
    });
    Ok(out)
}
