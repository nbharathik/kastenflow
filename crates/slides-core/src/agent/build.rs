//! `build_deck`: a whole deck from one structured spec. Each slide names a layout and the words for its slots, and may
//! have elements, speaker notes and steps of its own. The spec is checked first and every problem is told at once; the
//! deck is made in memory and written as one new deck, so it is one change to undo and, in a vault that reviews an
//! assistant's work, one proposal.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::edit::apply_all;
use super::read::slide_title;
use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolOutput, ToolResult};
use crate::canonical;
use crate::model::{Deck, Element, PlaceholderKind};
use crate::ops::Engine;
use crate::themes;

/// The most slides one spec holds.
const MOST_SLIDES: usize = 100;
/// The most problems told one by one.
const MOST_TOLD: usize = 20;
/// The most clicks a slide has.
const MOST_STEPS: u64 = 50;
const DECK_FIELDS: [&str; 4] = ["title", "theme", "slides", "project"];
const SLIDE_FIELDS: [&str; 8] = [
    "layout", "slots", "image", "elements", "notes", "steps", "hidden", "backup",
];
const RECIPES: [&str; 3] = ["reveal", "walkthrough", "spotlight"];

/// How a slide's clicks are asked for.
enum Steps {
    Count(u64),
    Recipe {
        recipe: String,
        ids: Option<Vec<String>>,
    },
}

/// One slide of the spec, once it is known to be well formed.
struct Wanted {
    layout: String,
    content: BTreeMap<String, String>,
    image: Option<(String, Option<String>)>,
    elements: Vec<Value>,
    notes: Option<String>,
    hidden: bool,
    backup: bool,
    steps: Option<Steps>,
}

/// Where a field is, for a message: `slides[2].notes`, or `title` at the top.
fn path(at: &str, key: &str) -> String {
    if at.is_empty() {
        key.to_owned()
    } else {
        format!("{at}.{key}")
    }
}

fn text<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    at: &str,
    errors: &mut Vec<String>,
) -> Option<&'a str> {
    match object.get(key) {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.as_str()),
        Some(_) => {
            errors.push(format!("`{}` must be text", path(at, key)));
            None
        }
    }
}

fn flag(object: &Map<String, Value>, key: &str, at: &str, errors: &mut Vec<String>) -> bool {
    match object.get(key) {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => {
            errors.push(format!("`{}` must be true or false", path(at, key)));
            false
        }
    }
}

fn steps_of(value: &Value, at: &str, errors: &mut Vec<String>) -> Option<Steps> {
    let told = format!(
        "`{at}.steps` is a number of clicks (0 to {MOST_STEPS}), a recipe ({}), or {{recipe, ids?}}",
        RECIPES.join(", ")
    );
    let recipe = |name: &str| RECIPES.contains(&name).then(|| name.to_owned());
    let found = match value {
        Value::Null => return None,
        Value::Number(n) => n.as_u64().filter(|n| *n <= MOST_STEPS).map(Steps::Count),
        Value::String(name) => recipe(name).map(|recipe| Steps::Recipe { recipe, ids: None }),
        Value::Object(object) => object
            .get("recipe")
            .and_then(Value::as_str)
            .and_then(recipe)
            .map(|recipe| {
                let ids = object.get("ids").and_then(Value::as_array).map(|list| {
                    list.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                });
                Steps::Recipe { recipe, ids }
            }),
        _ => None,
    };
    if found.is_none() {
        errors.push(told);
    }
    found
}

