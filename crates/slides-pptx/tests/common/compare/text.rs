//! Comparing the words of two elements as they are drawn: character by
//! character, each with its effective look, so a run split in two or a value
//! written out that the style already gave is not a difference.

use slides_core::resolve::placeholder_of;
use slides_core::{Align, Deck, Element, ListKind, ListStyle, Script, Slide, Text, VAlign, list};

use super::Diff;

#[derive(Debug, PartialEq)]
struct Look {
    size: f64,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    color: String,
    /// The colour behind the words, when the run has one of its own.
    highlight: Option<String>,
    font: String,
    link: Option<String>,
    code: bool,
    script: Option<Script>,
    small_caps: bool,
    all_caps: bool,
    spacing: f64,
}

/// What a paragraph is set as.
#[derive(Debug, PartialEq)]
struct Setting {
    align: Align,
    list: Option<ListKind>,
    level: u8,
    line: f64,
    before: f64,
    after: f64,
    /// The marker an item shows, as the list says it: its look, and the number it counts as.
    marker: Option<(ListStyle, Option<u32>)>,
    bullet_color: Option<String>,
    bullet_size: f64,
    /// Where its lines start, and where the first starts from there.
    margin: f64,
    indent: f64,
    /// What an empty paragraph is measured by, its mark's size (and so is its marker).
    mark_size: Option<f64>,
}

fn round(v: f64) -> f64 {
    (v * 20.0).round() / 20.0
}

fn hex(deck: &Deck, value: &str) -> String {
    deck.theme
        .resolve_color(value)
        .unwrap_or_else(|| value.to_owned())
        .to_ascii_lowercase()
}

fn family(deck: &Deck, font: &str) -> String {
    let fonts = &deck.theme.fonts;
    match font {
        "heading" => fonts.heading.family.clone(),
        "code" => fonts.code.family.clone(),
        "body" | "" => fonts.body.family.clone(),
        other => other.to_owned(),
    }
    .to_ascii_lowercase()
}

/// The text style a box starts its paragraphs from.
pub fn box_style(deck: &Deck, slide: &Slide, element: &Element, in_label: bool) -> String {
    if in_label {
        return "caption".to_owned();
    }
    match (element, placeholder_of(&deck.theme, slide, element)) {
        (Element::Text(_), Some(slot)) => slot.style.clone().unwrap_or_else(|| "body".to_owned()),
        _ => "body".to_owned(),
    }
}

fn style_named<'a>(deck: &'a Deck, name: &str) -> &'a slides_core::TextStyle {
    deck.theme
        .text_style(name)
        .or_else(|| deck.theme.text_style("body"))
        .unwrap_or_else(|| panic!("the theme has no `body` style"))
}

/// The slide numbers a link stands for, so two decks with different ids compare. A link to a
/// slide that is not in the deck is not written to a file, so it is no link.
fn link_of(link: &Option<String>, index_of: &dyn Fn(&str) -> Option<usize>) -> Option<String> {
    let link = link.as_ref()?;
    match link.strip_prefix("slide:") {
        Some(id) => index_of(id).map(|i| format!("slide#{i}")),
        None => Some(link.clone()),
    }
}

