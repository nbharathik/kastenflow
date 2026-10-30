//! The list of tools: the operations of the engine, each as a tool of its own
//! name with the description and JSON Schema the registry holds, and the
//! tools that look, create, and take the shapes an agent reaches for. A new
//! operation in the registry becomes a tool by itself.

use serde_json::{Value, json};

use super::catalog;
use crate::ops;

/// A tool, as a protocol lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    /// A JSON Schema of an object: the arguments.
    pub input_schema: Value,
    /// Whether the tool only looks.
    pub read_only: bool,
}

/// Operations that a tool of another name takes the place of, or that are for
/// the editor. They still work inside `update_elements`.
const HIDDEN: &[&str] = &[
    "accept_marks",
    "set_layout",
    "duplicate_slides",
    "set_step_states",
    "build_steps",
    "paste_elements",
    "collapse_slides",
    "add_slides",
    "replace_deck",
    // The layouts a person keeps are the editor's: an assistant reads them with `list_layouts` and
    // uses them with `add_slide`. A template is put on a deck with `apply_deck_template`, which names a
    // deck to take the look from; the operation takes a theme as data, which an assistant has no way to write.
    "add_layout",
    "save_layout",
    "edit_layout",
    "set_layout_design",
    "delete_layout",
    "move_layout",
    "import_layouts",
    "reset_slides",
    "apply_template",
    // What a person puts on a slide from a page of the host with Insert → Page. An assistant has no page to read it from
    // and writes the slide with `add_slide` and `set_text`.
    "add_page_contents",
    "update_page_contents",
    "add_page_slides",
    // A storyboard is drafted and edited by a person in the editor; an assistant makes slides with `add_slide` (or `deck_from_note`).
    "add_storyboard_slides",
    "acknowledge_source",
];

/// Whether `name` is an operation that is not a tool of its own (see `HIDDEN`): it works inside
/// `update_elements`, and called by name it is not offered.
pub(super) fn is_hidden(name: &str) -> bool {
    HIDDEN.contains(&name)
}

/// The order tools are listed in: look, make, change slides, change elements, steps, files.
const ORDER: &[&str] = &[
    "list_decks",
    "get_deck",
    "get_slide",
    "get_outline",
    "list_layouts",
    "get_theme",
    "search_assets",
    "lint_deck",
    "create_deck",
    "add_slide",
    "duplicate_slide",
    "delete_slides",
    "reorder_slides",
    "move_slides",
    "apply_layout",
    "apply_theme",
    "apply_deck_template",
    "edit_theme",
    "set_title",
    "set_present",
    "set_page_size",
    "set_notes",
    "set_background",
    "set_slide_flags",
    "set_text",
    "set_rich_text",
    "format_paragraphs",
    "set_cells",
    "clear_cells",
    "insert_rows",
    "delete_rows",
    "insert_columns",
    "delete_columns",
    "merge_cells",
    "unmerge_cells",
    "set_cell_fill",
    "add_diagram",
    "place_image",
    "add_elements",
    "update_elements",
    "patch_elements",
    "transform_elements",
    "delete_elements",
    "reorder_elements",
    "group_elements",
    "ungroup_element",
    "duplicate_elements",
    "align_elements",
    "distribute_elements",
    "expand_composite",
    "replace_all",
    "set_logo",
    "set_steps",
    "set_slide_steps",
    "set_transition",
    "set_morph",
    "add_asset",
    "export",
    "import_pptx",
    "trash_deck",
    "render_slide",
    "render_grid",
];

/// The kinds of element an assistant makes. `raw` is left out: an import makes those.
const ELEMENT_KINDS: [&str; 19] = [
    "text",
    "shape",
    "line",
    "connector",
    "image",
    "group",
    "table",
    "code",
    "math",
    "chat",
    "token-probs",
    "card-grid",
    "citation",
    "step-label",
    "embed",
    "video",
    "chart",
    "timer",
    "qr",
];

pub(super) fn object(properties: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": properties, "required": required, "additionalProperties": false })
}

pub(super) fn deck_property() -> Value {
    json!({ "type": "string", "description": "The deck's file name, such as talk.deck. Optional when there is only one deck." })
}

pub(super) fn slide_property() -> Value {
    json!({ "type": "string", "description": "The slide: its id (s-…) or its number from 1." })
}