/// Reads one slide of the spec, adding what is wrong with it to `errors`.
fn read_slide(item: &Value, at: &str, errors: &mut Vec<String>) -> Option<Wanted> {
    let Some(object) = item.as_object() else {
        errors.push(format!("`{at}` must be an object {{layout, slots, ...}}"));
        return None;
    };
    let before = errors.len();
    for key in object
        .keys()
        .filter(|k| !SLIDE_FIELDS.contains(&k.as_str()))
    {
        errors.push(format!(
            "`{at}.{key}` is not a field of a slide. The fields are: {}",
            SLIDE_FIELDS.join(", ")
        ));
    }
    let layout = text(object, "layout", at, errors)
        .unwrap_or("title-body")
        .to_owned();
    let mut content = BTreeMap::new();
    match object.get("slots") {
        None | Some(Value::Null) => {}
        Some(Value::Object(slots)) => {
            for (role, words) in slots {
                match words {
                    Value::String(words) => {
                        content.insert(role.clone(), words.clone());
                    }
                    _ => errors.push(format!("`{at}.slots.{role}` must be Markdown text")),
                }
            }
        }
        Some(_) => errors.push(format!(
            "`{at}.slots` must be an object of the words for each slot, by role"
        )),
    }
    let image = match object.get("image") {
        None | Some(Value::Null) => None,
        Some(Value::Object(picture)) => match picture
            .get("src")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            Some(src) => Some((
                src.to_owned(),
                picture
                    .get("alt")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            )),
            None => {
                errors.push(format!(
                    "`{at}.image.src` is missing: the picture's path, such as assets/figure.png"
                ));
                None
            }
        },
        Some(_) => {
            errors.push(format!("`{at}.image` must be {{src, alt?}}"));
            None
        }
    };
    let elements = match object.get("elements") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(list)) if list.iter().all(Value::is_object) => list.clone(),
        Some(_) => {
            errors.push(format!(
                "`{at}.elements` must be a list of elements, as add_elements takes them"
            ));
            Vec::new()
        }
    };
    let notes = text(object, "notes", at, errors).map(str::to_owned);
    let (hidden, backup) = (
        flag(object, "hidden", at, errors),
        flag(object, "backup", at, errors),
    );
    let steps = object.get("steps").and_then(|v| steps_of(v, at, errors));
    (errors.len() == before).then_some(Wanted {
        layout,
        content,
        image,
        elements,
        notes,
        hidden,
        backup,
        steps,
    })
}

