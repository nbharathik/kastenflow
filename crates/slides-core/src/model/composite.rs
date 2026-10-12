//! Composite elements: things built from primitives. Each has its own few
//! fields and an `expand()` (see `crate::composites`) that turns it into plain
//! text, shapes, lines and pictures. The editor, present mode and the PowerPoint
//! export all draw the expansion, so they always look the same.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Base, Extra, is_false};

model! {
    #[serde(rename_all = "camelCase")]
    pub enum CodeTheme {
        Dark,
        Light,
    }

    /// Code with syntax colours, optionally walked through a few lines at a time.
    #[serde(rename_all = "camelCase")]
    pub struct CodeEl {
        #[serde(flatten)]
        pub base: Base,
        /// A language name or file extension: `python`, `rust`, `ts`; `text` for none.
        #[serde(default)]
        pub language: String,
        pub code: String,
        /// `dark` (the default) or `light` colours for the block.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub theme: Option<CodeTheme>,
        #[serde(default, skip_serializing_if = "is_false")]
        pub line_numbers: bool,
        /// The number the first line is given, for an excerpt of a longer file. 1 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub first_line: Option<u32>,
        /// One entry per step: the lines in focus, such as `"1"`, `"2-3"` or `"4,6-10"`. The other lines are dimmed at that step.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub focus: Vec<String>,
        /// Points; the theme's code size when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub font_size: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A formula, drawn by KaTeX.
    #[serde(rename_all = "camelCase")]
    pub struct MathEl {
        #[serde(flatten)]
        pub base: Base,
        /// LaTeX, without the surrounding `$`.
        pub latex: String,
        /// Set in a line of its own and larger, the default; inline is smaller and tighter.
        #[serde(default, skip_serializing_if = "is_false")]
        pub inline: bool,
        /// A colour token or hex value; the text colour when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        /// Points; 32 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub font_size: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub enum ChatRole {
        System,
        User,
        Assistant,
        ToolCall,
        ToolResult,
    }

    #[serde(rename_all = "camelCase")]
    pub struct ChatMessage {
        pub role: ChatRole,
        pub text: String,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A conversation with a model: one bubble for each message.
    #[serde(rename_all = "camelCase")]
    pub struct ChatEl {
        #[serde(flatten)]
        pub base: Base,
        pub messages: Vec<ChatMessage>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A token the model might write next, and how likely.
    #[serde(rename_all = "camelCase")]
    pub struct NextToken {
        pub token: String,
        /// 0 to 1.
        pub p: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The text so far as token chips, and a bar for each likely next token.
    #[serde(rename_all = "camelCase")]
    pub struct TokenProbsEl {
        #[serde(flatten)]
        pub base: Base,
        /// The tokens already written, in order.
        #[serde(default)]
        pub tokens: Vec<String>,
        pub next: Vec<NextToken>,
        /// The index in `next` of the token that was picked, drawn highlighted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub chosen: Option<u32>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct Card {
        pub title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub body: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// Cards in a grid, each a heading and a line.
    #[serde(rename_all = "camelCase")]
    pub struct CardGridEl {
        #[serde(flatten)]
        pub base: Base,
        pub cards: Vec<Card>,
        /// How many cards to a row; chosen from the number of cards when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub columns: Option<u32>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub enum CitationStyle {
        /// `(Vaswani et al., 2017)`
        Short,
        /// The whole reference.
        Full,
        /// `[1]`
        Numbered,
        /// A list of the whole references, one to a line.
        List,
    }

    /// One or more references, by their BibTeX keys. (`format` names how they are written; `style` is the element's looks, as for every element.)
    #[serde(rename_all = "camelCase")]
    pub struct CitationEl {
        #[serde(flatten)]
        pub base: Base,
        pub keys: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub format: Option<CitationStyle>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// "Step n / N", kept up to date as the slide is stepped through.
    #[serde(rename_all = "camelCase")]
    pub struct StepLabelEl {
        #[serde(flatten)]
        pub base: Base,
        /// `{n}` and `{total}` are replaced; the deck's own wording when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub format: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The size of the window a page is laid out for, in CSS pixels: what the page sees as the size of the screen.
    #[serde(rename_all = "camelCase")]
    pub struct Viewport {
        pub w: f64,
        pub h: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// How an embedded page meets its box when it has no zoom of its own.
    #[serde(rename_all = "camelCase")]
    pub enum EmbedFit {
        /// The page's width fills the box; the rest of the page is scrolled to (the default).
        Width,
        /// The whole window is seen, with bars at the sides or the top where the box has another shape.
        Page,
        /// The window covers the box, and what does not fit is cut off at the right and the bottom.
        Fill,
    }

    /// A live web page or local app, shown in present mode; a picture and a link elsewhere. A page of the
    /// host (a Kasten page) is an embed too: its address is empty and `source` names the page.
    #[serde(rename_all = "camelCase")]
    pub struct EmbedEl {
        #[serde(flatten)]
        pub base: Base,
        /// A web address; empty for a page of the host, which `source` names.
        #[serde(default)]
        pub url: String,
        /// An image in the host's image store, shown where the page cannot be: the page's snapshot.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub poster: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        /// The window the page is laid out for, scaled to the box so the page keeps its own layout. Desktop (1280 by 800) when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub design: Option<Viewport>,
        /// A fixed zoom from 0.25 to 3 (1 is 100%): the page is laid out as a window of the box divided by it. The page fits the box when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub zoom: Option<f64>,
        /// How the page meets the box when there is no zoom; `width` when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub fit: Option<EmbedFit>,
        /// Show the readable text of the page instead of the page itself, where the host can make it.
        #[serde(default, skip_serializing_if = "is_false")]
        pub reader: bool,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub enum ChartKind {
        /// Vertical bars, grouped by category.
        Bar,
        /// A line through the points of each series.
        Line,
        /// The first series as slices of a circle.
        Pie,
    }

    /// One row of a chart's table: a name and a number for each category.
    #[serde(rename_all = "camelCase")]
    pub struct ChartSeries {
        pub name: String,
        pub values: Vec<f64>,
        /// A theme colour or #rrggbb; the theme's accent colours in turn when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A bar, line or pie chart of a small table of numbers, drawn from shapes, lines and text.
    #[serde(rename_all = "camelCase")]
    pub struct ChartEl {
        #[serde(flatten)]
        pub base: Base,
        pub kind: ChartKind,
        /// What the chart is about, set above it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        /// The name of each bar group, point on the line or slice.
        #[serde(default)]
        pub categories: Vec<String>,
        pub series: Vec<ChartSeries>,
        /// The number written on each bar, point and slice.
        #[serde(default, skip_serializing_if = "is_false")]
        pub labels: bool,
        /// Whether the legend is drawn; it is for more than one series, and for a pie, when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub legend: Option<bool>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A countdown that runs in present mode.
    #[serde(rename_all = "camelCase")]
    pub struct TimerEl {
        #[serde(flatten)]
        pub base: Base,
        /// How long it counts down from.
        pub seconds: u32,
        /// Words set with the time.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub label: Option<String>,
        /// Starts by itself when the slide shows; otherwise a click starts it.
        #[serde(default, skip_serializing_if = "is_false")]
        pub autostart: bool,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A QR code of a text or a web address, drawn from squares so it stays sharp at any size.
    #[serde(rename_all = "camelCase")]
    pub struct QrEl {
        #[serde(flatten)]
        pub base: Base,
        /// What the code holds: a web address, or any words (up to about 200 characters).
        pub data: String,
        /// Words set under the code.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub caption: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A video file the host holds, with a still to show until it plays.
    #[serde(rename_all = "camelCase")]
    pub struct VideoEl {
        #[serde(flatten)]
        pub base: Base,
        /// A file in the host's store.
        pub src: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub poster: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        pub autoplay: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        pub looped: bool,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}