/// How the words of a text box, a shape or a table cell are written, in few words.
const TEXT_SHAPE: &str = "{paragraphs: [{runs: [{t, b?, i?, u?, color?, highlight? (a colour behind the words), size? (points), font? (heading, body, code or a family)}], align?, list? (bullet or number), listStyle? (disc, circle, square, arrow, check, dash, decimal, decimalParen, lowerAlpha, upperAlpha, lowerRoman, upperRoman), start? (a numbered item counts from this number), level?, style? (title, subtitle, body, caption, code, citation)}], valign? (top, middle, bottom), fit? (shrink: smaller type until it fits; resize: the box grows)}";

/// What a text is, in few enough words to send with every tool that takes one (the cells of a table do).
fn compact_text() -> Value {
    json!({
        "type": "object",
        "description": format!("The words, as paragraphs of runs: {TEXT_SHAPE}. Markdown, where a tool takes it, is easier."),
        "required": ["paragraphs"],
        "additionalProperties": true
    })
}

/// What an element is, in few enough words to send with every tool that takes one.
fn compact_element() -> Value {
    json!({
        "type": "object",
        "description": "One element of a slide. `type` is text, shape, line, connector, image, group, table or a composite (code, math, chat, token-probs, card-grid, citation, step-label, embed, video, chart, timer, qr; see the instructions for each). Give a box in slide units (x, y, w, h; get_deck says how big the deck's slides are) or a `placeholder` role to fill a slot of the layout. Colours are theme tokens (text1, text2, bg1, bg2, accent1 to accent6) or #rrggbb. An image may have `crop` {left, top, right, bottom: fractions cut from each edge} and `mask` (rect, roundRect, ellipse); any element may be `locked` or have a `morphId`.",
        "required": ["type"],
        "properties": {
            "type": { "type": "string", "enum": ELEMENT_KINDS },
            "id": { "type": "string", "description": "Optional; one is made when it is left out." },
            "x": { "type": "number" }, "y": { "type": "number" }, "w": { "type": "number" }, "h": { "type": "number" },
            "rotation": { "type": "number", "description": "Degrees clockwise." },
            "placeholder": { "type": "string", "description": "The slot of the slide's layout it fills: title, body, image ..." },
            "name": { "type": "string", "description": "The layer's name in the Steps panel." },
            "alt": { "type": "string", "description": "What a person who cannot see it is told. Pictures need it." },
            "link": { "type": "string", "description": "A web address, or slide:<id>." },
            "style": { "type": "object", "description": "fill {color, alpha?}, stroke {color, width?, dash?}, radius, shadow {color, blur, dx, dy}, opacity 0 to 1, startArrow and endArrow (none, triangle, stealth, open, oval, diamond)." },
            "text": { "type": "object", "description": format!("For text and shape: {TEXT_SHAPE}.") },
            "markdown": { "type": "string", "description": "For text and shape: the words as Markdown instead of `text`: **bold**, *italic*, `code`, [link](url), - bullets, 1. numbers, one paragraph per line." },
            "shape": { "type": "string", "description": "For a shape: rect, roundRect, ellipse, triangle, diamond, chevron, rightArrow ..." },
            "src": { "type": "string", "description": "For an image or video: a path in the store, such as assets/figure.png." },            "from": { "type": "object", "description": "For a connector: {el: id, side: left, right, top or bottom}. `to` is the same." },
            "to": { "type": "object" },
            "route": { "type": "string", "enum": ["straight", "elbow", "curved"] },
            "children": { "type": "array", "description": "For a group: its elements.", "items": { "type": "object" } }
        },
        "additionalProperties": true
    })
}

