//! What a server tells an agent when it connects: the conventions of a deck,
//! what each kind of element is for, how to make slides that read well, what
//! lint looks for, and the order to work in. The sizes, themes and operations it
//! names are read from the engine, so the text cannot fall behind it.

use super::edit::PERSONS;
use crate::composites::guidance;
use crate::lint::rules;
use crate::resize::PAGE_SIZES;
use crate::{ops, themes};

/// The composite kinds, in the order the guidance is given.
const COMPOSITES: [&str; 12] = [
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

/// What the host knows that decides what the instructions can promise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Facts {
    /// Whether the host can draw slides as pictures (`render_slide` and `render_grid`). Without it the
    /// instructions do not send the agent to look at slides it cannot see.
    pub render: bool,
    /// Whether `render_diff` (a slide before and after a change) can be offered. Only a host that draws in a window can.
    pub diff: bool,
}

impl Default for Facts {
    /// A host that can render, which is what the instructions have always assumed.
    fn default() -> Facts {
        Facts {
            render: true,
            diff: false,
        }
    }
}

/// The size of a text style of the default theme, in points.
fn points(theme: &crate::model::Theme, style: &str) -> String {
    theme
        .text_styles
        .get(style)
        .map_or_else(|| "?".to_owned(), |s| format!("{}", s.size))
}

