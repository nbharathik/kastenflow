//! Code pictures for agents: `place_code_picture` writes a small program, has it run where programs run
//! safely (KastenFlow's window; see `Store::run_generator`), puts the picture it draws on a slide and
//! keeps the program inside the picture; `run_code_picture` and `rerun_code_pictures` run programs
//! again and swap the pictures. The program is a picture's `generator` block (model/generator.rs), so
//! everything an agent does here is the same deck change a person makes: one undo, nothing deleted,
//! the picture an ordinary picture in the store.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::edit::apply_all;
use super::images::{self, Kind};
use super::place;
use super::read::slide_id;
use super::session::Agent;
use super::specs::{ToolSpec, box_property, deck_property, object, slide_property};
use super::store::{GeneratorDrawn, GeneratorJob, Store};
use super::{Image, ToolError, ToolOutput, ToolResult};
use crate::model::{
    Deck, Element, GeneratorInput, GeneratorInputKind, GeneratorOutput, GeneratorRun,
    PictureGenerator, run_hash,
};
use crate::resolve::Rect;

/// Who made the program, as the block says it.
const MADE_BY: &str = "agent";

/// How much the proportions of a new picture may differ from the old one before the box is refitted.
const REFIT_AFTER: f64 = 0.01;

fn kit_words() -> &'static str {
    "The program is the body of a function (kit, inputs, theme): read `inputs.<name>` (text), draw with `kit` and `return` the SVG text. It runs in KastenFlow's sandbox (no network, files or page; 30 s at most). kit: svg(w, h, body), rect, circle, line, path, polygon, text(x, y, words), g(body), scaleLinear(domain, range), scaleBand(labels, range), ticks, axisBottom(scale, y), axisLeft(scale, x), csv(text), json(text), palette(i), format(n). theme.text1, bg1, accent1..6 are the deck's colours. Errors come back with the line."
}

fn inputs_property() -> Value {
    json!({
        "type": "array",
        "description": "Read as `inputs.<name>` (text): kind asset (value: a CSV in the assets), note (value: a page's path) or data (value: the text).",
        "items": { "type": "object", "description": "{name, kind (asset, note or data), value}, all three." }
    })
}

fn output_property() -> Value {
    json!({ "type": "string", "enum": ["svg", "png"], "description": "svg (the default; sharp at any size) or png." })
}

/// The tools of this file, for the list `tools()` makes.
pub(super) fn specs() -> Vec<ToolSpec> {
    let tool = |name: &str, description: String, input_schema: Value| ToolSpec {
        name: name.to_owned(),
        description,
        input_schema,
        read_only: false,
    };
    vec![
        tool(
            "place_code_picture",
            format!(
                "Draws a picture with a small JavaScript program and puts it on a slide, keeping the program in the picture so a person can edit and rerun it. {} Where: as place_image (`placeholder`, `box`, `auto` or `id`). The picture comes back for you to look at; give `alt`. An agent's code waits for the person's \"Allow to run\" in KastenFlow the first time for a deck.",
                kit_words()
            ),
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "code": { "type": "string", "description": "The program (JavaScript)." },
                    "inputs": inputs_property(),
                    "output": output_property(),
                    "alt": { "type": "string" },
                    "placeholder": { "type": "string" },
                    "box": box_property(),
                    "auto": { "type": "boolean" },
                    "id": { "type": "string" }
                }),
                &["slide", "code"],
            ),
        ),
        tool(
            "run_code_picture",
            "Runs a code picture's program again and replaces its picture (inputs are read afresh; the old picture stays in the store). Give `code`, `inputs` or `output` to change the program first.".to_owned(),
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "element": { "type": "string", "description": "The picture's id." },
                    "code": { "type": "string" },
                    "inputs": inputs_property(),
                    "output": output_property()
                }),
                &["slide", "element"],
            ),
        ),
        tool(
            "rerun_code_pictures",
            "Runs every code picture of the deck again and replaces those that came out different, in one change. Says for each whether it was updated, unchanged or failed (with the line).".to_owned(),
            object(json!({ "deck": deck_property() }), &[]),
        ),
    ]
}

fn invalid(message: impl Into<String>) -> ToolError {
    ToolError::new(message)
}