/// Every `$defs` name a schema refers to, following the definitions it reaches.
fn reachable(
    schema: &Value,
    defs: &serde_json::Map<String, Value>,
    found: &mut std::collections::BTreeSet<String>,
) {
    match schema {
        Value::Object(map) => {
            if let Some(Value::String(r)) = map.get("$ref")
                && let Some(name) = r.strip_prefix("#/$defs/")
                && found.insert(name.to_owned())
                && let Some(def) = defs.get(name)
            {
                reachable(def, defs, found);
            }
            for (key, value) in map {
                if key != "$defs" {
                    reachable(value, defs, found);
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|v| reachable(v, defs, found)),
        _ => {}
    }
}

/// The registry's schema for an operation's input, made small enough to send: the definition of an element is replaced by a short description, and any other bulky definition by a plain object.
fn schema_for(input: &Value) -> Value {
    let mut schema = input.clone();
    if let Some(map) = schema.as_object_mut() {
        map.remove("$schema");
        map.remove("title");
        // The tool's own description says it; the doc comment of the type would say it twice.
        map.remove("description");
        if let Some(Value::Object(defs)) = map.get_mut("$defs") {
            for (name, def) in defs.iter_mut() {
                if name == "Element" {
                    *def = compact_element();
                } else if name == "Text" {
                    *def = compact_text();
                } else if def.to_string().len() > 4000 {
                    let about = def.get("description").cloned().unwrap_or_else(|| {
                        json!(format!("A {name}; get_slide and get_theme show one."))
                    });
                    *def = json!({ "type": "object", "description": about, "additionalProperties": true });
                }
            }
        }
        if let Some(Value::Object(properties)) = map.get_mut("properties") {
            properties.insert("deck".to_owned(), deck_property());
        }
    }
    // What the replaced definitions used to refer to is not needed any more.
    if let Some(defs) = schema.get("$defs").and_then(Value::as_object).cloned() {
        let mut used = std::collections::BTreeSet::new();
        reachable(&schema, &defs, &mut used);
        if let Some(Value::Object(kept)) = schema.get_mut("$defs") {
            kept.retain(|name, _| used.contains(name));
            if kept.is_empty() {
                schema.as_object_mut().map(|m| m.remove("$defs"));
            }
        }
    }
    schema
}

/// What an operation says of itself, with what an assistant needs to choose between it and the tool next to it.
fn described(name: &str, about: &str) -> String {
    let more = match name {
        "move_slides" => {
            " Name slides by id (get_deck shows them); reorder_slides orders all at once."
        }
        "set_rich_text" => {
            " It replaces all the words, so say all of them. Use set_text for Markdown; format_paragraphs changes lists and alignment without rewriting."
        }
        "set_slide_steps" => {
            " Only the count changes; set_steps does this too and also builds up a slide."
        }
        _ => "",
    };
    format!("{about}{more}")
}

/// Every tool, in the order an agent should read them.
pub fn tools() -> Vec<ToolSpec> {
    let mut all = catalog::custom();
    for spec in ops::specs() {
        if HIDDEN.contains(&spec.name.as_str()) || all.iter().any(|t| t.name == spec.name) {
            continue;
        }
        all.push(ToolSpec {
            description: described(&spec.name, &spec.about),
            name: spec.name,
            input_schema: schema_for(&spec.input),
            read_only: false,
        });
    }
    let place = |name: &str| ORDER.iter().position(|n| *n == name).unwrap_or(usize::MAX);
    all.sort_by_key(|t| place(&t.name));
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_has_a_description_and_an_object_schema_and_names_are_unique() {
        let all = tools();
        let mut names: Vec<&str> = all.iter().map(|t| t.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), all.len());
        for t in &all {
            assert!(t.description.len() > 20, "{}", t.name);
            assert_eq!(t.input_schema["type"], "object", "{}", t.name);
        }
    }

    #[test]
    fn every_operation_is_a_tool_unless_another_tool_takes_its_place() {
        let names: Vec<String> = tools().into_iter().map(|t| t.name).collect();
        for op in ops::names() {
            assert!(
                names.iter().any(|n| n == op) || HIDDEN.contains(&op),
                "{op} is not a tool"
            );
        }
        for wanted in [
            "add_slide",
            "add_diagram",
            "set_text",
            "apply_theme",
            "delete_slides",
            "set_notes",
            "set_steps",
            "set_morph",
            "apply_layout",
            "reorder_slides",
            "duplicate_slide",
            "place_image",
            "update_elements",
        ] {
            assert!(names.iter().any(|n| n == wanted), "{wanted}");
        }
    }

    #[test]
    fn the_words_for_an_element_name_what_the_editor_lets_a_person_set_on_a_picture() {
        let all = tools();
        let add = all.iter().find(|t| t.name == "add_elements").unwrap();
        let schema = add.input_schema.to_string();
        for field in ["crop", "mask", "locked", "morphId"] {
            assert!(schema.contains(field), "{field} is not in the words");
        }
    }

    #[test]
    fn the_schemas_are_small_enough_to_send_with_every_session() {
        let all = tools();
        for t in &all {
            let size = t.input_schema.to_string().len();
            assert!(size < 8_000, "{} is {size} bytes", t.name);
        }
        let total: usize = all
            .iter()
            .map(|t| t.input_schema.to_string().len() + t.description.len())
            .sum();
        assert!(total < 60_000, "{total} bytes in all");
        let add = all.iter().find(|t| t.name == "add_elements").unwrap();
        assert!(
            add.input_schema.to_string().contains("markdown"),
            "elements may say their words in Markdown"
        );
    }
}