/// The page sizes on offer: `16:9 960x540, 16:10 960x600 ...`.
fn page_sizes() -> String {
    PAGE_SIZES
        .iter()
        .map(|(name, w, h)| format!("{name} {w}x{h}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The operations `update_elements` takes: all of them but the ones that are a person's to do.
fn batchable() -> String {
    ops::names()
        .into_iter()
        .filter(|name| !PERSONS.contains(name))
        .collect::<Vec<_>>()
        .join(", ")
}

/// What `slides_help` answers: the order of work and the tool for each step, in few words. It is read when a deck
/// is to be built, so it can say more than the instructions every connection gets.
pub(super) fn workflow() -> String {
    "HOW TO BUILD A DECK THAT READS WELL
1. Outline: the deck as a list of slides, one idea each, with a title that says the point (at most 60 words a slide; the rest goes in speaker notes).
2. Build: create_deck from a Markdown outline, or build_deck from one spec (a layout and slots for each slide, never raw positions). A chart is a `chart` element that set_chart_data fills from CSV text or rows. A draw.io diagram goes on a slide with place_diagram; boxes and arrows with add_diagram. Pictures: add_asset, then place_image (replace_asset swaps one everywhere). Notes: set_notes, or set_notes_bulk for many slides.
3. Render: render_grid shows the whole deck, render_slide one slide (give it `elements` to preview before you write; render_diff shows before and after). Look at every slide you made. Where drawing is not available, lint_deck is your eyes.
4. Lint: lint_deck after every batch of changes; errors come first, each with its fix.
5. Fix: change what lint or your eyes found, then render and lint again. Finish with no errors and no warning you cannot defend.
6. Hand over: say which slides you changed and what you could not check. export writes pptx, markdown or png.
Everything you do is one undo for the person, and nothing is ever deleted.
"
    .to_owned()
}

/// The instructions for a host that can render slides.
pub fn instructions() -> String {
    instructions_for(&Facts::default())
}

/// The instructions for a host with these facts.
pub fn instructions_for(facts: &Facts) -> String {
    let theme = themes::light();
    let layouts: Vec<&str> = theme.layouts.iter().map(|l| l.name.as_str()).collect();
    let theme_names: Vec<String> = themes::all().into_iter().map(|t| t.name).collect();
    let mut out = String::new();
    out.push_str(
        "KastenFlow Slides: you build and edit slide decks, which are .deck files. Every tool changes a deck with the same operations the editor uses, a change is saved at once (a person with the deck open sees it), and nothing is ever deleted: removed slides and decks go to the trash.\n\n",
    );
    out.push_str("THE DECK\n");
    out.push_str(&format!(
        "- Positions and sizes are in units of 1/96 inch. A deck's slides have the size get_deck reports (`size`: w and h), and every x, y, w and h depends on it, so read it before placing anything. The page sizes on offer are {} (set_page_size changes a deck's, and refits what is in it). Slides have ids (s-...) and elements ids (e-...); tools return them and take them. A slide may also be named by its number, counting from 1.\n",
        page_sizes()
    ));
    out.push_str(&format!(
        "- The theme gives colours (text1, text2, bg1, bg2, accent1 to accent6: use these names, or #rrggbb) and text styles: title {} pt, subtitle {}, body {}, caption {}, code {}, citation {}. The layouts are {} (list_layouts shows their slots); add_slide fills a layout's slots by role with Markdown. The built-in themes are {} (apply_theme).\n",
        points(&theme, "title"), points(&theme, "subtitle"), points(&theme, "body"), points(&theme, "caption"), points(&theme, "code"), points(&theme, "citation"), layouts.join(", "), theme_names.join(", ")
    ));
    out.push_str("- Words are Markdown: **bold**, *italic*, `code`, [link](url), $latex$, - bullets, 1. numbers, one paragraph per line. add_slide and set_text take it, and text elements take `markdown`.\n");
    out.push_str("- Elements: text, shape, line, connector (attached to two elements by id and side, so it follows them), image, group, table, and the composites below. Position with x, y, w, h in slide units, or fill a layout slot with `placeholder`.\n");
    out.push_str("- A table is made with add_elements and changed cell by cell: set_cells puts words in a block of cells (adding the rows and columns it needs), and the other table tools (set_cell_fill, insert_rows, merge_cells ...) do the rest. Rows and columns count from 0.\n");
    out.push_str("- A slide with steps shows in stages: an element has a state (hidden, dimmed, normal, highlighted) from each step. Elements that share an id on consecutive slides glide into place with the Morph transition.\n\n");
    out.push_str("COMPOSITE ELEMENTS (add them with add_elements; each is drawn as ordinary shapes, so they export to PowerPoint)\n");
    for kind in COMPOSITES {
        if let Some(text) = guidance(kind) {
            out.push_str(&format!("- {kind}: {text}\n"));
        }
    }
    out.push_str("\nSLIDES THAT READ WELL\n");
    out.push_str("- One idea to a slide, in a layout that fits it. At most 60 words: cut, split the slide, or move detail into the speaker notes (set_notes).\n");
    out.push_str("- Type of 14 pt or more, and 24 units of margin. Never shrink text to make it fit; say less.\n");
    out.push_str("- One accent colour to a slide: accent1 for what matters, text1, text2 and bg2 for the rest.\n");
    out.push_str("- Show a process or a system as a diagram (add_diagram lays out boxes and arrows) and not as bullets with arrows in them. Give every picture alt text, and every figure a citation.\n");
    out.push_str("- Build up an idea with steps (set_steps); show a change with Morph (duplicate_slide, change the copy, set_morph).\n");
    out.push_str("- Point something out without changing it with add_deck_comment; read theirs with list_deck_comments and settle one with resolve_deck_comment. Decoration takes empty alt text (\"\").\n\n");
    out.push_str(
        "LINT (lint_deck; every write tool also reports the problems on the slides it touched)\n",
    );
    for rule in rules() {
        out.push_str(&format!(
            "- {} ({}): {}\n",
            rule.name,
            rule.severity.as_str(),
            rule.summary
        ));
    }
    out.push_str("lint_deck measures text in a browser or the open app when it can, else estimates, and says which. For text-overflow, enlarge the box or shorten the text.\n\n");
    out.push_str("HOW TO WORK\n");
    out.push_str("1. Write the outline first and make the deck with create_deck: `# Title`, then a `## Slide title` for each slide with a few lines under it. It picks a layout for what each slide holds. Or give build_deck one checked spec: a layout, slots, elements, notes and steps for each slide.\n");
    out.push_str(&format!(
        "2. get_deck shows the slides and their ids. Refine slide by slide with add_diagram, place_image, set_text, set_steps ...; update_elements does several things in one call, and later operations in it can use what earlier ones returned (\"$1.slide\"). The operations it takes: {}.\n",
        batchable()
    ));
    out.push_str("   Also: set_chart_data (CSV or rows into a chart), place_diagram (draw.io), replace_asset (swap a picture everywhere), set_notes_bulk.\n");
    out.push_str("3. Run lint_deck after every batch of changes, and fix what it reports by its hints. Finish with no errors and no warnings you cannot defend.\n");
    if facts.render {
        out.push_str("   Then look: render_slide draws a slide as a picture and render_grid all of them, to see what lint cannot (dull, crowded, unbalanced). Look at every slide you built before you say you are done.\n");
        if facts.diff {
            out.push_str("   render_slide takes `elements` to preview a change before you write it; render_diff shows a slide before and after, changes outlined.\n");
        }
    }
    out.push_str("4. When asked for a file, export (pptx, markdown or png).\n\n");
    out.push_str("LIMITS\n");
    if facts.render {
        out.push_str("- render_slide and render_grid need a browser or the open KastenFlow app; without one, lint is your eyes: trust it, and say what you could not check.\n");
    } else {
        out.push_str("- This host cannot draw slides as pictures, so you cannot see them: lint is your eyes, so trust it, and tell the person what you could not check.\n");
    }
    out.push_str("- Every answer carries the deck's `hash`. If a person changed the deck after you read it, your change is saved as a copy beside the deck, not over theirs, and you are told. Read it again and repeat the change if it still applies.\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_instructions_teach_the_deck_the_elements_the_rules_and_the_order_of_work() {
        let text = instructions();
        assert!(
            text.len() < 12_000,
            "{} bytes are read on every connection",
            text.len()
        );
        for kind in COMPOSITES {
            assert!(text.contains(&format!("- {kind}: ")), "{kind}");
        }
        for rule in rules() {
            assert!(text.contains(rule.name), "{}", rule.name);
        }
        for phrase in [
            "60 words",
            "create_deck",
            "lint_deck",
            "render_slide",
            "hash",
            "one accent",
            "title 36 pt",
            "Markdown",
            "get_deck",
        ] {
            assert!(
                text.to_lowercase().contains(&phrase.to_lowercase()),
                "{phrase}"
            );
        }
    }

    #[test]
    fn the_sizes_themes_and_operations_it_names_are_the_engines_own_and_no_size_is_fixed_in_the_words()
     {
        let text = instructions();
        assert!(!text.contains("960 by 540"), "the size is not fixed");
        for (name, w, h) in PAGE_SIZES {
            assert!(text.contains(&format!("{name} {w}x{h}")), "{name}");
        }
        for theme in themes::all() {
            assert!(text.contains(&theme.name), "{}", theme.name);
        }
        for op in ops::names() {
            if !PERSONS.contains(&op) {
                assert!(text.contains(op), "{op}");
            }
        }
        for op in [
            "set_cells",
            "insert_rows",
            "merge_cells",
            "unmerge_cells",
            "set_cell_fill",
        ] {
            assert!(text.contains(op), "{op}");
        }
    }

    #[test]
    fn a_host_that_cannot_render_is_not_told_to_look() {
        let blind = instructions_for(&Facts {
            render: false,
            diff: true,
        });
        assert!(!blind.contains("render_slide"), "{blind}");
        assert!(!blind.contains("render_diff"), "{blind}");
        assert!(blind.contains("cannot draw slides"), "{blind}");
        assert!(blind.contains("lint_deck"));
        let sighted = instructions_for(&Facts {
            render: true,
            diff: false,
        });
        assert_eq!(sighted, instructions());
        assert!(sighted.contains("render_slide") && sighted.contains("render_grid"));
    }

    #[test]
    fn render_diff_is_told_only_to_a_host_that_offers_it_and_the_words_stay_within_budget() {
        let plain = instructions();
        assert!(!plain.contains("render_diff"), "{plain}");
        let windowed = instructions_for(&Facts {
            render: true,
            diff: true,
        });
        assert!(windowed.contains("render_diff") && windowed.contains("`elements`"));
        assert!(
            windowed.len() < 12_000,
            "{} bytes are read on every connection",
            windowed.len()
        );
        assert!(plain.len() < windowed.len());
    }

    #[test]
    fn the_new_tools_are_told_and_the_words_stay_within_budget_with_them() {
        let text = instructions();
        for tool in [
            "build_deck",
            "set_chart_data",
            "place_diagram",
            "replace_asset",
            "set_notes_bulk",
        ] {
            assert!(text.contains(tool), "{tool}");
        }
        assert!(text.contains("export (pptx, markdown or png)"));
        assert!(text.len() < 12_000, "{} bytes", text.len());
    }

    #[test]
    fn the_workflow_goes_outline_build_render_lint_fix_and_names_tools_that_exist() {
        let text = workflow();
        let at: Vec<usize> = ["Outline", "Build", "Render", "Lint", "Fix", "Hand over"]
            .iter()
            .map(|step| text.find(step).unwrap_or_else(|| panic!("{step}")))
            .collect();
        assert!(at.windows(2).all(|w| w[0] < w[1]), "{at:?}");
        let tools: Vec<String> = super::super::tools().into_iter().map(|t| t.name).collect();
        for name in [
            "create_deck",
            "build_deck",
            "set_chart_data",
            "place_diagram",
            "add_diagram",
            "add_asset",
            "place_image",
            "replace_asset",
            "set_notes",
            "set_notes_bulk",
            "render_grid",
            "render_slide",
            "render_diff",
            "lint_deck",
            "export",
        ] {
            assert!(text.contains(name), "{name} is in the words");
            assert!(tools.iter().any(|t| t == name), "{name} is a tool");
        }
        assert!(text.len() < 2_500, "{} bytes", text.len());
    }
}