fn parse_output(value: Option<&Value>) -> Result<Option<GeneratorOutput>, ToolError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s == "svg" => Ok(Some(GeneratorOutput::Svg)),
        Some(Value::String(s)) if s == "png" => Ok(Some(GeneratorOutput::Png)),
        Some(_) => Err(invalid("`output` is \"svg\" or \"png\".")),
    }
}

fn parse_inputs(value: Option<&Value>) -> Result<Option<Vec<GeneratorInput>>, ToolError> {
    let list = match value {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Array(list)) => list,
        Some(_) => return Err(invalid("`inputs` is a list of {name, kind, value}.")),
    };
    let mut out = Vec::new();
    for (i, item) in list.iter().enumerate() {
        let text = |key: &str| item.get(key).and_then(Value::as_str);
        let kind = match text("kind") {
            Some("asset") => GeneratorInputKind::Asset,
            Some("note") => GeneratorInputKind::Note,
            Some("data") => GeneratorInputKind::Data,
            _ => {
                return Err(invalid(format!(
                    "Input {} needs a `kind`: asset, note or data.",
                    i + 1
                )));
            }
        };
        let (Some(name), Some(value)) = (text("name"), text("value")) else {
            return Err(invalid(format!(
                "Input {} needs a `name` and a `value`.",
                i + 1
            )));
        };
        out.push(GeneratorInput {
            name: name.to_owned(),
            kind,
            value: value.to_owned(),
            extra: Map::new(),
        });
    }
    Ok(Some(out))
}

