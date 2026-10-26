//! What each action stands for: the operation, by name and input, that does it on the deck the run has reached.

use serde_json::{Value, json};

use super::actions::Action;
use crate::model::Deck;

/// The sizes of the decks a pasted slide or layout may come from: bigger, smaller, another shape, and the same.
const SIZES: [(f64, f64); 4] = [
    (1280.0, 720.0),
    (480.0, 270.0),
    (720.0, 540.0),
    (960.0, 540.0),
];

/// The operation an action stands for on this deck, if it names things that exist.
pub(super) fn plan(deck: &Deck, action: &Action) -> Option<(&'static str, Value)> {
    let slide = |i: usize| deck.slides.get(i % deck.slides.len().max(1));
    let element = |s: usize, i: usize| {
        slide(s).and_then(|sl| {
            sl.elements
                .get(i % sl.elements.len().max(1))
                .map(|e| (sl.id.clone(), e.id().to_owned()))
        })
    };
    Some(match action {
        Action::AddSlide { layout } => (
            "add_slide",
            json!({ "layout": deck.theme.layouts[layout % deck.theme.layouts.len()].name }),
        ),
        Action::AddText { slide: s, x, y } => (
            "add_elements",
            json!({ "slide": slide(*s)?.id, "elements": [{ "type": "text", "x": x, "y": y, "w": 120, "h": 40, "text": { "paragraphs": [{ "runs": [{ "t": "hi" }] }] } }] }),
        ),
        Action::Transform {
            slide: s,
            el,
            x,
            y,
            w,
            turn,
        } => {
            let (sl, e) = element(*s, *el)?;
            (
                "transform_elements",
                json!({ "slide": sl, "items": [{ "id": e, "x": x, "y": y, "w": w, "rotation": f64::from(*turn) * 30.0 }] }),
            )
        }
        Action::Delete { slide: s, el } => {
            let (sl, e) = element(*s, *el)?;
            ("delete_elements", json!({ "slide": sl, "ids": [e] }))
        }
        Action::Duplicate { slide: s, el } => {
            let (sl, e) = element(*s, *el)?;
            ("duplicate_elements", json!({ "slide": sl, "ids": [e] }))
        }
        Action::Group { slide: s, a, b } => {
            let (sl, ea) = element(*s, *a)?;
            let (_, eb) = element(*s, *b)?;
            ("group_elements", json!({ "slide": sl, "ids": [ea, eb] }))
        }
        Action::Ungroup { slide: s, el } => {
            let (sl, e) = element(*s, *el)?;
            ("ungroup_element", json!({ "slide": sl, "id": e }))
        }
        Action::Reorder { slide: s, el, to } => {
            let (sl, e) = element(*s, *el)?;
            let to = ["front", "back", "forward", "backward"][usize::from(*to)];
            (
                "reorder_elements",
                json!({ "slide": sl, "ids": [e], "to": to }),
            )
        }
        Action::Align {
            slide: s,
            a,
            b,
            mode,
        } => {
            let (sl, ea) = element(*s, *a)?;
            let (_, eb) = element(*s, *b)?;
            let mode = ["left", "centerH", "right", "top", "middleV", "bottom"][usize::from(*mode)];
            (
                "align_elements",
                json!({ "slide": sl, "ids": [ea, eb], "mode": mode }),
            )
        }
        Action::AlignOne { slide: s, el, mode } => {
            let (sl, e) = element(*s, *el)?;
            let mode = ["left", "centerH", "right", "top", "middleV", "bottom"][usize::from(*mode)];
            (
                "align_elements",
                json!({ "slide": sl, "ids": [e], "mode": mode }),
            )
        }
        Action::SetText { slide: s, el, n } => {
            let (sl, e) = element(*s, *el)?;
            let markdown = ["one", "**two** words", "- a\n- b", "", "x *y* z"][usize::from(*n)];
            (
                "set_text",
                json!({ "slide": sl, "id": e, "markdown": markdown }),
            )
        }
        Action::FormatParagraphs { slide: s, el, n } => {
            let (sl, e) = element(*s, *el)?;
            let (paragraphs, set, clear) = [
                (
                    None,
                    json!({ "list": "bullet", "listStyle": "square", "level": 1 }),
                    json!([]),
                ),
                (None, json!({ "list": "number", "start": 3 }), json!([])),
                (
                    Some(json!([0, 1])),
                    json!({ "listStyle": "upperRoman", "marginLeft": 40.0, "indent": -20.0 }),
                    json!(["start"]),
                ),
                (None, json!({}), json!(["list"])),
                (
                    Some(json!([0])),
                    json!({ "align": "center", "lineSpacing": 1.5, "spaceBefore": 6.0 }),
                    json!([]),
                ),
                (
                    None,
                    json!({ "bulletColor": "accent2", "bulletSize": 1.25 }),
                    json!(["level", "indent"]),
                ),
                (
                    None,
                    json!({ "list": "number", "listStyle": "lowerAlpha", "start": 1 }),
                    json!(["marginLeft"]),
                ),
                (
                    None,
                    json!({}),
                    json!(["align", "lineSpacing", "spaceBefore", "spaceAfter"]),
                ),
            ][usize::from(*n)]
            .clone();
            (
                "format_paragraphs",
                json!({ "slide": sl, "id": e, "paragraphs": paragraphs, "set": set, "clear": clear }),
            )
        }
        Action::Layout { slide: s, layout } => (
            "set_layout",
            json!({ "slide": slide(*s)?.id, "layout": deck.theme.layouts[layout % deck.theme.layouts.len()].name }),
        ),
        Action::DeleteSlide { slide: s } => ("delete_slides", json!({ "ids": [slide(*s)?.id] })),
        Action::DuplicateSlide { slide: s } => {
            ("duplicate_slides", json!({ "ids": [slide(*s)?.id] }))
        }
        Action::MoveSlide { slide: s, to } => {
            ("move_slides", json!({ "ids": [slide(*s)?.id], "to": to }))
        }
        Action::Flags {
            slide: s,
            hidden,
            backup,
        } => (
            "set_slide_flags",
            json!({ "ids": [slide(*s)?.id], "hidden": hidden, "backup": backup }),
        ),
        Action::Theme { i } => (
            "apply_theme",
            json!({ "name": crate::themes::all()[i % crate::themes::all().len()].name }),
        ),
        Action::Notes { slide: s, n } => {
            let notes = ["", "note", "a note about it"][usize::from(*n)];
            (
                "set_notes",
                json!({ "slide": slide(*s)?.id, "notes": notes }),
            )
        }
        Action::SetSteps { slide: s, n } => (
            "set_slide_steps",
            json!({ "slide": slide(*s)?.id, "steps": n }),
        ),
        Action::States {
            slide: s,
            el,
            step,
            state,
        } => {
            let (sl, e) = element(*s, *el)?;
            let state = ["hidden", "dimmed", "normal", "highlighted"]
                .get(usize::from(*state))
                .map_or(Value::Null, |name| json!(name));
            (
                "set_step_states",
                json!({ "slide": sl, "id": e, "states": { step.to_string(): state } }),
            )
        }
        Action::Build {
            slide: s,
            a,
            b,
            recipe,
        } => {
            let (sl, ea) = element(*s, *a)?;
            let (_, eb) = element(*s, *b)?;
            let recipe = ["reveal", "walkthrough", "spotlight", "clear"][usize::from(*recipe)];
            (
                "build_steps",
                json!({ "slide": sl, "ids": [ea, eb], "recipe": recipe }),
            )
        }
        Action::AddComposite { slide: s, kind } => (
            "add_elements",
            json!({ "slide": slide(*s)?.id, "elements": [crate::ops::tests::composites::sample(*kind)] }),
        ),
        Action::Expand { slide: s, el } => {
            let (sl, e) = element(*s, *el)?;
            ("expand_composite", json!({ "slide": sl, "id": e }))
        }
        Action::AddSection { slide: s, n } => (
            "add_section",
            json!({ "at": slide(*s)?.id, "title": format!("Section {n}") }),
        ),
        Action::RenameSection { slide: s, n } => (
            "rename_section",
            json!({ "at": slide(*s)?.id, "title": format!("Renamed {n}") }),
        ),
        Action::RemoveSection { slide: s } => ("remove_section", json!({ "at": slide(*s)?.id })),
        Action::Present { numbers } => ("set_present", json!({ "slideNumbers": numbers })),
        Action::DeckTransition { n } => {
            let kinds = ["none", "fade", "slide", "morph", "fade"];
            let mut transition = json!({ "kind": kinds[usize::from(*n) % kinds.len()] });
            if *n == 4 {
                transition["duration"] = json!(0.8);
            }
            ("set_present", json!({ "transition": transition }))
        }
        Action::PageSize { n } => {
            let sizes = [
                json!({ "preset": "16:9" }),
                json!({ "preset": "4:3" }),
                json!({ "preset": "1:1" }),
                json!({ "preset": "16:10" }),
                json!({ "w": 720, "h": 540 }),
                json!({ "w": 1280.5, "h": 720 }),
            ];
            (
                "set_page_size",
                sizes[usize::from(*n) % sizes.len()].clone(),
            )
        }
        Action::LayoutSave { slide: s, el, n } => {
            let (sl, e) = element(*s, *el)?;
            let kinds = ["title", "body", "text"];
            (
                "save_layout",
                json!({ "slide": sl, "label": format!("Mine {n}"), "roles": { e: kinds[usize::from(*n) % kinds.len()] }, "useForSlide": *n != 1, "newSlideDefault": *n == 2 }),
            )
        }
        Action::LayoutAdd { layout, n } => {
            let from = (*n % 2 == 0).then(|| layout_name(deck, *layout));
            (
                "add_layout",
                json!({ "label": format!("Extra {n}"), "from": from }),
            )
        }
        Action::LayoutDesign { layout, n } => {
            let name = layout_name(deck, *layout);
            let mut design = crate::design::design_deck(deck, &name).ok()?.slides[0].clone();
            match *n {
                0 => {}
                1 => design.elements.clear(),
                _ => {
                    if let Some(first) = design.elements.first_mut() {
                        first.base_mut().x = Some(40.0);
                        first.base_mut().y = Some(60.0);
                    }
                }
            }
            (
                "set_layout_design",
                json!({ "name": name, "design": design, "hideMaster": *n == 2 }),
            )
        }
        Action::LayoutEdit { layout, n } => (
            "edit_layout",
            json!({ "name": layout_name(deck, *layout), "label": format!("Renamed {n}"), "hideMaster": n % 2 == 0, "defaultForNew": n % 3 != 0 }),
        ),
        Action::LayoutDelete { layout } => {
            let name = layout_name(deck, *layout);
            let to = layout_name(deck, *layout + 1);
            ("delete_layout", json!({ "name": name, "moveTo": to }))
        }
        Action::LayoutMove { layout, to } => (
            "move_layout",
            json!({ "name": layout_name(deck, *layout), "to": to }),
        ),
        Action::LayoutImport { layout } => {
            let one = deck.theme.layouts.get(layout % deck.theme.layouts.len())?;
            (
                "import_layouts",
                json!({ "layouts": [one], "textStyles": deck.theme.text_styles }),
            )
        }
        Action::ResetSlide { slide: s } => ("reset_slides", json!({ "ids": [slide(*s)?.id] })),
        Action::Template { n, resize } => {
            let themes = crate::themes::all();
            let theme = &themes[usize::from(*n) % themes.len()];
            (
                "apply_template",
                json!({ "theme": theme, "size": { "w": 960, "h": 540 }, "resize": resize }),
            )
        }
        Action::PageContents { .. }
        | Action::PageUpdate { .. }
        | Action::PageSlides { .. }
        | Action::Storyboard { .. }
        | Action::Acknowledge { .. } => return super::pages::plan(deck, action),
        Action::TableAdd { .. }
        | Action::CellsSet { .. }
        | Action::CellsClear { .. }
        | Action::RowsInsert { .. }
        | Action::RowsDelete { .. }
        | Action::ColsInsert { .. }
        | Action::ColsDelete { .. }
        | Action::Merge { .. }
        | Action::Unmerge { .. }
        | Action::CellFill { .. } => return super::tables::plan(deck, action),
        Action::Highlight { slide: s, el, n } => {
            let (sl, e) = element(*s, *el)?;
            let paragraphs = [
                json!([{ "runs": [{ "t": "marked", "highlight": "accent2" }] }]),
                json!([{ "runs": [{ "t": "a " }, { "t": "pen", "highlight": "#ffee00" }, { "t": " b" }] }]),
                json!([{ "runs": [{ "t": "code", "code": true, "highlight": "text2" }] }]),
                json!([{ "runs": [{ "t": "plain" }] }]),
                json!([{ "runs": [{ "t": "not a colour", "highlight": "nope" }] }]),
                json!([{ "runs": [{ "t": "all ", "b": true, "i": true, "u": true, "s": true }, { "t": "marks", "b": true }] }]),
                json!([{ "runs": [{ "t": "big", "color": "accent1", "size": 30, "font": "heading" }, { "t": " link", "link": "https://example.org/a" }] }]),
                json!([
                    { "runs": [{ "t": "first" }], "list": "bullet", "level": 0 },
                    { "runs": [{ "t": "second", "b": true }], "list": "number", "level": 1, "start": 2, "align": "center" }
                ]),
            ][usize::from(*n) % 8]
                .clone();
            (
                "set_rich_text",
                json!({ "slide": sl, "id": e, "text": { "paragraphs": paragraphs } }),
            )
        }
        Action::PasteSized { slide: s, n } => {
            // A slide that was made for a deck of another size, as a paste from that deck brings it.
            let from = SIZES[usize::from(*n) % SIZES.len()];
            (
                "add_slides",
                json!({ "slides": [slide(*s)?], "fromSize": { "w": from.0, "h": from.1 } }),
            )
        }
        Action::LayoutImportSized { layout, n } => {
            let one = deck.theme.layouts.get(layout % deck.theme.layouts.len())?;
            let from = SIZES[usize::from(*n) % SIZES.len()];
            (
                "import_layouts",
                json!({ "layouts": [one], "textStyles": deck.theme.text_styles, "fromSize": { "w": from.0, "h": from.1 } }),
            )
        }
        Action::Replace => ("replace_all", json!({ "find": "hi", "replace": "yo" })),
        Action::Undo | Action::Redo => return None,
    })
}

/// The name of the layout the number picks.
fn layout_name(deck: &Deck, i: usize) -> String {
    deck.theme.layouts[i % deck.theme.layouts.len()]
        .name
        .clone()
}