/// The ids a recipe works on when the spec names none: everything but the title, the subtitle and the lines.
fn default_ids(deck: &Deck, slide: &str) -> Vec<String> {
    deck.slide(slide)
        .map(|s| {
            s.elements
                .iter()
                .filter(|e| !matches!(e, Element::Line(_) | Element::Connector(_)))
                .filter(|e| !matches!(e.base().placeholder.as_deref(), Some("title" | "subtitle")))
                .map(|e| e.id().to_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// Builds the slide `wanted` in `engine`; its id, or why it could not be.
fn build_slide(engine: &mut Engine, wanted: &Wanted) -> Result<String, ToolError> {
    let mut input =
        json!({ "layout": wanted.layout, "content": wanted.content, "backup": wanted.backup });
    if let Some(notes) = wanted.notes.as_deref().filter(|n| !n.trim().is_empty()) {
        input["notes"] = json!(notes);
    }
    let mut operations = vec![("add_slide".to_owned(), input)];
    // A text slot nothing was written for would only sit there asking to be filled.
    let bare: Vec<String> = engine
        .deck()
        .theme
        .layout(&wanted.layout)
        .map(|l| {
            l.placeholders
                .iter()
                .filter(|p| {
                    p.kind == PlaceholderKind::Text && !wanted.content.contains_key(&p.role)
                })
                .map(|p| format!("$1.elements.{}", p.role))
                .collect()
        })
        .unwrap_or_default();
    if !bare.is_empty() {
        operations.push((
            "delete_elements".to_owned(),
            json!({ "slide": "$1.slide", "ids": bare }),
        ));
    }
    if let Some((src, alt)) = &wanted.image {
        let mut patch = json!({ "src": src });
        if let Some(alt) = alt {
            patch["alt"] = json!(alt);
        }
        operations.push((
            "patch_elements".to_owned(),
            json!({ "slide": "$1.slide", "patches": [{ "id": "$1.elements.image", "patch": patch }] }),
        ));
    }
    if !wanted.elements.is_empty() {
        operations.push((
            "add_elements".to_owned(),
            json!({ "slide": "$1.slide", "elements": wanted.elements }),
        ));
    }
    if wanted.hidden {
        operations.push((
            "set_slide_flags".to_owned(),
            json!({ "ids": ["$1.slide"], "hidden": true }),
        ));
    }
    let results = apply_all(engine, operations)?;
    let slide = results
        .first()
        .and_then(|r| r["slide"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| ToolError::new("the slide was not made"))?;
    match &wanted.steps {
        None => {}
        Some(Steps::Count(n)) => {
            apply_all(
                engine,
                vec![(
                    "set_slide_steps".to_owned(),
                    json!({ "slide": slide, "steps": n }),
                )],
            )?;
        }
        Some(Steps::Recipe { recipe, ids }) => {
            let ids = ids
                .clone()
                .unwrap_or_else(|| default_ids(engine.deck(), &slide));
            apply_all(
                engine,
                vec![(
                    "build_steps".to_owned(),
                    json!({ "slide": slide, "ids": ids, "recipe": recipe }),
                )],
            )?;
        }
    }
    Ok(slide)
}

/// What is wrong with the spec as a whole.
fn read_deck_fields(args: &Value, errors: &mut Vec<String>) -> (String, String) {
    let object = args.as_object().cloned().unwrap_or_default();
    for key in object.keys().filter(|k| !DECK_FIELDS.contains(&k.as_str())) {
        errors.push(format!(
            "`{key}` is not a field of the spec. The fields are: title, theme, slides"
        ));
    }
    let title = text(&object, "title", "", errors)
        .map(str::trim)
        .filter(|t| !t.is_empty());
    if title.is_none() {
        errors.push("`title` is missing: the deck's title".to_owned());
    }
    let theme = text(&object, "theme", "", errors).unwrap_or(themes::DEFAULT);
    (title.unwrap_or("Untitled").to_owned(), theme.to_owned())
}

pub fn build_deck(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let mut errors: Vec<String> = Vec::new();
    let (title, theme) = read_deck_fields(args, &mut errors);
    let list = args.get("slides").and_then(Value::as_array);
    match list {
        None => errors.push("`slides` is missing: a list of {layout, slots, elements?, notes?, steps?}, one for each slide".to_owned()),
        Some(list) if list.is_empty() => errors.push("`slides` is empty: a deck has at least one slide".to_owned()),
        Some(list) if list.len() > MOST_SLIDES => {
            errors.push(format!("`slides` has {} slides; one call builds at most {MOST_SLIDES}", list.len()));
        }
        Some(_) => {}
    }
    let mut engine = match Engine::create(&title, &theme, store.entropy()) {
        Ok(engine) => engine,
        Err(e) => {
            errors.push(format!("`theme`: {e}"));
            return Err(told(&errors));
        }
    };
    let known = store.assets().unwrap_or_default();
    let mut warnings: Vec<String> = Vec::new();
    let cover = engine.deck().slides[0].id.clone();
    let mut made = 0;
    for (i, item) in list.into_iter().flatten().take(MOST_SLIDES).enumerate() {
        let at = format!("slides[{i}]");
        let Some(wanted) = read_slide(item, &at, &mut errors) else {
            continue;
        };
        match build_slide(&mut engine, &wanted) {
            Ok(_) => made += 1,
            Err(e) => errors.push(format!("`{at}` ({}): {}", wanted.layout, e.message)),
        }
        if let Some((src, _)) = &wanted.image
            && !known.iter().any(|a| &a.path == src)
        {
            warnings.push(format!("Slide {} uses the picture `{src}`, which is not in the store; add_asset puts it there.", i + 1));
        }
    }
    if !errors.is_empty() {
        return Err(told(&errors));
    }
    if made > 0
        && let Err(e) = engine.apply("delete_slides", json!({ "ids": [cover] }))
    {
        errors.push(format!("the deck's first slide could not be made: {e}"));
        return Err(told(&errors));
    }
    let deck = engine.into_deck();
    let written = canonical::write(&deck)?;
    let created = store.create(&title, &written)?;
    agent.remember(created.clone());
    let problems = agent.problems(store, &deck, &[]);
    let lines: Vec<Value> = deck
        .slides
        .iter()
        .enumerate()
        .map(|(n, s)| json!({ "n": n + 1, "id": s.id, "layout": s.layout, "title": slide_title(&deck, s) }))
        .collect();
    Ok(ToolOutput::json(json!({
        "deck": created.name,
        "hash": created.hash,
        "title": deck.title,
        "theme": deck.theme.name,
        "slides": lines,
        "warnings": warnings,
        "lint": problems,
        "next": "get_deck shows the slides and their ids; render_grid shows them all; lint_deck says what to fix.",
    })))
}

/// Every problem of the spec in one answer; nothing was written.
fn told(errors: &[String]) -> ToolError {
    let shown: Vec<String> = errors
        .iter()
        .take(MOST_TOLD)
        .map(|e| format!("- {e}"))
        .collect();
    let more = errors.len().saturating_sub(MOST_TOLD);
    ToolError::new(format!(
        "Nothing was written: the spec has {} problem{}.\n{}{}",
        errors.len(),
        if errors.len() == 1 { "" } else { "s" },
        shown.join("\n"),
        if more > 0 {
            format!("\n- and {more} more")
        } else {
            String::new()
        }
    ))
}
