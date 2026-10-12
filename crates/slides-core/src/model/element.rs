//! The things on a slide. Seven kinds of element are drawn directly and map
//! onto PPTX objects one for one; `raw` holds what an import could not
//! understand. The composite kinds (code, math, chat and the rest, in
//! `composite.rs`) are built from these by `crate::composites`.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    CardGridEl, ChartEl, ChatEl, CitationEl, CodeEl, EmbedEl, Extra, Fill, MathEl, PageSource,
    QrEl, StepLabelEl, StepState, Style, Text, TimerEl, TokenProbsEl, VideoEl, is_false,
};

model! {
    /// What every element has.
    #[serde(rename_all = "camelCase")]
    pub struct Base {
        /// Unique on its slide. Two slides may share an id on purpose: that is how Morph pairs elements. Left out when adding an element, it is assigned.
        #[serde(default)]
        pub id: String,
        /// Left edge in slide units. Absent when a placeholder supplies the box.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub x: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub y: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub w: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub h: Option<f64>,
        /// Degrees clockwise, around the centre.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub rotation: Option<f64>,
        #[serde(default, skip_serializing_if = "is_false")]
        pub flip_h: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        pub flip_v: bool,
        /// The layout slot this element fills: `title`, `body`, `image`, ...
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub placeholder: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub style: Option<Style>,
        /// The state from each step onward.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty", deserialize_with = "super::steps::step_keys")]
        pub step_states: BTreeMap<u32, StepState>,
        /// The layer's name in the Steps panel and the selection list.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub name: Option<String>,
        /// What a person who cannot see the element is told.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub alt: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        pub locked: bool,
        /// A web address, `slide:<id>`, or `page:<path>` (then `#` and a heading) for a page of the host.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub link: Option<String>,
        /// Pairs this element with one of another id in a Morph.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub morph_id: Option<String>,
        /// The page of the host this element was made from, or points at: what "Update from page" reads again.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub source: Option<PageSource>,
    }

    #[serde(rename_all = "camelCase")]
    pub enum Route {
        Straight,
        Elbow,
        Curved,
    }

    #[serde(rename_all = "camelCase")]
    pub enum Side {
        Left,
        Right,
        Top,
        Bottom,
    }

    /// One end of a connector: a side of another element.
    #[serde(rename_all = "camelCase")]
    pub struct Anchor {
        pub el: String,
        pub side: Side,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The part of an image that shows, as fractions cut from each edge.
    #[serde(rename_all = "camelCase")]
    pub struct Crop {
        pub left: f64,
        pub top: f64,
        pub right: f64,
        pub bottom: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub enum Mask {
        Rect,
        RoundRect,
        Ellipse,
    }

    #[serde(rename_all = "camelCase")]
    pub struct TextEl {
        #[serde(flatten)]
        pub base: Base,
        pub text: Text,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A preset shape, with text inside if it has any.
    #[serde(rename_all = "camelCase")]
    pub struct ShapeEl {
        #[serde(flatten)]
        pub base: Base,
        /// A PPTX preset name: `rect`, `roundRect`, `ellipse`, `triangle`, `rtTriangle`, `diamond`, `chevron`, `rightArrow`, ...
        pub shape: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub text: Option<Text>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A free line or arrow. It runs from the box's top left to its bottom
    /// right, turned by the flips.
    #[serde(rename_all = "camelCase")]
    pub struct LineEl {
        #[serde(flatten)]
        pub base: Base,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub route: Option<Route>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A line attached to two elements. Its box always follows them.
    #[serde(rename_all = "camelCase")]
    pub struct ConnectorEl {
        #[serde(flatten)]
        pub base: Base,
        pub route: Route,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub from: Option<Anchor>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub to: Option<Anchor>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub label: Option<Text>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct ImageEl {
        #[serde(flatten)]
        pub base: Base,
        /// A file in the host's image store: a vault path such as `assets/figure.png`.
        pub src: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub crop: Option<Crop>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub mask: Option<Mask>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// Elements that move and scale together. Children keep slide coordinates.
    #[serde(rename_all = "camelCase")]
    pub struct GroupEl {
        #[serde(flatten)]
        pub base: Base,
        pub children: Vec<Element>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct TableCell {
        pub text: Text,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub fill: Option<Fill>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub col_span: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub row_span: Option<u32>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct TableRow {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub height: Option<f64>,
        pub cells: Vec<TableCell>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct TableEl {
        #[serde(flatten)]
        pub base: Base,
        /// Column widths in slide units.
        pub columns: Vec<f64>,
        pub rows: Vec<TableRow>,
        #[serde(default, skip_serializing_if = "is_false")]
        pub header_row: bool,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// What an import could not turn into anything above. It keeps the
    /// original XML so an export can write it back, and a picture to show.
    #[serde(rename_all = "camelCase")]
    pub struct RawEl {
        #[serde(flatten)]
        pub base: Base,
        /// Where it came from, such as `pptx:chart`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub original: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub xml: Option<String>,
        /// An image of it, in the host's image store.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub preview: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// One thing on a slide.
    #[serde(tag = "type", rename_all = "kebab-case")]
    pub enum Element {
        Text(TextEl),
        Shape(ShapeEl),
        Line(LineEl),
        Connector(ConnectorEl),
        Image(ImageEl),
        Group(GroupEl),
        Table(TableEl),
        Raw(RawEl),
        Code(CodeEl),
        Math(MathEl),
        Chat(ChatEl),
        TokenProbs(TokenProbsEl),
        CardGrid(CardGridEl),
        Citation(CitationEl),
        StepLabel(StepLabelEl),
        Embed(EmbedEl),
        Video(VideoEl),
        Chart(ChartEl),
        Timer(TimerEl),
        Qr(QrEl),
    }
}

impl Base {
    pub fn new(id: impl Into<String>) -> Base {
        Base {
            id: id.into(),
            x: None,
            y: None,
            w: None,
            h: None,
            rotation: None,
            flip_h: false,
            flip_v: false,
            placeholder: None,
            style: None,
            step_states: BTreeMap::new(),
            name: None,
            alt: None,
            locked: false,
            link: None,
            morph_id: None,
            source: None,
        }
    }

    /// The box, when the element has its own.
    pub fn rect(&self) -> Option<(f64, f64, f64, f64)> {
        Some((self.x?, self.y?, self.w?, self.h?))
    }

    pub fn place(mut self, x: f64, y: f64, w: f64, h: f64) -> Base {
        self.x = Some(x);
        self.y = Some(y);
        self.w = Some(w);
        self.h = Some(h);
        self
    }
}
