//! The words on a slide, as the rules read them: which text an element
//! carries, the look each run ends up with, how to name an element in a
//! message, and how many words there are.

use crate::model::{Element, Paragraph, Run, Text, TextStyle, Theme};
use crate::resolve::placeholder_of;

use super::color::Rgb;
use super::scene::{Kind, Leaf, Scene, Unit};

/// The size a run has when neither it, its paragraph nor its box says: the
/// renderer's own last resort.
const FALLBACK_POINTS: f64 = 18.0;

/// A piece of text an element carries, and what it starts from.
pub struct Part<'a> {
    pub text: &'a Text,
    /// The theme text style the box is set in.
    pub base: String,
    /// The fill of the table cell it is in, when it is in one.
    pub cell_fill: Option<&'a crate::model::Fill>,
}

/// The texts of a leaf: a text box's words, a shape's, a connector's label, a
/// table's cells.
pub fn parts<'a>(scene: &Scene<'a>, leaf: &Leaf<'a>) -> Vec<Part<'a>> {
    let slot = || {
        placeholder_of(&scene.deck.theme, scene.slide, leaf.el)
            .and_then(|def| def.style.clone())
            .unwrap_or_else(|| "body".to_owned())
    };
    match leaf.el {
        Element::Text(t) => vec![Part {
            text: &t.text,
            base: slot(),
            cell_fill: None,
        }],
        Element::Shape(s) => s
            .text
            .iter()
            .map(|text| Part {
                text,
                base: slot(),
                cell_fill: None,
            })
            .collect(),
        Element::Connector(c) => c
            .label
            .iter()
            .map(|text| Part {
                text,
                base: "caption".to_owned(),
                cell_fill: None,
            })
            .collect(),
        Element::Table(t) => t
            .rows
            .iter()
            .flat_map(|row| {
                row.cells.iter().map(|cell| Part {
                    text: &cell.text,
                    base: "body".to_owned(),
                    cell_fill: cell.fill.as_ref(),
                })
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// The text style a paragraph is set in.
pub fn style_of<'a>(theme: &'a Theme, base: &str, paragraph: &Paragraph) -> Option<&'a TextStyle> {
    paragraph
        .style
        .as_deref()
        .and_then(|name| theme.text_style(name))
        .or_else(|| theme.text_style(base))
        .or_else(|| theme.text_style("body"))
}

/// The size a run is drawn at, in points: its own, else its paragraph's
/// style, else the box's.
pub fn size_of(theme: &Theme, base: &str, paragraph: &Paragraph, run: &Run) -> f64 {
    run.size
        .filter(|s| s.is_finite() && *s > 0.0)
        .or_else(|| style_of(theme, base, paragraph).map(|s| s.size))
        .unwrap_or(FALLBACK_POINTS)
}

/// The colour a run is drawn in, when it can be worked out.
pub fn color_of(theme: &Theme, base: &str, paragraph: &Paragraph, run: &Run) -> Option<Rgb> {
    let name = run
        .color
        .as_deref()
        .and_then(|c| theme.resolve_color(c).map(|_| c))
        .or_else(|| style_of(theme, base, paragraph).map(|s| s.color.as_str()))
        .unwrap_or("text1");
    // A link is drawn in the theme's link colour.
    let name = if run.link.is_some() { "accent1" } else { name };
    theme.resolve_color(name).and_then(|hex| Rgb::parse(&hex))
}

/// Whether a run is set in the code font: inline code, the font named `code`, or a paragraph in a code style.
pub fn is_mono(style: Option<&TextStyle>, run: &Run) -> bool {
    run.code || run.font.as_deref() == Some("code") || style.is_some_and(|s| s.font == "code")
}

/// The zero-width space, which lets a line break where it stands.
const BREAK: char = '\u{200b}';

/// Whether a word may be broken anywhere without harm: any word in the code font, and web and email
/// addresses and paths. A renderer breaks a word that is wider than its box wherever it must, and
/// for these that is what a person expects; a word of prose broken in the middle is a fault.
pub fn breaks_anywhere(word: &str, mono: bool) -> bool {
    !word.is_empty()
        && (mono
            || word.contains("://")
            || word.starts_with("www.")
            || (word.contains('@') && word.contains('.'))
            || word.matches('/').count() >= 2)
}

/// `word` with a break opportunity between each two of its characters.
fn breakable(word: &str) -> String {
    let mut out = String::with_capacity(word.len() * 4);
    for (i, c) in word.chars().enumerate() {
        if i > 0 {
            out.push(BREAK);
        }
        out.push(c);
    }
    out
}

/// A copy of `text` in which the words that may be broken anywhere can be, so that laying it out to
/// find its widest word finds only the words that cannot be broken. `None` when no word is such.
pub fn with_breaks(theme: &Theme, base: &str, text: &Text) -> Option<Text> {
    let mut copy = text.clone();
    let mut changed = false;
    for paragraph in &mut copy.paragraphs {
        let style = style_of(theme, base, paragraph).cloned();
        for run in &mut paragraph.runs {
            let mono = is_mono(style.as_ref(), run);
            let lines: Vec<String> = run
                .t
                .split('\n')
                .map(|line| {
                    line.split(' ')
                        .map(|word| {
                            if breaks_anywhere(word, mono) && word.chars().count() > 1 {
                                changed = true;
                                breakable(word)
                            } else {
                                word.to_owned()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect();
            run.t = lines.join("\n");
        }
    }
    changed.then_some(copy)
}

/// The name of the style a paragraph is set in: its own, else the box's.
pub fn style_name<'a>(paragraph: &'a Paragraph, base: &'a str) -> &'a str {
    paragraph.style.as_deref().unwrap_or(base)
}

/// The runs that show something.
pub fn shown_runs(paragraph: &Paragraph) -> impl Iterator<Item = &Run> {
    paragraph
        .runs
        .iter()
        .filter(|r| !r.t.trim().is_empty() || r.field.is_some())
}

/// The words in a text.
pub fn words_in(text: &Text) -> usize {
    text.paragraphs.iter().map(|p| words(&p.text())).sum()
}

/// The words in a piece of text: stretches with a letter or digit in them.
pub fn words(text: &str) -> usize {
    text.split_whitespace()
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .count()
}

/// What to call a kind of element in a sentence.
pub fn noun(kind: &str) -> &'static str {
    match kind {
        "text" => "text box",
        "shape" => "shape",
        "line" => "line",
        "connector" => "connector",
        "image" => "image",
        "group" => "group",
        "table" => "table",
        "raw" => "imported object",
        "code" => "code block",
        "math" => "formula",
        "chat" => "conversation",
        "token-probs" => "token chart",
        "card-grid" => "card grid",
        "citation" => "citation",
        "step-label" => "step label",
        "embed" => "embedded page",
        "video" => "video",
        "audio" => "audio",
        _ => "element",
    }
}

/// A short quotation of the words an element carries.
fn quote(el: &Element) -> Option<String> {
    let text = match el {
        Element::Text(t) => Some(&t.text),
        Element::Shape(s) => s.text.as_ref(),
        _ => None,
    }?;
    let plain = text.plain_text();
    let one_line: String = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.is_empty() {
        return None;
    }
    let mut short: String = one_line.chars().take(32).collect();
    if one_line.chars().count() > 32 {
        short.push('…');
    }
    Some(short)
}

/// The layer name of an element, quoted, when it has one.
fn named(name: Option<&str>) -> Option<String> {
    name.map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| format!("\"{n}\""))
}

/// How a message names an element: its layer name, else a quotation of its
/// words, else what kind of thing it is.
pub fn describe(el: &Element) -> String {
    if let Some(name) = named(el.base().name.as_deref()) {
        return name;
    }
    match quote(el) {
        Some(words) => format!("the {} \"{words}\"", noun(el.kind())),
        None => format!("the {}", noun(el.kind())),
    }
}

/// How a message names a leaf: its composite when it is a part of one.
pub fn describe_leaf(leaf: &Leaf) -> String {
    match leaf.owner {
        Some(owner) => named(owner.name).unwrap_or_else(|| format!("the {}", noun(owner.kind))),
        None => describe(leaf.el),
    }
}

/// How a message names an element of the slide as it stands in the list.
pub fn describe_unit(unit: &Unit) -> String {
    match unit.kind {
        Kind::Composite(kind) => {
            named(unit.el.base().name.as_deref()).unwrap_or_else(|| format!("the {}", noun(kind)))
        }
        _ => describe(unit.el),
    }
}

/// The capitalised sentence start of a description: `the text box` → `The text box`.
pub fn sentence(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Base, Text};

    #[test]
    fn words_are_stretches_with_a_letter_or_digit() {
        assert_eq!(words("one two  three"), 3);
        assert_eq!(words("- 12 % and — done"), 3);
        assert_eq!(words(""), 0);
    }

    #[test]
    fn an_element_is_named_by_its_layer_name_its_words_or_its_kind() {
        let text = Element::text_el(
            Base::new("a"),
            Text::plain("Why tools are worth it in the end, really"),
        );
        assert_eq!(
            describe(&text),
            "the text box \"Why tools are worth it in the en…\""
        );
        let mut named = Base::new("b");
        named.name = Some("LLM box".to_owned());
        assert_eq!(
            describe(&Element::shape(named, "rect", None)),
            "\"LLM box\""
        );
        assert_eq!(
            describe(&Element::shape(Base::new("c"), "rect", None)),
            "the shape"
        );
        assert_eq!(sentence("the shape"), "The shape");
    }

    #[test]
    fn a_run_takes_its_size_from_itself_its_paragraph_then_its_box() {
        let theme = crate::themes::light();
        let mut paragraph = Paragraph::plain("x");
        let mut run = Run::plain("x");
        assert_eq!(size_of(&theme, "body", &paragraph, &run), 22.0);
        paragraph.style = Some("caption".to_owned());
        assert_eq!(size_of(&theme, "body", &paragraph, &run), 14.0);
        run.size = Some(9.0);
        assert_eq!(size_of(&theme, "body", &paragraph, &run), 9.0);
        assert_eq!(
            size_of(&theme, "nope", &Paragraph::plain("x"), &Run::plain("x")),
            22.0
        );
    }
}