fn looks_and_settings(
    deck: &Deck,
    text: &Text,
    base: &str,
    index_of: &dyn Fn(&str) -> Option<usize>,
) -> Vec<(Setting, Vec<(char, Look)>)> {
    let counts = list::numbers(&text.paragraphs);
    let points: Vec<f64> = text
        .paragraphs
        .iter()
        .map(|p| {
            let style = style_named(
                deck,
                p.style
                    .as_deref()
                    .filter(|s| deck.theme.text_style(s).is_some())
                    .unwrap_or(base),
            );
            let first = p.runs.iter().find(|r| !r.t.is_empty()).or(p.runs.first());
            first.and_then(|r| r.size).unwrap_or(style.size) * p.bullet_size.unwrap_or(1.0)
        })
        .collect();
    let places = list::layout(&text.paragraphs, &points);
    text.paragraphs
        .iter()
        .enumerate()
        .map(|(n, p)| {
            let style = style_named(
                deck,
                p.style
                    .as_deref()
                    .filter(|s| deck.theme.text_style(s).is_some())
                    .unwrap_or(base),
            );
            let setting = Setting {
                align: p
                    .align
                    .clone()
                    .or(style.align.clone())
                    .unwrap_or(Align::Left),
                list: p.list.clone(),
                level: p.level.unwrap_or(0),
                line: round(p.line_spacing.or(style.line_spacing).unwrap_or(1.0)),
                before: round(p.space_before.or(style.space_before).unwrap_or(0.0)),
                after: round(p.space_after.or(style.space_after).unwrap_or(0.0)),
                marker: list::style_of(p).map(|s| (s, counts[n])),
                bullet_color: p.bullet_color.as_deref().map(|c| hex(deck, c)).filter(|c| {
                    // A marker in the colour of the words has no colour of its own.
                    let first = p.runs.iter().find(|r| !r.t.is_empty()).or(p.runs.first());
                    *c != hex(
                        deck,
                        first
                            .and_then(|r| r.color.as_deref())
                            .unwrap_or(&style.color),
                    )
                }),
                bullet_size: round(p.bullet_size.unwrap_or(1.0)),
                margin: round(places[n].margin),
                indent: round(places[n].indent),
                mark_size: p
                    .runs
                    .iter()
                    .all(|r| r.t.is_empty() && r.field.is_none())
                    .then(|| round(p.runs.first().and_then(|r| r.size).unwrap_or(style.size))),
            };
            let mut chars = Vec::new();
            for r in &p.runs {
                let font = if r.code {
                    "code".to_owned()
                } else {
                    family(deck, r.font.as_deref().unwrap_or(&style.font))
                };
                let link = link_of(&r.link, index_of);
                let look = |c: char| {
                    (
                        c,
                        Look {
                            size: round(r.size.unwrap_or(style.size)),
                            bold: style.bold || r.bold,
                            italic: style.italic || r.italic || r.math,
                            underline: r.underline || link.is_some(),
                            strike: r.strike,
                            color: if link.is_some() {
                                "link".to_owned()
                            } else {
                                hex(deck, r.color.as_deref().unwrap_or(&style.color))
                            },
                            highlight: r.highlight.as_deref().map(|h| hex(deck, h)),
                            font: font.clone(),
                            link: link.clone(),
                            code: r.code,
                            script: r.script.clone(),
                            small_caps: r.small_caps,
                            all_caps: r.all_caps,
                            spacing: round(r.spacing.unwrap_or(0.0)),
                        },
                    )
                };
                let shown = if r.field.is_some() {
                    "#".to_owned()
                } else {
                    r.t.clone()
                };
                chars.extend(shown.chars().map(look));
            }
            (setting, chars)
        })
        .collect()
}

/// One text to compare, with what it needs to be read as drawn.
pub struct Side<'a> {
    pub deck: &'a Deck,
    pub text: &'a Text,
    /// The style its box starts its paragraphs from.
    pub base: &'a str,
    /// Where it sits in its box when the text does not say.
    pub valign: VAlign,
    pub index_of: &'a dyn Fn(&str) -> Option<usize>,
}

const DEFAULT_INSETS: (f64, f64, f64, f64) = (9.6, 4.8, 9.6, 4.8);

fn insets(text: &Text) -> (f64, f64, f64, f64) {
    text.insets.as_ref().map_or(DEFAULT_INSETS, |i| {
        (round(i.left), round(i.top), round(i.right), round(i.bottom))
    })
}

/// Compares two texts.
pub fn compare(diff: &mut Diff, at: &str, a: &Side, b: &Side) {
    let pa = looks_and_settings(a.deck, a.text, a.base, a.index_of);
    let pb = looks_and_settings(b.deck, b.text, b.base, b.index_of);
    if pa.len() != pb.len() {
        diff.note(at, format!("{} paragraphs became {}", pa.len(), pb.len()));
        return;
    }
    for (n, ((sa, ca), (sb, cb))) in pa.iter().zip(&pb).enumerate() {
        let words = |c: &[(char, Look)]| c.iter().map(|(c, _)| *c).collect::<String>();
        if words(ca) != words(cb) {
            diff.note(
                at,
                format!("paragraph {n}: {:?} became {:?}", words(ca), words(cb)),
            );
            continue;
        }
        if sa != sb {
            diff.note(
                at,
                format!(
                    "paragraph {n} ({:?}) is set as {sa:?}, came back as {sb:?}",
                    words(ca)
                ),
            );
        }
        for (i, ((c, la), (_, lb))) in ca.iter().zip(cb).enumerate() {
            if la != lb {
                diff.note(
                    at,
                    format!("paragraph {n}, character {i} ({c:?}): {la:?} came back as {lb:?}"),
                );
                break;
            }
        }
    }
    let (va, vb) = (
        a.text.valign.clone().unwrap_or(a.valign.clone()),
        b.text.valign.clone().unwrap_or(b.valign.clone()),
    );
    if va != vb {
        diff.note(at, format!("vertical alignment {va:?} came back as {vb:?}"));
    }
    // What the box does with words that do not fit it, and whether it wraps; "do not autofit" and "wraps" are the defaults.
    let boxed = |t: &Text| {
        (
            t.fit.clone().filter(|f| *f != slides_core::TextFit::Off),
            t.wrap != Some(false),
        )
    };
    if boxed(a.text) != boxed(b.text) {
        diff.note(
            at,
            format!(
                "fit and wrapping {:?} came back as {:?}",
                boxed(a.text),
                boxed(b.text)
            ),
        );
    }
    if insets(a.text) != insets(b.text) {
        diff.note(
            at,
            format!(
                "insets {:?} came back as {:?}",
                insets(a.text),
                insets(b.text)
            ),
        );
    }
}
