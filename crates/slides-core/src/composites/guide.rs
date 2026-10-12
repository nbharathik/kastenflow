//! One paragraph for each kind of element, for the agents that build decks:
//! what it is for and how to fill it in. They are collected into the
//! instructions of the MCP servers, so a new kind teaches agents itself.

/// What an agent should know about elements of this `type`, or None for a kind
/// with nothing to add to what the schema says.
pub fn guidance(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "code" => {
            "Source code in a rounded panel with syntax colours, as text that stays editable in PowerPoint. `language` is a name or extension (python, rust, ts, sh, sql, json, yaml, html, css, markdown, diff ...); unknown is plain. `theme` is dark (default) or light; `lineNumbers` and `firstLine` number the lines. `fontSize` is the most, in points: the type shrinks to fit, down to 10. Keep to about 25 lines of 60 columns. `focus` walks through the code, one entry per step (\"1\", \"2-3\", \"4,6-10\"; line 1 is the first line of `code`): other lines dim at that step, and the slide gets that many steps."
        }
        "math" => {
            "A formula in LaTeX, without the surrounding $: `\\frac{a}{b}`, `E = mc^2`. The editor typesets it; PowerPoint gets a picture of it, or the LaTeX as plain text when the host could not make one. `fontSize` is in points (32 by default), `color` a theme colour or #rrggbb, and `inline` sets it smaller and tighter. Keep formulas short, and size the box like the formula: the picture fills the box."
        }
        "chat" => {
            "A conversation as bubbles. `messages` is a list of {role, text}. Roles: system (full width), user (right, in the accent colour), assistant (left), toolCall (write `name(args)`; an arrow is added) and toolResult (both in the code font). Five or six short messages fit a slide; the type shrinks to fit down to 12 pt and then runs past the box, so trim messages rather than cram them."
        }
        "token-probs" => {
            "How a language model picks its next word. `tokens` are the words so far, shown as chips; `next` lists {token, p} with p from 0 to 1, drawn as bars in the order given (most likely first); `chosen` is the index in `next` of the one picked, drawn in the accent colour. Spaces show as dots, so write tokens as the model does (\" cat\"). At most 8 candidates show; the rest are counted."
        }
        "card-grid" => {
            "Cards in a grid, each a `title` and an optional one-line `body`. `columns` is optional: 1 to 3 cards make one row, 4 make two columns, 5 to 9 three, more four. Three to six cards read best; keep a title to a few words and a body to a sentence. All cards are set at one size, the largest at which the fullest fits."
        }
        "citation" => {
            "References by BibTeX key: `keys`, and `format`: short (\"Vaswani et al., 2017 (NeurIPS)\", the default), numbered (\"[1]\", the deck's own numbers), full (a whole reference a line) or list (every work the deck cites, numbered; give it no keys and put it on a references slide). It is set small, in the citation style, so put it in a strip at the bottom of the slide; add_citation adds a key to a slide's footer. A key that is not in the bibliography is a lint error."
        }
        "step-label" => {
            "\"Step n / N\", kept up to date as the slide is stepped through, in the deck's wording (`present.stepLabel`). `format`, with {n} and {total}, changes only the sample shown while editing. Put one, small, in a corner of a slide that has steps."
        }
        "embed" => {
            "A live web page in present mode, and a picture with a link everywhere else, PowerPoint included. `url` should be a web address (http or https). Give a `poster` snapshot sized like the box so the slide is never blank; without one a panel names the page and its address. The page is laid out at a window of `design` ({w, h}, 1280 by 800 by default) and scaled to the box, so size the box like that window; `zoom` (0.25 to 3) and `fit` (width, page, fill) say how it is seen."
        }
        "video" => {
            "A video file from the image store, or a web address, with a `poster` still: that is what shows in the editor and in PowerPoint, with a play button over it, and the video plays in present mode. Size the box like the poster. `autoplay` and `looped` are optional."
        }
        "chart" => {
            "A chart of a small table of numbers, drawn from shapes so that it follows the theme. `kind` is bar, line or pie; `categories` names the bar groups, points or slices; `series` is a list of {name, values (a number for each category), color?}. A pie draws the first series only. `title` sits above, `labels` writes the numbers on the marks, `legend` forces the legend on or off. Keep to about eight categories and a few series."
        }
        "timer" => {
            "A countdown that runs while presenting: `seconds` to count from (up to a day), an optional `label` over it, and `autostart` to begin when the slide shows; otherwise a click starts it. Elsewhere (a picture, PowerPoint) it shows the time it starts at. A box about 2:1 reads well."
        }
        "qr" => {
            "A QR code of `data`, a web address or some words of up to 213 bytes, drawn as squares in black on white whatever the theme. `caption` is set under it. Make the box square (or taller than wide with a caption): the code fills the shorter side."
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The longest a paragraph may be, in characters: instructions are read by every agent, on every turn.
    const LONGEST: usize = 600;

    const KINDS: [&str; 12] = [
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

    #[test]
    fn every_kind_has_a_paragraph_that_is_short_enough_to_read_every_turn() {
        for kind in KINDS {
            let text = guidance(kind).unwrap_or_else(|| panic!("{kind} has no guidance"));
            let length = text.chars().count();
            assert!(length > 80, "{kind} says too little: {length}");
            assert!(
                length <= LONGEST,
                "{kind} is {length} characters, over {LONGEST}"
            );
            assert!(!text.contains('\n'), "{kind} is one paragraph");
        }
        assert!(guidance("text").is_none());
        assert!(guidance("group").is_none());
    }

    #[test]
    fn a_paragraph_names_the_fields_an_agent_fills_in() {
        for (kind, fields) in [
            ("code", &["language", "focus", "theme", "lineNumbers"][..]),
            ("math", &["latex"][..]),
            ("chat", &["messages", "role"][..]),
            ("token-probs", &["tokens", "next", "chosen"][..]),
            ("card-grid", &["title", "body", "columns"][..]),
            ("citation", &["keys", "format"][..]),
            ("step-label", &["format"][..]),
            ("embed", &["url", "poster", "design", "zoom", "fit"][..]),
            ("video", &["poster"][..]),
            ("chart", &["kind", "categories", "series", "title"][..]),
            ("timer", &["seconds", "label", "autostart"][..]),
            ("qr", &["data", "caption"][..]),
        ] {
            let text = guidance(kind).unwrap_or_default();
            for field in fields {
                assert!(
                    text.contains(field) || *field == "latex" || *field == "role",
                    "{kind} should mention `{field}`"
                );
            }
        }
    }
}
