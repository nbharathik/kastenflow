//! A text body (`p:txBody`) turned into a deck's `Text`. Every paragraph and
//! run is worked out as PowerPoint would draw it, through the chain of
//! layers below it, and then written down as only what differs from the text
//! style the box starts from, so text stays as plain in the deck as it was
//! in the theme and follows the theme where the file did.

use slides_core::{
    Align, Extra, ListKind, Paragraph, Run, Script, Text, TextFit, TextStyle, VAlign, list,
};

use super::body::BodyProps;
use super::chain::Chain;
use super::levels::{self, Bullet, Level, Reader, RunProps, Spacing};
use crate::import::color::{ColorCx, Rgb};
use crate::import::dom::Node;
use crate::import::styles::{DEFAULT_SIZE, StyleBook, line_multiple, space_points};
use crate::import::units::{round2, round4};
use crate::text::metrics::CODE_GROUND;

/// What a text body needs from the part it is in.
pub struct TextEnv<'a> {
    pub reader: Reader<'a>,
    pub styles: &'a StyleBook,
    /// The text style the box starts from.
    pub base: &'a str,
    /// The layers below the shape's own list style.
    pub chain: &'a Chain,
    /// The box's settings, layout and master included.
    pub body: BodyProps,
    /// Where the text sits when the file does not say.
    pub default_valign: VAlign,
}

/// How a text body reaches the rest of the import.
pub trait TextSink {
    /// The address an `a:hlinkClick` stands for; None if it is not one a deck keeps.
    fn link(&mut self, click: &Node) -> Option<String>;
    /// Something in the text could not be kept.
    fn warn(&mut self, message: &str);
}

fn differs(a: f64, b: f64) -> bool {
    (a - b).abs() > 0.011
}

fn plain_base(styles: &StyleBook, name: &str) -> TextStyle {
    styles
        .get(name)
        .or_else(|| styles.get("body"))
        .cloned()
        .unwrap_or_else(|| {
            slides_core::themes::light()
                .text_styles
                .remove("body")
                .unwrap_or(TextStyle {
                    size: DEFAULT_SIZE,
                    color: "text1".to_owned(),
                    font: "body".to_owned(),
                    bold: false,
                    italic: false,
                    align: None,
                    line_spacing: None,
                    space_before: None,
                    space_after: None,
                    extra: Extra::new(),
                })
        })
}

/// A run as it is drawn: its own properties over the paragraph's.
struct Piece {
    text: String,
    props: RunProps,
    link: Option<String>,
    field: Option<String>,
}

fn is_mono(font: &str) -> bool {
    crate::fonts::kind_of(&[font]) == crate::fonts::Kind::Mono
}

/// The ground the editor lays behind inline code, as a file holds it: the text colour over the page
/// at a fraction (the export writes this colour for a run that is `code`).
fn code_ground(colors: &ColorCx) -> Rgb {
    let deck = colors.deck_colors();
    let (text, page) = (deck[0].1, deck[2].1);
    let mix = |over: u8, below: u8| {
        (f64::from(below) + (f64::from(over) - f64::from(below)) * CODE_GROUND)
            .round()
            .clamp(0.0, 255.0) as u8
    };
    Rgb(
        mix(text.0, page.0),
        mix(text.1, page.1),
        mix(text.2, page.2),
    )
}

/// Whether a highlight is that ground, to a step in a channel, which is all a trip through a file can lose.
fn is_code_ground(value: &str, colors: &ColorCx) -> bool {
    let Some(rgb) = value.strip_prefix('#').and_then(Rgb::from_hex) else {
        return false;
    };
    let ground = code_ground(colors);
    [(rgb.0, ground.0), (rgb.1, ground.1), (rgb.2, ground.2)]
        .iter()
        .all(|(a, b)| a.abs_diff(*b) <= 1)
}

