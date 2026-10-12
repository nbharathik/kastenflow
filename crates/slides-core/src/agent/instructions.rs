//! What a server tells an agent when it connects: the conventions of a deck,
//! what each kind of element is for, how to make slides that read well, what
//! lint looks for, and the order to work in.

use crate::composites::guidance;
use crate::lint::rules;
use crate::themes;

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

/// The size of a text style of the default theme, in points.
fn points(theme: &crate::model::Theme, style: &str) -> String {
    theme
        .text_styles
        .get(style)
        .map_or_else(|| "?".to_owned(), |s| format!("{}", s.size))
}

pub fn instructions() -> String {
    let theme = themes::light();
    let layouts: Vec<&str> = theme.layouts.iter().map(|l| l.name.as_str()).collect();
    let mut out = String::new();
    out.push_str(
        "KastenFlow Slides: you build and edit slide decks, which are .deck files. Every tool changes a deck with the same operations the editor uses, a change is saved at once (a person with the deck open sees it), and nothing is ever deleted: removed slides are kept as a copy in the trash, and decks go to the trash too.\n\n",
    );
    out.push_str("THE DECK\n");
    out.push_str("- A slide is 960 by 540 units (1 unit is 1/96 inch). Slides have ids (s-...) and elements ids (e-...); tools return them and take them. A slide may also be named by its number, counting from 1.\n");
    out.push_str(&format!(
        "- The theme gives colours (text1, text2, bg1, bg2, accent1 to accent6: use these names, or #rrggbb) and text styles: title {} pt, subtitle {}, body {}, caption {}, code {}, citation {}. The layouts are {} (list_layouts shows their slots); add_slide fills a layout's slots by role with Markdown.\n",
        points(&theme, "title"), points(&theme, "subtitle"), points(&theme, "body"), points(&theme, "caption"), points(&theme, "code"), points(&theme, "citation"), layouts.join(", ")
    ));
    out.push_str("- Words are Markdown: **bold**, *italic*, `code`, [link](url), $latex$, - bullets, 1. numbers, one paragraph per line. add_slide and set_text take it, and text elements take `markdown`.\n");
    out.push_str("- Elements: text, shape, line, connector (attached to two elements by id and side, so it follows them), image, group, table, and the composites below. Position with x, y, w, h in slide units, or fill a layout slot with `placeholder`.\n");
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
    out.push_str("- Show a process or a system as a diagram (add_diagram lays out boxes and attached arrows for you) and not as bullets with arrows in them. Give every picture alt text, and every figure a citation.\n");
    out.push_str("- Build up an idea with steps (set_steps); show a change with Morph (duplicate_slide, change the copy, set_morph).\n\n");
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
    out.push_str("lint_deck measures how big the text is with a browser when this machine has Chrome or Chromium, and otherwise estimates it, and says which. An estimate is a good guess: make the box bigger or the text shorter when text-overflow says so.\n\n");
    out.push_str("HOW TO WORK\n");
    out.push_str("1. Write the outline first and make the deck with create_deck: `# Title`, then a `## Slide title` for each slide with a few lines under it. It picks a layout for what each slide holds.\n");
    out.push_str("2. get_deck shows the slides and their ids. Refine slide by slide with add_diagram, place_image, set_text, set_steps ...; update_elements does several things in one call, and later operations in it can use what earlier ones returned (\"$1.slide\").\n");
    out.push_str("3. Run lint_deck after every batch of changes, and fix what it reports by its hints. Finish only when there are no errors, and no warnings you cannot defend.\n");
    out.push_str("   Then look: render_slide draws a slide as a picture and render_grid all of them, so you can see what lint cannot (a slide that is dull, crowded or unbalanced). Look at every slide you built before you say you are done.\n");
    out.push_str("4. When asked for a file, export (pptx or markdown).\n\n");
    out.push_str("LIMITS\n");
    out.push_str("- render_slide and render_grid need Chrome or Chromium on this machine. When they say none was found you cannot see the slides: lint is your eyes, so trust it, and tell the person what you could not check.\n");
    out.push_str("- Every answer carries the deck's `hash`. If a person changed the deck after you last read it, your change is not written over theirs: it is saved as a copy beside the deck and you are told. Read the deck again, then repeat the change if it still applies.\n");
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
            "960 by 540",
            "60 words",
            "create_deck",
            "lint_deck",
            "render_slide",
            "hash",
            "one accent",
            "title 36 pt",
            "Markdown",
        ] {
            assert!(
                text.to_lowercase().contains(&phrase.to_lowercase()),
                "{phrase}"
            );
        }
    }
}
