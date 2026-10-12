//! The twelve layouts every theme offers.
//!
//! A [`Frame`] holds the few numbers that say where a theme lets content
//! start, and every layout is worked out from it. The plain themes and
//! Lecture, whose header bar pushes content down, therefore share one
//! description and cannot drift apart.

use crate::model::{Layout, ListKind, PlaceholderDef, PlaceholderKind, VAlign};
use crate::units::{SLIDE_HEIGHT, SLIDE_WIDTH};

/// A box: x, y, width and height in slide units.
type Rect = (f64, f64, f64, f64);

/// Space between two columns.
const COLUMN_GAP: f64 = 32.0;
/// Room for a caption of one or two lines.
const CAPTION_H: f64 = 44.0;
/// Space between a picture and its caption.
const CAPTION_GAP: f64 = 12.0;
/// Room for the label over a column, one line.
const LABEL_H: f64 = 44.0;
/// Space between a label and what it names.
const LABEL_GAP: f64 = 8.0;

/// Where a theme lets content go, in slide units.
pub(super) struct Frame {
    /// Margin at the left edge.
    pub left: f64,
    /// Margin at the right edge.
    pub right: f64,
    /// Where the title of a content slide starts.
    pub top: f64,
    /// Height of that title.
    pub title_h: f64,
    /// Space between the title and what is under it.
    pub gap: f64,
    /// Where content ends. The slide number sits below it.
    pub bottom: f64,
    /// The line that blocks set in the middle of a slide, a big number or a
    /// quote, are centred on.
    pub mid: f64,
}

/// The plain themes: the title starts near the top edge.
pub(super) const PLAIN: Frame = Frame {
    left: 64.0,
    right: 64.0,
    top: 36.0,
    title_h: 96.0,
    gap: 16.0,
    bottom: 492.0,
    mid: 272.0,
};

/// Lecture: everything starts under the 56-unit header bar.
pub(super) const BARRED: Frame = Frame {
    left: 64.0,
    right: 64.0,
    top: 72.0,
    title_h: 80.0,
    gap: 12.0,
    bottom: 492.0,
    mid: 288.0,
};

impl Frame {
    fn width(&self) -> f64 {
        SLIDE_WIDTH - self.left - self.right
    }

    /// Where what sits under the title starts.
    fn content_y(&self) -> f64 {
        self.top + self.title_h + self.gap
    }

    fn content_h(&self) -> f64 {
        self.bottom - self.content_y()
    }

    /// The whole width, from under the title to the bottom.
    fn content(&self) -> Rect {
        (self.left, self.content_y(), self.width(), self.content_h())
    }

    /// The title of a content slide. It is centred in its box, so a title of
    /// one line and one of two both sit well, and neither reaches the body.
    fn title(&self) -> PlaceholderDef {
        slot(
            "title",
            "title",
            (self.left, self.top, self.width(), self.title_h),
            VAlign::Middle,
        )
    }

    /// Two boxes side by side, `h` tall from `y`, the left one first.
    fn columns(&self, y: f64, h: f64) -> (Rect, Rect) {
        let w = (self.width() - COLUMN_GAP) / 2.0;
        ((self.left, y, w, h), (self.left + w + COLUMN_GAP, y, w, h))
    }
}

/// The twelve layouts, in the order a picker lists them.
pub(super) fn twelve(f: &Frame) -> Vec<Layout> {
    vec![
        cover(f, "title", "Title", 148.0, 96.0),
        cover(f, "section", "Section", 108.0, 72.0),
        title_body(f),
        title_only(f),
        two_columns(f),
        title_image(f),
        image_caption(f),
        code(f),
        comparison(f),
        big_number(f),
        quote(f),
        layout("blank", "Blank", vec![]),
    ]
}

/// A big title with its subtitle under it, the pair centred on the slide.
/// The title hangs from its bottom edge, so a long one grows upward instead
/// of into the subtitle.
fn cover(f: &Frame, name: &str, label: &str, title_h: f64, subtitle_h: f64) -> Layout {
    let (title_y, subtitle_y) = stacked(SLIDE_HEIGHT / 2.0, title_h, 16.0, subtitle_h);
    let title = (f.left, title_y, f.width(), title_h);
    let subtitle = (f.left, subtitle_y, f.width(), subtitle_h);
    layout(
        name,
        label,
        vec![
            slot("title", "display", title, VAlign::Bottom),
            slot("subtitle", "subtitle", subtitle, VAlign::Top),
        ],
    )
}

fn title_body(f: &Frame) -> Layout {
    layout(
        "title-body",
        "Title + body",
        vec![f.title(), bullets("body", f.content())],
    )
}

fn title_only(f: &Frame) -> Layout {
    layout("title-only", "Title only", vec![f.title()])
}