fn run_of(piece: Piece, base: &TextStyle, scale: f64, colors: &ColorCx) -> Run {
    let props = &piece.props;
    let size = round2(props.size.unwrap_or(DEFAULT_SIZE) * scale);
    let linked = piece.link.is_some();
    let mut run = Run::plain(piece.text);
    if differs(size, base.size) {
        run.size = Some(size);
    }
    run.bold = props.bold.unwrap_or(false) && !base.bold;
    run.italic = props.italic.unwrap_or(false) && !base.italic;
    // A link is drawn underlined in the theme's link colour whatever the run says.
    run.underline = props.underline.unwrap_or(false) && !linked;
    run.strike = props.strike.unwrap_or(false);
    if let Some(paint) = &props.color
        && paint.value != base.color
        && !(linked && paint.value == "accent1")
    {
        run.color = Some(paint.value.clone());
    }
    let highlight = props.highlight.as_ref().map(|paint| paint.value.clone());
    match &props.font {
        Some(font) if highlight.is_some() && (is_mono(font) || font == "code") => {
            run.code = true;
        }
        Some(font) if *font != base.font => run.font = Some(font.clone()),
        _ => {}
    }
    // Inline code has a ground of its own: only a highlight that is not that ground is the run's.
    run.highlight = highlight.filter(|value| !(run.code && is_code_ground(value, colors)));
    run.link = piece.link;
    run.field = piece.field;
    run.script = match props.baseline {
        Some(b) if b > 0 => Some(Script::Super),
        Some(b) if b < 0 => Some(Script::Sub),
        _ => None,
    };
    match props.cap.as_deref() {
        Some("small") => run.small_caps = true,
        Some("all") => run.all_caps = true,
        _ => {}
    }
    run.spacing = props
        .spacing
        .filter(|s| s.abs() >= 0.005)
        .map(crate::import::units::round2);
    run
}

fn same_look(a: &Run, b: &Run) -> bool {
    a.bold == b.bold
        && a.italic == b.italic
        && a.underline == b.underline
        && a.strike == b.strike
        && a.color == b.color
        && a.highlight == b.highlight
        && a.size == b.size
        && a.font == b.font
        && a.link == b.link
        && a.code == b.code
        && a.script == b.script
        && a.small_caps == b.small_caps
        && a.all_caps == b.all_caps
        && a.spacing == b.spacing
        && a.field.is_none()
        && b.field.is_none()
}

fn push_run(runs: &mut Vec<Run>, run: Run) {
    if let Some(last) = runs.last_mut()
        && same_look(last, &run)
    {
        last.t.push_str(&run.t);
        return;
    }
    runs.push(run);
}

fn pieces(p: &Node, level: &Level, env: &TextEnv, sink: &mut dyn TextSink) -> Vec<Piece> {
    let mut out = Vec::new();
    for child in p.elements() {
        let (text, field) = match child.name.as_str() {
            "a:r" => (
                child.child("a:t").map(|t| t.text()).unwrap_or_default(),
                None,
            ),
            "a:br" => ("\n".to_owned(), None),
            "a:fld" => {
                let shown = child.child("a:t").map(|t| t.text()).unwrap_or_default();
                match child.attr("type") {
                    // The sample is what a slide would show; a program's placeholder such as `<number>` is not.
                    Some("slidenum") => {
                        let sample =
                            if !shown.is_empty() && shown.chars().all(|c| c.is_ascii_digit()) {
                                shown
                            } else {
                                "1".to_owned()
                            };
                        (sample, Some("slideNumber".to_owned()))
                    }
                    Some(kind) => {
                        sink.warn(&format!("a `{kind}` field became the text it showed"));
                        (shown, None)
                    }
                    None => (shown, None),
                }
            }
            "mc:AlternateContent" => {
                sink.warn("an equation in the text was left out");
                continue;
            }
            _ => continue,
        };
        let own = child
            .child("a:rPr")
            .map(|r| levels::run_props(r, &env.reader, None))
            .unwrap_or_default();
        let link = child
            .child("a:rPr")
            .and_then(|r| r.child("a:hlinkClick"))
            .and_then(|click| sink.link(click));
        out.push(Piece {
            text,
            props: own.over(&level.run),
            link,
            field,
        });
    }
    out
}

/// What a paragraph says about where its lines start and how its numbers count, to be settled
/// when all the paragraphs of the text are known.
struct Placed {
    /// Where the lines after the first start, and where the first starts from there (slide units), as the file says.
    margin: Option<f64>,
    indent: Option<f64>,
    /// How PowerPoint counts this item: its scheme and where its run begins.
    count: Option<(Option<slides_core::ListStyle>, u32)>,
    /// The size of the paragraph's marker in points, for the room it needs.
    points: f64,
}

