//! The tools that are not one operation of the engine: the ones that look,
//! the ones that make a deck or put a picture on a slide, the batch, and the
//! files. Their descriptions are what an agent reads to choose a tool.

use serde_json::{Value, json};

use super::specs::{ToolSpec, deck_property, object, slide_property};

pub(super) fn custom() -> Vec<ToolSpec> {
    let tool = |name: &str, read_only: bool, description: &str, input_schema: Value| ToolSpec {
        name: name.to_owned(),
        description: description.to_owned(),
        input_schema,
        read_only,
    };
    let deck = || json!({ "deck": deck_property() });
    let deck_and_slide = || json!({ "deck": deck_property(), "slide": slide_property() });
    vec![
        tool(
            "list_decks",
            true,
            "The decks in the folder: file name, title, number of slides, when last changed.",
            object(json!({}), &[]),
        ),
        tool(
            "get_deck",
            true,
            "A deck at a glance: title, theme, version, lint counts, and one line for each slide (number, id, layout, title, elements, steps, problems). Start here: the ids it shows are what the other tools take.",
            object(deck(), &[]),
        ),
        tool(
            "get_slide",
            true,
            "One slide in full (its elements as JSON) with the lint issues on it.",
            object(deck_and_slide(), &["slide"]),
        ),
        tool(
            "get_outline",
            true,
            "The deck as a Markdown outline: a `##` heading for each slide, its text, and its notes.",
            object(deck(), &[]),
        ),
        tool(
            "list_layouts",
            true,
            "The layouts the deck's theme offers, each with its slots (role, kind, box, text style, prompt). add_slide fills slots by role. A layout the deck's owner made is marked `custom`; it may draw decoration behind its slides (`decoration`) or have a background of its own, and prefer it to a built-in one when it fits.",
            object(deck(), &[]),
        ),
        tool(
            "get_theme",
            true,
            "The deck's theme: colours, fonts, text styles with their sizes, and the names of the built-in themes apply_theme takes.",
            object(deck(), &[]),
        ),
        tool(
            "search_assets",
            true,
            "The pictures in the store's assets, with their sizes; `query` keeps those whose path contains it.",
            object(json!({ "query": { "type": "string" } }), &[]),
        ),
        tool(
            "lint_deck",
            true,
            "Checks the deck for problems a person or an agent should fix before it is shown: text overflowing, things off the slide or overlapping, small type, weak contrast, missing pictures' words, unknown citations, and more. Errors first, each with the fix. Run it after every batch of changes and finish only with no errors.",
            object(
                json!({ "deck": deck_property(), "slide": slide_property(), "severity": { "type": "string", "enum": ["error", "warning", "info"], "description": "Only issues at least this serious." } }),
                &[],
            ),
        ),
        tool(
            "create_deck",
            false,
            "Makes a new deck from a Markdown outline and returns what was made. `# Title` names the deck and each `## Slide title` starts a slide; under it, blocks separated by blank lines are laid out in a layout chosen for what is there (one block: title and body; two: two columns; a picture `![alt](assets/x.png)`: title and image; a fenced block: code; a `>` quote: quote; nothing: a section slide). `<!-- layout: name -->` after a title picks a layout; `Notes:` starts speaker notes. A deck is not replaced if it exists.",
            object(
                json!({
                    "outline": { "type": "string", "description": "The deck as Markdown." },
                    "title": { "type": "string", "description": "The deck's title, if not the `#` line's." },
                    "theme": { "type": "string", "description": "Light (default), Dark, Serif, Lecture, Minimal, Bold, Modern, Academic, Pitch, Dark Studio or Warm Paper." },
                    "subtitle": { "type": "string", "description": "For the cover slide." }
                }),
                &["outline"],
            ),
        ),
        tool(
            "update_elements",
            false,
            "Applies several operations to a deck together: all of them take effect, or none does and nothing changes. Each is {\"op\": name, \"input\": {...}} with any operation's name (add_slide, add_elements, patch_elements, transform_elements, set_text, add_diagram, delete_elements, group_elements, align_elements, set_transition ...) and the input its own tool takes, without `deck`. A later operation may use what an earlier one returned: \"$1.slide\" is the `slide` that operation 1 returned, \"$1.elements.body\" the id of its body slot. Use it to build a slide in one call.",
            object(
                json!({
                    "deck": deck_property(),
                    "operations": { "type": "array", "items": object(json!({ "op": { "type": "string" }, "input": { "type": "object" } }), &["op"]) }
                }),
                &["operations"],
            ),
        ),
        tool(
            "place_image",
            false,
            "Puts a picture from the store on a slide at its own proportions, never stretched. Where: `placeholder` (a picture slot of the layout, by role; by default the slide's empty one), `box` ({x, y, w, h}: the picture is fitted and centred in it), or `auto` (the largest free space that avoids the other elements). `id` replaces the picture of an element that is there. Give `alt` words for a person who cannot see it.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "src": { "type": "string", "description": "The picture's path, such as assets/figure.png." },
                    "placeholder": { "type": "string" },
                    "box": object(json!({ "x": { "type": "number" }, "y": { "type": "number" }, "w": { "type": "number" }, "h": { "type": "number" } }), &["x", "y", "w", "h"]),
                    "auto": { "type": "boolean" },
                    "id": { "type": "string" },
                    "alt": { "type": "string" }
                }),
                &["slide", "src"],
            ),
        ),
        tool(
            "apply_layout",
            false,
            "Puts a slide on another layout (see list_layouts). Its content moves to the matching slots by role; what has no slot stays where it was; nothing is deleted.",
            object(
                json!({ "deck": deck_property(), "slide": slide_property(), "layout": { "type": "string" } }),
                &["slide", "layout"],
            ),
        ),
        tool(
            "duplicate_slide",
            false,
            "Copies a slide right after itself, `count` times (1 to 10). A copy keeps its elements' ids, so a copy changed a little is ready for a Morph transition (set_morph).",
            object(
                json!({ "deck": deck_property(), "slide": slide_property(), "count": { "type": "integer", "minimum": 1, "maximum": 10 } }),
                &["slide"],
            ),
        ),
        tool(
            "reorder_slides",
            false,
            "Puts the slides in a new order. `order` lists every slide once, by id or number, in the order you want.",
            object(
                json!({ "deck": deck_property(), "order": { "type": "array", "items": { "type": "string" } } }),
                &["order"],
            ),
        ),
        tool(
            "set_steps",
            false,
            "Gives a slide clicks: things appearing, being highlighted or dimmed as the presenter clicks. `recipe`: reveal (the `ids` appear one by one in reading order; one text box with a list shows an item at a time), walkthrough (each is highlighted in turn while the others dim), spotlight (each stays as it is in turn while the others dim) or clear. `ids` default to every element but the title and the lines. Or give `states`: for an element id, its state at steps, {\"e-1\": {\"0\": \"hidden\", \"2\": \"normal\"}} (hidden, dimmed, normal, highlighted), or `steps`: how many clicks the slide has.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "recipe": { "type": "string", "enum": ["reveal", "walkthrough", "spotlight", "clear"] },
                    "ids": { "type": "array", "items": { "type": "string" } },
                    "states": { "type": "object" },
                    "steps": { "type": "integer", "minimum": 0, "maximum": 50 }
                }),
                &["slide"],
            ),
        ),
        tool(
            "set_morph",
            false,
            "Makes a slide arrive with the Morph transition: elements that share an id (or morphId) with the slide before glide from their old place and size to the new. Make the slide by duplicate_slide and change the copy. Tells you how many elements the two slides share.",
            object(
                json!({ "deck": deck_property(), "slide": slide_property(), "duration": { "type": "number", "description": "Seconds; 0.6 by default." } }),
                &["slide"],
            ),
        ),
        tool(
            "add_asset",
            false,
            "Puts a picture in the store's assets so decks can use it. Give its bytes as `base64`, or a `path` of a file inside the folder the decks are in, and a `name`. PNG, JPEG, GIF, WebP and SVG only. Returns its path (assets/…) and size.",
            object(
                json!({ "name": { "type": "string" }, "base64": { "type": "string" }, "path": { "type": "string" } }),
                &[],
            ),
        ),
        tool(
            "export",
            false,
            "Writes the deck as a file beside it: `pptx` (an editable PowerPoint file with native shapes, text and pictures; warnings say what could not be written exactly) or `markdown` (the outline). PDF, PNG and HTML are not available in this build.",
            object(
                json!({ "deck": deck_property(), "format": { "type": "string", "enum": ["pptx", "markdown", "pdf", "png", "html"] } }),
                &[],
            ),
        ),
        tool(
            "import_pptx",
            false,
            "Makes a new deck from a PowerPoint file inside the folder the decks are in. Everything is kept; what could not be understood becomes a `raw` element.",
            object(
                json!({ "path": { "type": "string" }, "title": { "type": "string" } }),
                &["path"],
            ),
        ),
        tool(
            "trash_deck",
            false,
            "Puts a deck in the trash, where a person can restore it. Nothing is deleted.",
            object(deck(), &[]),
        ),
        tool(
            "render_slide",
            true,
            "Draws one slide as a picture for you to look at: the slide as a person sees it, laid out and coloured by a browser. Look at what you build, slide by slide, after each batch of changes: lint cannot tell you that a slide is dull, crowded or unbalanced. `step` draws it as it stands at a click (from 0; the last state when left out); `scale` is the pixels to each unit of the slide (0.25 to 4; 1 by default). Needs Chrome or Chromium on this machine; without one it says so, and lint_deck is what is left to see with.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "step": { "type": "integer", "minimum": 0, "description": "The click to draw the slide at, from 0. Left out, the slide as it ends." },
                    "scale": { "type": "number", "minimum": 0.25, "maximum": 4, "description": "Pixels to each unit of the slide; 1 by default." }
                }),
                &["slide"],
            ),
        ),
        tool(
            "render_grid",
            true,
            "Draws every slide as a labelled thumbnail in one picture, to see the whole deck at once: the rhythm of layouts, what repeats, what is crowded, whether the slides look like one deck. Needs Chrome or Chromium on this machine; without one it says so.",
            object(deck(), &[]),
        ),
    ]
}