fn is_hex(colour: &str) -> bool {
    colour.strip_prefix('#').is_some_and(|digits| {
        matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

/// The deck's colours by token, for the drawing kit; a colour that is not a plain `#hex` is left out.
fn theme_of(deck: &Deck) -> BTreeMap<String, String> {
    let c = &deck.theme.colors;
    [
        ("text1", &c.text1),
        ("text2", &c.text2),
        ("bg1", &c.bg1),
        ("bg2", &c.bg2),
        ("accent1", &c.accent1),
        ("accent2", &c.accent2),
        ("accent3", &c.accent3),
        ("accent4", &c.accent4),
        ("accent5", &c.accent5),
        ("accent6", &c.accent6),
    ]
    .into_iter()
    .filter(|(_, value)| is_hex(value))
    .map(|(token, value)| (token.to_owned(), value.clone()))
    .collect()
}

/// A program run and its picture kept in the store.
struct Kept {
    generator: PictureGenerator,
    path: String,
    drawn: GeneratorDrawn,
    width: u32,
    height: u32,
}

/// Runs the program, keeps what it drew as a picture in the store, and gives the block with its last run noted.
fn run_and_keep(
    store: &mut dyn Store,
    deck_name: &str,
    deck: &Deck,
    mut generator: PictureGenerator,
) -> Result<Kept, ToolError> {
    if let Some(problem) = generator.problem() {
        return Err(invalid(problem));
    }
    let drawn = store.run_generator(&GeneratorJob {
        deck: deck_name.to_owned(),
        generator: generator.clone(),
        theme: theme_of(deck),
    })?;
    let svg = match drawn.kind {
        Kind::Svg => true,
        Kind::Png => false,
        _ => return Err(invalid("The program must draw an SVG or a PNG.")),
    };
    if svg != (generator.output == GeneratorOutput::Svg) {
        return Err(invalid(format!(
            "The window drew {} when {} was asked for.",
            if svg { "an SVG" } else { "a PNG" },
            if svg { "a PNG" } else { "an SVG" }
        )));
    }
    let hash = run_hash(&generator.code, &drawn.inputs_hash, generator.output);
    let file = format!("code-{}.{}", &hash[..8], if svg { "svg" } else { "png" });
    let path = store.add_asset(&file, &drawn.bytes)?;
    let (width, height) = if drawn.width > 0 && drawn.height > 0 {
        (drawn.width, drawn.height)
    } else {
        images::dimensions(&drawn.bytes)
            .ok_or_else(|| invalid("The picture the program drew has no size."))?
    };
    generator.last_run = Some(GeneratorRun {
        hash,
        at: drawn.at,
        extra: Map::new(),
    });
    Ok(Kept {
        generator,
        path,
        drawn,
        width,
        height,
    })
}

/// What a tool says of a picture it made, and the picture itself for the agent to look at.
fn tell(out: &mut ToolOutput, kept: &Kept) {
    let note = json!({
        "picture": kept.path,
        "kind": if kept.drawn.kind == Kind::Svg { "svg" } else { "png" },
        "width": kept.width,
        "height": kept.height,
        "bytes": kept.drawn.bytes.len(),
        "ranAt": kept.drawn.at,
        "hash": kept.generator.last_run.as_ref().map(|r| r.hash.clone()),
        "warnings": kept.drawn.warnings,
        "logs": kept.drawn.logs,
    });
    if let Some(Value::Object(map)) = out.data.as_mut() {
        map.insert("codePicture".to_owned(), note);
        out.text = serde_json::to_string_pretty(&Value::Object(map.clone())).unwrap_or_default();
    }
    let look = match kept.drawn.kind {
        Kind::Png => Some(kept.drawn.bytes.clone()),
        _ => kept.drawn.preview.clone(),
    };
    if let Some(bytes) = look {
        out.images.push(Image {
            mime: "image/png".to_owned(),
            bytes,
        });
    }
}

pub(super) fn place_code_picture(
    agent: &mut Agent,
    store: &mut dyn Store,
    args: &Value,
) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let code = args
        .get("code")
        .and_then(Value::as_str)
        .filter(|c| !c.trim().is_empty())
        .ok_or_else(|| invalid("`code` is the program that draws the picture."))?;
    let mut generator = PictureGenerator::new(
        code,
        parse_output(args.get("output"))?.unwrap_or(GeneratorOutput::Svg),
    );
    generator.inputs = parse_inputs(args.get("inputs"))?.unwrap_or_default();
    generator.made_by = Some(MADE_BY.to_owned());
    let kept = run_and_keep(store, &name, &deck, generator)?;

    let mut place_args = args.clone();
    place_args["deck"] = json!(name);
    place_args["src"] = json!(kept.path);
    if place_args
        .get("alt")
        .and_then(Value::as_str)
        .is_none_or(|a| a.trim().is_empty())
    {
        place_args["alt"] = json!("A picture drawn by code");
    }
    let block = serde_json::to_value(&kept.generator).map_err(|e| invalid(e.to_string()))?;
    let mut out = place::place_image_with(agent, store, &place_args, Some(&block))?;
    tell(&mut out, &kept);
    Ok(out)
}

/// A picture whose program is to be swapped in.
struct Replacement {
    slide: String,
    id: String,
    path: String,
    block: Value,
    refit: Option<Rect>,
}

fn operations(list: &[Replacement]) -> Vec<(String, Value)> {
    let mut ops = Vec::new();
    for r in list {
        ops.push((
            "patch_elements".to_owned(),
            json!({ "slide": r.slide, "patches": [{ "id": r.id, "patch": { "src": r.path, "generator": r.block } }] }),
        ));
        if let Some(b) = &r.refit {
            ops.push((
                "transform_elements".to_owned(),
                json!({ "slide": r.slide, "items": [{ "id": r.id, "x": b.x, "y": b.y, "w": b.w, "h": b.h }] }),
            ));
        }
    }
    ops
}

/// The box a new picture takes in the place of the old one: the old box when the proportions are the
/// same, else the largest box of the new proportions that fits in it.
fn refit(old: Option<(f64, f64, f64, f64)>, kept: &Kept) -> Option<Rect> {
    let (x, y, w, h) = old.filter(|(_, _, w, h)| *w > 0.0 && *h > 0.0)?;
    let aspect = f64::from(kept.width) / f64::from(kept.height.max(1));
    if ((w / h) - aspect).abs() / aspect < REFIT_AFTER {
        return None;
    }
    Some(place::fit(aspect, Rect { x, y, w, h }))
}

/// Swaps the pictures and programs in one change to the deck.
fn swap(
    agent: &mut Agent,
    store: &mut dyn Store,
    name: &str,
    list: &[Replacement],
) -> Result<super::session::Edited<Vec<Value>>, ToolError> {
    let ops = operations(list);
    agent.edit(store, name, None, |engine| apply_all(engine, ops))
}

pub(super) fn run_code_picture(
    agent: &mut Agent,
    store: &mut dyn Store,
    args: &Value,
) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let slide_key = slide_id(&deck, args.get("slide").unwrap_or(&Value::Null))?;
    let id = args.get("element").and_then(Value::as_str).ok_or_else(|| {
        invalid("`element` is the id of the code picture (get_slide lists the elements).")
    })?;
    let slide = deck
        .slide(&slide_key)
        .ok_or_else(|| invalid("That slide is not in the deck."))?;
    let Some(Element::Image(image)) = slide.element(id) else {
        return Err(invalid(format!("`{id}` is not a picture on that slide.")));
    };
    let mut generator = image.generator().ok_or_else(|| {
        invalid(format!(
            "`{id}` has no program. place_code_picture draws a picture with one."
        ))
    })?;
    let mut changed = false;
    if let Some(code) = args.get("code").and_then(Value::as_str) {
        generator.code = code.to_owned();
        changed = true;
    }
    if let Some(inputs) = parse_inputs(args.get("inputs"))? {
        generator.inputs = inputs;
        changed = true;
    }
    if let Some(output) = parse_output(args.get("output"))? {
        generator.output = output;
        changed = true;
    }
    if changed {
        generator.made_by = Some(MADE_BY.to_owned());
    }
    let old_box = image.base.rect();
    let kept = run_and_keep(store, &name, &deck, generator)?;
    let block = serde_json::to_value(&kept.generator).map_err(|e| invalid(e.to_string()))?;
    let replacement = Replacement {
        slide: slide_key,
        id: id.to_owned(),
        path: kept.path.clone(),
        block,
        refit: refit(old_box, &kept),
    };
    let edited = swap(agent, store, &name, std::slice::from_ref(&replacement))?;
    let mut out = agent.answer(store, &edited, json!({ "element": id }))?;
    tell(&mut out, &kept);
    Ok(out)
}

/// A code picture found in a deck.
struct Found {
    slide: String,
    id: String,
    src: String,
    generator: PictureGenerator,
    rect: Option<(f64, f64, f64, f64)>,
}

fn collect(slide: &str, elements: &[Element], into: &mut Vec<Found>) {
    for element in elements {
        if let Element::Image(image) = element
            && let Some(generator) = image.generator()
        {
            into.push(Found {
                slide: slide.to_owned(),
                id: element.id().to_owned(),
                src: image.src.clone(),
                generator,
                rect: image.base.rect(),
            });
        }
        collect(slide, element.children(), into);
    }
}

/// Every code picture of the deck, in reading order.
fn code_pictures(deck: &Deck) -> Vec<Found> {
    let mut found = Vec::new();
    for slide in &deck.slides {
        collect(&slide.id, &slide.elements, &mut found);
    }
    found
}

pub(super) fn rerun_code_pictures(
    agent: &mut Agent,
    store: &mut dyn Store,
    args: &Value,
) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let found = code_pictures(&deck);
    if found.is_empty() {
        return Ok(ToolOutput::json(json!({
            "deck": name,
            "changed": false,
            "pictures": [],
            "message": "This deck has no code pictures. place_code_picture makes one.",
        })));
    }
    let mut report = Vec::new();
    let mut swaps = Vec::new();
    for one in &found {
        let said = |status: &str, more: Value| {
            let mut line = json!({ "slide": one.slide, "element": one.id, "status": status });
            if let (Some(target), Value::Object(extra)) = (line.as_object_mut(), more) {
                target.extend(extra);
            }
            line
        };
        match run_and_keep(store, &name, &deck, one.generator.clone()) {
            Ok(kept) => {
                let before = one.generator.last_run.as_ref().map(|r| r.hash.as_str());
                let now = kept.generator.last_run.as_ref().map(|r| r.hash.as_str());
                if kept.path == one.src && before == now {
                    report.push(said("unchanged", json!({ "picture": kept.path })));
                    continue;
                }
                report.push(said(
                    "updated",
                    json!({ "picture": kept.path, "warnings": kept.drawn.warnings }),
                ));
                let block =
                    serde_json::to_value(&kept.generator).map_err(|e| invalid(e.to_string()))?;
                swaps.push(Replacement {
                    slide: one.slide.clone(),
                    id: one.id.clone(),
                    path: kept.path.clone(),
                    block,
                    refit: refit(one.rect, &kept),
                });
            }
            Err(error) => report.push(said("failed", json!({ "error": error.message }))),
        }
    }
    if swaps.is_empty() {
        return Ok(ToolOutput::json(json!({
            "deck": name,
            "changed": false,
            "pictures": report,
        })));
    }
    let edited = swap(agent, store, &name, &swaps)?;
    agent.answer(store, &edited, json!({ "pictures": report }))
}