fn paragraph(
    p: &Node,
    own_lst: &levels::Levels,
    env: &TextEnv,
    base: &TextStyle,
    scale: (f64, f64),
    sink: &mut dyn TextSink,
) -> (Paragraph, Placed) {
    let ppr = p.child("a:pPr");
    let lvl = ppr
        .and_then(|n| n.int("lvl"))
        .map_or(0, |v| v.clamp(0, 8) as usize);
    let mut own = ppr
        .map(|n| levels::level(n, &env.reader, None))
        .unwrap_or_default();
    // A paragraph's own default run properties are not used by PowerPoint.
    own.run = RunProps::default();
    let level = own.over(&own_lst.level(lvl)).over(&env.chain.level(lvl));

    let mut pieces = pieces(p, &level, env, sink);
    if pieces
        .iter()
        .all(|piece| piece.text.is_empty() && piece.field.is_none())
    {
        // An empty paragraph keeps the look its paragraph mark gives it: it is as tall as the
        // mark says, and so is its marker.
        let mark = p
            .child("a:endParaRPr")
            .map(|r| levels::run_props(r, &env.reader, None))
            .unwrap_or_default()
            .over(&level.run);
        pieces.clear();
        pieces.push(Piece {
            text: String::new(),
            props: mark,
            link: None,
            field: None,
        });
    }
    // The size lines are measured by: the largest on show, or the mark's when nothing is.
    let size = pieces
        .iter()
        .filter(|piece| !piece.text.is_empty() || piece.field.is_some())
        .map(|piece| piece.props.size.unwrap_or(DEFAULT_SIZE) * scale.0)
        .reduce(f64::max)
        .unwrap_or_else(|| {
            pieces
                .first()
                .and_then(|piece| piece.props.size)
                .or(level.run.size)
                .unwrap_or(DEFAULT_SIZE)
                * scale.0
        });

    let mut runs: Vec<Run> = Vec::new();
    for piece in pieces {
        let run = run_of(piece, base, scale.0, &env.reader.colors);
        if run.field.is_some() {
            runs.push(run);
        } else {
            push_run(&mut runs, run);
        }
    }

    let line = level.line.map(|s| match s {
        Spacing::Percent(p) => line_multiple(Spacing::Percent(p * (1.0 - scale.1)), size),
        other => line_multiple(other, size),
    });
    let mut out = Paragraph {
        runs,
        align: None,
        list: match level.bullet {
            Some(Bullet::Char) => Some(ListKind::Bullet),
            Some(Bullet::Number) => Some(ListKind::Number),
            _ => None,
        },
        level: (lvl > 0).then_some(lvl as u8),
        style: None,
        space_before: None,
        space_after: None,
        line_spacing: None,
        step: None,
        list_style: None,
        start: None,
        bullet_color: None,
        bullet_size: None,
        margin_left: None,
        indent: None,
        extra: slides_core::Extra::new(),
    };
    if let Some(kind) = &out.list {
        // The marker's own look, where it is not what the level and the words would give it.
        let marker = &level.marker;
        out.list_style = marker
            .style
            .clone()
            .filter(|s| s.kind() == *kind && *s != list::default_style(kind, lvl));
        let first = out
            .runs
            .iter()
            .find(|r| !r.t.is_empty())
            .or(out.runs.first());
        let words = first
            .and_then(|r| r.color.clone())
            .unwrap_or_else(|| base.color.clone());
        out.bullet_color = marker
            .color
            .as_ref()
            .map(|paint| paint.value.clone())
            .filter(|color| *color != words);
        out.bullet_size = marker
            .size
            .filter(|share| (share - 1.0).abs() > 0.01)
            .map(round4);
    }
    let first = out
        .runs
        .iter()
        .find(|r| !r.t.is_empty())
        .or(out.runs.first());
    let placed = Placed {
        margin: level.marker.margin,
        indent: level.marker.indent,
        count: matches!(level.bullet, Some(Bullet::Number)).then(|| {
            (
                level.marker.style.clone(),
                level.marker.start_at.unwrap_or(1),
            )
        }),
        points: first.and_then(|r| r.size).unwrap_or(base.size) * out.bullet_size.unwrap_or(1.0),
    };
    let base_align = base.align.clone().unwrap_or(Align::Left);
    let wanted = level.align.clone().unwrap_or(Align::Left);
    if wanted != base_align {
        out.align = Some(wanted);
    }
    if let Some(value) = line
        && differs(value, base.line_spacing.unwrap_or(1.0))
    {
        out.line_spacing = Some(round4(value));
    }
    if let Some(s) = level.before {
        let value = space_points(s, size);
        if differs(value, base.space_before.unwrap_or(0.0)) {
            out.space_before = Some(value);
        }
    }
    if let Some(s) = level.after {
        let value = space_points(s, size);
        if differs(value, base.space_after.unwrap_or(0.0)) {
            out.space_after = Some(value);
        }
    }
    (out, placed)
}

