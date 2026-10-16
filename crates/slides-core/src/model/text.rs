//! Text: paragraphs of runs. Runs, not Markdown, so colours and sizes per
//! word survive a trip through PPTX. Operations still accept Markdown, which
//! `crate::markdown` turns into these.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Extra;

model! {
    #[serde(rename_all = "camelCase")]
    pub enum Align {
        Left,
        Center,
        Right,
        Justify,
    }

    #[serde(rename_all = "camelCase")]
    pub enum VAlign {
        Top,
        Middle,
        Bottom,
    }

    #[serde(rename_all = "camelCase")]
    pub enum ListKind {
        Bullet,
        Number,
    }

    /// How the marker in front of a list item looks: a glyph for a bullet list, a
    /// counting scheme for a numbered one. The paragraph's `list` says which kind of
    /// list it is; a style of the other kind is ignored and the level's own is used.
    #[serde(rename_all = "camelCase")]
    pub enum ListStyle {
        /// ● (the first level of a bullet list).
        Disc,
        /// ○ (the second level).
        Circle,
        /// ■ (the third level).
        Square,
        Arrow,
        Check,
        Dash,
        /// 1. 2. 3. (the first level of a numbered list).
        Decimal,
        /// 1) 2) 3)
        DecimalParen,
        /// a. b. c. (the second level).
        LowerAlpha,
        /// A. B. C.
        UpperAlpha,
        /// i. ii. iii. (the third level).
        LowerRoman,
        /// I. II. III.
        UpperRoman,
    }

    /// Raised or lowered text, set smaller as in a footnote mark or a power.
    #[serde(rename_all = "camelCase")]
    pub enum Script {
        Super,
        Sub,
    }

    /// What a text box does when its words do not fit it.
    #[serde(rename_all = "camelCase")]
    pub enum TextFit {
        /// The words run past the edge of the box (the default).
        #[serde(rename = "none")]
        Off,
        /// The type is set smaller, to a floor, until the words fit.
        Shrink,
        /// The box grows or shrinks in height to fit its words.
        Resize,
    }

    /// Space between a box's edge and its text, in slide units.
    #[serde(rename_all = "camelCase")]
    pub struct Insets {
        pub left: f64,
        pub top: f64,
        pub right: f64,
        pub bottom: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A stretch of text with one look.
    #[serde(rename_all = "camelCase")]
    pub struct Run {
        /// The text.
        pub t: String,
        #[serde(default, skip_serializing_if = "is_false", rename = "b")]
        pub bold: bool,
        #[serde(default, skip_serializing_if = "is_false", rename = "i")]
        pub italic: bool,
        #[serde(default, skip_serializing_if = "is_false", rename = "u")]
        pub underline: bool,
        #[serde(default, skip_serializing_if = "is_false", rename = "s")]
        pub strike: bool,
        /// A theme token or `#rrggbb`; the paragraph's style when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        /// A colour behind the words, like a marker pen: a theme token or `#rrggbb`. Inline `code` has a ground of its own; a highlight is drawn instead of it. (Deck format 2.)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub highlight: Option<String>,
        /// Points.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub size: Option<f64>,
        /// `heading`, `body`, `code` or a family name.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub font: Option<String>,
        /// A web address, `slide:<id>` for a link to a slide, or `page:<path>` (then `#` and a heading) for a link to a page of the host.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub link: Option<String>,
        /// Inline code: drawn in the code font.
        #[serde(default, skip_serializing_if = "is_false")]
        pub code: bool,
        /// Inline math: `t` is LaTeX.
        #[serde(default, skip_serializing_if = "is_false")]
        pub math: bool,
        /// A field the text stands for, such as `slideNumber`; `t` is its sample.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub field: Option<String>,
        /// Raised (superscript) or lowered (subscript) and set smaller.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub script: Option<Script>,
        /// Lower-case letters drawn as small capitals.
        #[serde(default, skip_serializing_if = "is_false")]
        pub small_caps: bool,
        /// Every letter drawn as a capital; the words themselves are not changed.
        #[serde(default, skip_serializing_if = "is_false")]
        pub all_caps: bool,
        /// Extra space between letters, in points; negative tightens.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub spacing: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A paragraph: runs and how they are set.
    #[serde(rename_all = "camelCase")]
    pub struct Paragraph {
        pub runs: Vec<Run>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub align: Option<Align>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub list: Option<ListKind>,
        /// Indent level of a list item, from 0.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub level: Option<u8>,
        /// The theme text style the paragraph starts from: `title`,
        /// `subtitle`, `body`, `caption`, `code` or `citation`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub style: Option<String>,
        /// Points.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub space_before: Option<f64>,
        /// Points.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub space_after: Option<f64>,
        /// A multiple of the line height, such as 1.15.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub line_spacing: Option<f64>,
        /// The step at which this paragraph appears, for lists that build line by line.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub step: Option<u32>,
        /// How the marker of a list item looks; the level's own when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub list_style: Option<ListStyle>,
        /// The number a numbered item begins counting at: it starts a run of its own
        /// even when numbered items come before it ("restart numbering", or a run
        /// that goes on after something else, "continue the previous list").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub start: Option<u32>,
        /// The marker's colour, a theme token or `#rrggbb`; the first words' own when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub bullet_color: Option<String>,
        /// The marker's size as a multiple of the words' size, 0.25 to 4 (25% to 400%); 1 when absent.
        /// An empty paragraph's words are the one empty run it holds, whose size, colour and other
        /// settings are the paragraph's mark: they decide how large its marker and its line are.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub bullet_size: Option<f64>,
        /// Where the lines after the first start, in slide units from the box's inset. The
        /// list level decides when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub margin_left: Option<f64>,
        /// Where the first line starts, in slide units from `margin_left`; negative hangs it
        /// out to the left, as a list marker does. The marker's room decides when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub indent: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The text of a text box, a shape, a table cell or a label.
    #[serde(rename_all = "camelCase")]
    pub struct Text {
        pub paragraphs: Vec<Paragraph>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub valign: Option<VAlign>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub insets: Option<Insets>,
        /// What the box does when the words do not fit; they run past the edge when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub fit: Option<TextFit>,
        /// `false` keeps every paragraph on one line instead of wrapping at the box's edge.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub wrap: Option<bool>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl Run {
    pub fn plain(t: impl Into<String>) -> Run {
        Run {
            t: t.into(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            color: None,
            highlight: None,
            size: None,
            font: None,
            link: None,
            code: false,
            math: false,
            field: None,
            script: None,
            small_caps: false,
            all_caps: false,
            spacing: None,
            extra: Extra::new(),
        }
    }
}

impl Paragraph {
    pub fn plain(t: impl Into<String>) -> Paragraph {
        Paragraph {
            runs: vec![Run::plain(t)],
            align: None,
            list: None,
            level: None,
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
            extra: Extra::new(),
        }
    }

    /// The paragraph's text without its looks.
    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.t.as_str()).collect()
    }
}

impl Text {
    pub fn plain(t: impl Into<String>) -> Text {
        Text::from_paragraphs(vec![Paragraph::plain(t)])
    }

    pub fn from_paragraphs(paragraphs: Vec<Paragraph>) -> Text {
        Text {
            paragraphs,
            valign: None,
            insets: None,
            fit: None,
            wrap: None,
            extra: Extra::new(),
        }
    }

    /// All the text, a paragraph per line.
    pub fn plain_text(&self) -> String {
        self.paragraphs
            .iter()
            .map(Paragraph::text)
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn is_blank(&self) -> bool {
        self.paragraphs
            .iter()
            .all(|p| p.runs.iter().all(|r| r.t.is_empty()))
    }

    /// Whether the words are nothing but spaces: a cell of spaces says as little as an empty one.
    pub fn says_nothing(&self) -> bool {
        self.paragraphs
            .iter()
            .all(|p| p.runs.iter().all(|r| r.t.trim().is_empty()))
    }
}
