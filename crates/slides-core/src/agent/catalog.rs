//! The tools that are not one operation of the engine: the ones that look,
//! the ones that make a deck or put a picture on a slide, the batch, and the
//! files. Their descriptions are what an agent reads to choose a tool.

use serde_json::{Value, json};

use super::specs::{ToolSpec, box_property, deck_property, object, slide_property};

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
            "The layouts the deck's theme offers, each with its slots (role, kind, box, text style, prompt). add_slide fills slots by role. A layout the deck's owner made is marked `custom` (it may draw `decoration` or have a background); prefer it to a built-in one when it fits. Layouts the person keeps for every deck follow under `library`; they are not in the deck until the person uses one.",
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
            "list_deck_comments",
            true,
            "The comments left on the deck's slides, with their answers: id, slide, what it is pinned to, author (an assistant's are marked `agent`), words, when, and whether it is settled. `slide` keeps one slide's; `status` is open, resolved or all (the default). Read them before you change a slide; settle one with resolve_deck_comment when done.",
            object(
                json!({ "deck": deck_property(), "slide": slide_property(), "status": { "type": "string", "enum": ["open", "resolved", "all"] } }),
                &[],
            ),
        ),
        tool(
            "create_deck",
            false,
            "Makes a new deck from a Markdown outline. `# Title` names the deck and each `## Slide title` starts a slide; under it, blocks separated by blank lines get a layout chosen for what is there (one block: title and body; two: two columns; a picture `![alt](assets/x.png)`: title and image; a fenced block: code; a `>` quote: quote; nothing: a section slide). `<!-- layout: name -->` after a title picks a layout; `Notes:` starts speaker notes. A deck is not replaced if it exists.",
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
            "Applies several operations to a deck together: all take effect, or none does. Each is {\"op\": name, \"input\": {...}} with any operation's name (add_slide, add_elements, patch_elements, transform_elements, set_text, add_diagram, delete_elements, group_elements, align_elements, set_transition ...) and the input its own tool takes, without `deck`. A later operation may use what an earlier one returned: \"$1.slide\" is the `slide` operation 1 returned, \"$1.elements.body\" the id of its body slot. Use it to build a slide in one call.",
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
            "Puts a picture from the store on a slide at its own proportions, never stretched. Where: `placeholder` (a picture slot, by role; by default the empty one), `box` ({x, y, w, h}: fitted and centred in it), or `auto` (the largest free space). `id` replaces the picture of an element there. Give `alt` words.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "src": { "type": "string", "description": "The picture's path, such as assets/figure.png." },
                    "placeholder": { "type": "string" },
                    "box": box_property(),
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
            "apply_deck_template",
            false,
            "Puts the look of another deck, such as a template, on this deck: colours, fonts, text styles, layouts and what every slide shows behind it. Every slide keeps its words and elements; the template is only read. apply_theme is for the built-in themes.",
            object(
                json!({
                    "deck": deck_property(),
                    "template": { "type": "string", "description": "The deck to take the look from, named like `deck`." },
                    "resize": { "type": "boolean", "description": "Also take its page size and refit the slides." }
                }),
                &["template"],
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
            "Gives a slide clicks: things appearing, highlighted or dimmed as the presenter clicks. `recipe`: reveal (the `ids` appear one by one in reading order; a text box with a list shows an item at a time), walkthrough (each is highlighted in turn, the others dim), spotlight (each stays as it is in turn, the others dim) or clear. `ids` default to every element but the title and the lines. Or give `states`: an element id's state at steps, {\"e-1\": {\"0\": \"hidden\", \"2\": \"normal\"}} (hidden, dimmed, normal, highlighted), or `steps`: how many clicks the slide has.",
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
            "Writes the deck as a file beside it: `pptx` (editable PowerPoint with native shapes, text and pictures; warnings say what could not be written exactly), `markdown` (the outline) or `png` (a picture of each slide, up to 20, as render_slide draws them, so it needs a browser or the open KastenFlow app). PDF and HTML are written by KastenFlow Slides itself (File, Download).",
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
            "Draws one slide as a picture for you to look at. Look at what you build after each batch of changes: lint cannot tell you a slide is dull, crowded or unbalanced. `step` draws it at a click (from 0; the end state when left out); `scale` is pixels to each unit (0.25 to 4; 1 by default). To see a change before you write it, give `elements` (as add_elements takes them) or `operations` (as update_elements takes them): nothing is written. Needs a browser on this machine or the open KastenFlow app; without either, lint_deck is what is left.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "step": { "type": "integer", "minimum": 0, "description": "The click to draw at, from 0." },
                    "scale": { "type": "number", "minimum": 0.25, "maximum": 4 },
                    "elements": { "type": "array", "items": { "type": "object" }, "description": "Elements to draw as if added." },
                    "operations": { "type": "array", "items": { "type": "object" }, "description": "Operations to draw as if applied: {op, input}." }
                }),
                &["slide"],
            ),
        ),
        tool(
            "render_diff",
            true,
            "Draws one slide before (left) and after a change, changed areas outlined. Give `elements` or `operations` (as render_slide takes) to see a change before you write it, or `before`, a deck hash (from get_deck or a write tool): the slide as it was then and as it is now. With neither, it is compared with the version before the latest this server read. Needs the open KastenFlow app.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "before": { "type": "string", "description": "A deck hash, or a render id from render_slide." },
                    "elements": { "type": "array", "items": { "type": "object" } },
                    "operations": { "type": "array", "items": { "type": "object" } },
                    "step": { "type": "integer", "minimum": 0 },
                    "scale": { "type": "number", "minimum": 0.25, "maximum": 4 }
                }),
                &["slide"],
            ),
        ),
        tool(
            "render_grid",
            true,
            "Draws every slide as a labelled thumbnail in one picture, to see the whole deck at once: the rhythm of layouts, what repeats, what is crowded, whether the slides look like one deck. Draws in a browser on this machine or in the open KastenFlow app; without either it says so.",
            object(deck(), &[]),
        ),
        tool(
            "build_deck",
            false,
            "Makes a whole new deck from one spec, in one change (one undo): `title`, `theme` and `slides`, each slide {layout, slots (Markdown by role, as add_slide takes), image {src, alt}, elements (as add_elements takes them), notes, steps (clicks, or a recipe: reveal, walkthrough, spotlight), hidden, backup}. Give each slide a layout and its slots, not raw positions. Everything is checked first and every problem is told at once; if there is one, nothing is written. create_deck is for a Markdown outline.",
            object(
                json!({
                    "title": { "type": "string" },
                    "theme": { "type": "string", "description": "Light (default), Dark, Serif, Lecture, Minimal, Bold, Modern, Academic, Pitch, Dark Studio or Warm Paper." },
                    "slides": { "type": "array", "items": {
                        "type": "object",
                        "properties": {
                            "layout": { "type": "string", "description": "A layout of the theme (list_layouts); title-body when left out." },
                            "slots": { "type": "object", "description": "The words for each slot of the layout, by role, in Markdown." },
                            "image": { "type": "object", "description": "{src, alt?}: the picture of the layout's image slot." },
                            "elements": { "type": "array", "items": { "type": "object" } },
                            "notes": { "type": "string" },
                            "steps": { "description": "A number of clicks, a recipe (reveal, walkthrough, spotlight), or {recipe, ids?}." },
                            "hidden": { "type": "boolean" },
                            "backup": { "type": "boolean" }
                        }
                    } }
                }),
                &["title", "slides"],
            ),
        ),
        tool(
            "set_chart_data",
            false,
            "Fills a chart (an element of type `chart`, made with add_elements) with numbers and sets how it looks, in one change. Give the table once: `csv` (a header row, then a row for each category: its name, then a number for each series; for a scatter chart the first column is the horizontal number), or `rows` (the same as lists), or `categories` with `series`. `kind` is column, stackedColumn, line, area, stackedArea, pie, doughnut, scatter or combo (`lines` names the series a combo draws as lines). `xTitle`, `yTitle`, `format` (a number pattern such as `#,##0` or `0.0%`, on the axis and the marks), `labels`, `legend` and `legendPosition` set the rest. What you leave out stays. A mistake names the field and changes nothing.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "id": { "type": "string", "description": "The chart element's id." },
                    "kind": { "type": "string" },
                    "title": { "type": "string" },
                    "csv": { "type": "string", "description": "The table as CSV, header row first." },
                    "rows": { "type": "array", "items": { "type": "array" } },
                    "categories": { "type": "array", "items": { "type": "string" } },
                    "series": { "type": "array", "items": { "type": "object" }, "description": "Each {name, values, color?, x?, mark?}." },
                    "lines": { "type": "array", "items": { "type": "string" } },
                    "xTitle": { "type": "string" }, "yTitle": { "type": "string" },
                    "format": { "type": "string" },
                    "labels": { "type": "boolean" }, "legend": { "type": "boolean" },
                    "legendPosition": { "type": "string", "enum": ["top", "bottom", "left", "right"] },
                    "innerRadius": { "type": "number", "description": "For a doughnut: 0.1 to 0.9." }
                }),
                &["slide", "id"],
            ),
        ),
        tool(
            "place_diagram",
            false,
            "Puts a draw.io diagram of the vault on a slide as a picture kept in the assets, at its own proportions; it remembers the diagram so the editor can offer Update from diagram. `diagram` is its path or title. Where: `placeholder`, `box` or `auto` (the default), as place_image takes them. Give `alt` words.",
            object(
                json!({
                    "deck": deck_property(), "slide": slide_property(),
                    "diagram": { "type": "string", "description": "The diagram's path or title." },
                    "placeholder": { "type": "string" },
                    "box": box_property(),
                    "auto": { "type": "boolean" },
                    "id": { "type": "string" },
                    "alt": { "type": "string" }
                }),
                &["slide", "diagram"],
            ),
        ),
        tool(
            "replace_asset",
            false,
            "Swaps a picture for another everywhere a deck uses it, in one change: slides (groups too), stills of videos and web pages, and backgrounds. Each element keeps its box, crop, mask and words. The old picture is kept. Uses in the master or a layout are counted, not changed.",
            object(
                json!({
                    "deck": deck_property(),
                    "from": { "type": "string", "description": "The picture to replace, such as assets/old.png." },
                    "to": { "type": "string", "description": "The picture to use instead, already in the store." }
                }),
                &["from", "to"],
            ),
        ),
        tool(
            "set_notes_bulk",
            false,
            "Writes the speaker notes of many slides in one change. Every entry is checked first; if one is wrong, none is written. Markdown; an empty note clears the slide's notes.",
            object(
                json!({
                    "deck": deck_property(),
                    "notes": { "type": "array", "items": object(json!({ "slide": slide_property(), "notes": { "type": "string" } }), &["slide", "notes"]) }
                }),
                &["notes"],
            ),
        ),
        tool(
            "slides_help",
            true,
            "How to build a deck that reads well, in a few lines: the order of work (outline, build, render, lint, fix) and the tool for each step. Read it before you start one.",
            object(json!({}), &[]),
        ),
    ]
}