/// The number PowerPoint shows for each numbered paragraph: an item counts on from the one before it
/// at its level when that has the same scheme and the same starting number; otherwise it starts there.
fn powerpoint_counts(paragraphs: &[Paragraph], placed: &[Placed]) -> Vec<Option<u32>> {
    type Counter = (Option<slides_core::ListStyle>, u32, u32);
    let mut counters: Vec<Option<Counter>> = Vec::new();
    paragraphs
        .iter()
        .zip(placed)
        .map(|(p, at)| {
            let level = list::level(p);
            match &p.list {
                None => {
                    counters.clear();
                    None
                }
                Some(ListKind::Bullet) => {
                    counters.truncate(level + 1);
                    counters.resize(level + 1, None);
                    counters[level] = None;
                    None
                }
                Some(ListKind::Number) => {
                    counters.truncate(level + 1);
                    counters.resize(level + 1, None);
                    let (scheme, start) = at.count.clone().unwrap_or((None, 1));
                    let n = match &counters[level] {
                        Some((s, st, count)) if *s == scheme && *st == start => count + 1,
                        _ => start,
                    };
                    counters[level] = Some((scheme, start, n));
                    Some(n)
                }
            }
        })
        .collect()
}

/// Makes the deck count as the file does: an item that would not come out at the number PowerPoint
/// shows is told where to begin, and the paragraphs whose indents are not the editor's own say so.
fn settle(paragraphs: &mut [Paragraph], placed: &[Placed]) {
    list::reconcile(paragraphs, &powerpoint_counts(paragraphs, placed));
    let points: Vec<f64> = placed.iter().map(|p| p.points).collect();
    let usual = list::layout(paragraphs, &points);
    for ((paragraph, said), usual) in paragraphs.iter_mut().zip(placed).zip(usual) {
        if let Some(margin) = said.margin
            && (margin - usual.margin).abs() > 0.5
        {
            paragraph.margin_left = Some(margin);
        }
        if let Some(indent) = said.indent
            && (indent - usual.indent).abs() > 0.5
        {
            paragraph.indent = Some(indent);
        }
    }
}

/// The text of a `p:txBody` or `a:txBody`, as a deck holds it.
pub fn convert(tx_body: &Node, env: &TextEnv, sink: &mut dyn TextSink) -> Text {
    let base = plain_base(env.styles, env.base);
    let own_lst = tx_body
        .child("a:lstStyle")
        .map(|l| levels::list_style(l, &env.reader, None))
        .unwrap_or_else(levels::Levels::empty);
    // A box that PowerPoint shrank its words to fit keeps the sizes they were written in and says so (`fit`): how much to
    // shrink is found again from the words and the box, wherever they are drawn, so more words shrink them further and
    // fewer give them back. The scale in the file is not carried over.
    let scale = (1.0, 0.0);
    let (mut paragraphs, mut placed): (Vec<Paragraph>, Vec<Placed>) = tx_body
        .children_named("a:p")
        .map(|p| paragraph(p, &own_lst, env, &base, scale, sink))
        .unzip();
    if paragraphs.is_empty() {
        paragraphs.push(Paragraph::plain(""));
        placed.push(Placed {
            margin: None,
            indent: None,
            count: None,
            points: base.size,
        });
    }
    settle(&mut paragraphs, &placed);
    let mut text = Text::from_paragraphs(paragraphs);
    text.insets = env.body.insets();
    // A body that names no anchor anywhere down its chain is anchored at the top.
    let anchor = env.body.anchor.clone().unwrap_or(VAlign::Top);
    text.valign = (anchor != env.default_valign).then_some(anchor);
    text.fit = match env.body.fit {
        Some(TextFit::Shrink) => Some(TextFit::Shrink),
        Some(TextFit::Resize) => Some(TextFit::Resize),
        _ => None,
    };
    text.wrap = (env.body.wrap == Some(false)).then_some(false);
    text
}

#[cfg(test)]
mod tests;