fn two_columns(f: &Frame) -> Layout {
    let (left, right) = f.columns(f.content_y(), f.content_h());
    layout(
        "two-columns",
        "Two columns",
        vec![f.title(), bullets("body", left), bullets("body2", right)],
    )
}

fn title_image(f: &Frame) -> Layout {
    let (left, right) = f.columns(f.content_y(), f.content_h());
    layout(
        "title-image",
        "Title + image",
        vec![f.title(), bullets("body", left), picture(right)],
    )
}

/// A picture as large as the slide allows, with a strip for its caption.
fn image_caption(f: &Frame) -> Layout {
    let strip_y = f.bottom - CAPTION_H;
    let image = (f.left, f.top, f.width(), strip_y - CAPTION_GAP - f.top);
    let strip = (f.left, strip_y, f.width(), CAPTION_H);
    layout(
        "image-caption",
        "Image + caption",
        vec![
            picture(image),
            slot("caption", "caption", strip, VAlign::Top),
        ],
    )
}

fn code(f: &Frame) -> Layout {
    layout(
        "code",
        "Code",
        vec![f.title(), slot("code", "code", f.content(), VAlign::Top)],
    )
}

/// Two columns, each with a label over its text. The labels hang from their
/// bottom edge, so they stay close to the text under them.
fn comparison(f: &Frame) -> Layout {
    let (label, label2) = f.columns(f.content_y(), LABEL_H);
    let text_y = f.content_y() + LABEL_H + LABEL_GAP;
    let (body, body2) = f.columns(text_y, f.bottom - text_y);
    layout(
        "comparison",
        "Comparison",
        vec![
            f.title(),
            slot("label", "subtitle", label, VAlign::Bottom),
            slot("label2", "subtitle", label2, VAlign::Bottom),
            bullets("body", body),
            bullets("body2", body2),
        ],
    )
}

/// One figure, as large as it gets, and what it counts.
fn big_number(f: &Frame) -> Layout {
    let (number_y, label_y) = stacked(f.mid, 176.0, LABEL_GAP, 72.0);
    let number = (f.left, number_y, f.width(), 176.0);
    let label = (f.left, label_y, f.width(), 72.0);
    layout(
        "big-number",
        "Big number",
        vec![
            slot("number", "big-number", number, VAlign::Bottom),
            slot("label", "subtitle", label, VAlign::Top),
        ],
    )
}

/// A quotation with its source under it. Both are set narrower than a
/// paragraph: a long line of large italics is hard to follow.
fn quote(f: &Frame) -> Layout {
    let (quote_y, source_y) = stacked(f.mid, 232.0, 16.0, 48.0);
    let (x, w) = (f.left + 32.0, f.width() - 64.0);
    let text = (x, quote_y, w, 232.0);
    let source = (x, source_y, w, 48.0);
    let attribution = PlaceholderDef {
        prompt: "Click to add attribution".to_owned(),
        ..slot("caption", "caption", source, VAlign::Top)
    };
    layout(
        "quote",
        "Quote",
        vec![slot("quote", "quote", text, VAlign::Bottom), attribution],
    )
}

fn layout(name: &str, label: &str, placeholders: Vec<PlaceholderDef>) -> Layout {
    Layout {
        name: name.to_owned(),
        label: label.to_owned(),
        placeholders,
        hide_master: false,
        elements: Vec::new(),
        background: None,
        extra: crate::model::Extra::new(),
    }
}

/// A text placeholder. What it asks for follows from its role.
fn slot(role: &str, style: &str, (x, y, w, h): Rect, valign: VAlign) -> PlaceholderDef {
    PlaceholderDef {
        role: role.to_owned(),
        kind: PlaceholderKind::Text,
        x,
        y,
        w,
        h,
        style: Some(style.to_owned()),
        valign: Some(valign),
        list: None,
        prompt: format!("Click to add {}", noun(role)),
        extra: crate::model::Extra::new(),
    }
}

/// A list: what is typed into it becomes bullets.
fn bullets(role: &str, at: Rect) -> PlaceholderDef {
    PlaceholderDef {
        list: Some(ListKind::Bullet),
        ..slot(role, "body", at, VAlign::Top)
    }
}

/// A picture. It names a text style like every placeholder does, so code that
/// reads one never has to ask whether a style is there.
fn picture(at: Rect) -> PlaceholderDef {
    PlaceholderDef {
        kind: PlaceholderKind::Image,
        ..slot("image", "caption", at, VAlign::Middle)
    }
}

/// The word a role's prompt asks for: bodies are "text", both labels "label".
fn noun(role: &str) -> &str {
    match role {
        "body" | "body2" => "text",
        "label" | "label2" => "label",
        other => other,
    }
}

/// The tops of two boxes `gap` apart, one under the other, the pair centred on `mid`.
fn stacked(mid: f64, first_h: f64, gap: f64, second_h: f64) -> (f64, f64) {
    let top = mid - (first_h + gap + second_h) / 2.0;
    (top, top + first_h + gap)
}
