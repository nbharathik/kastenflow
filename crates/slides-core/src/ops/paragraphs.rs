//! Operations on the paragraphs of a text, without rewriting the words: the look of
//! a list, where its numbers count from, spacing and indents.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::elements::check_paragraph;
use super::util::{element_mut, slide_mut};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Align, Element, ListKind, ListStyle, Paragraph, Text};

op_types! {
    /// What to set on a paragraph. Fields that are left out are not changed.
    #[derive(Default)]
    #[serde(default)]
    pub struct ParagraphLook {
        /// Makes the paragraph an item of a bullet list or a numbered one.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub list: Option<ListKind>,
        /// How the marker looks: `disc`, `circle`, `square`, `arrow`, `check` or `dash` for bullets; `decimal`, `decimalParen`, `lowerAlpha`, `upperAlpha`, `lowerRoman` or `upperRoman` for numbers.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub list_style: Option<ListStyle>,
        /// Indent level of a list item, 0 to 8.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub level: Option<u8>,
        /// A numbered item begins counting at this number, which restarts a list or goes on with one that something else interrupted.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub start: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub align: Option<Align>,
        /// A multiple of the line height, such as 1.15.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub line_spacing: Option<f64>,
        /// Points.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub space_before: Option<f64>,
        /// Points.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub space_after: Option<f64>,
        /// Where the lines after the first start, in slide units from the box's inset.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub margin_left: Option<f64>,
        /// Where the first line starts from there; negative hangs it out to the left.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub indent: Option<f64>,
        /// The marker's colour, a theme token or `#rrggbb`.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub bullet_color: Option<String>,
        /// The marker's size as a multiple of the words' size, 0.25 to 4 (25% to 400%).
        #[serde(skip_serializing_if = "Option::is_none")]
        pub bullet_size: Option<f64>,
    }

    /// A setting of a paragraph that can be taken away, so that its list, style or text style decides again.
    pub enum ParagraphField {
        List,
        ListStyle,
        Level,
        Start,
        Align,
        LineSpacing,
        SpaceBefore,
        SpaceAfter,
        MarginLeft,
        Indent,
        BulletColor,
        BulletSize,
    }

    pub struct FormatParagraphs {
        pub slide: String,
        pub id: String,
        /// Which paragraphs, counting from 0; every paragraph of the element when left out.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub paragraphs: Option<Vec<usize>>,
        /// What to set.
        #[serde(default)]
        pub set: ParagraphLook,
        /// What to take away, after `set` is done.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub clear: Vec<ParagraphField>,
    }
}

/// The text an element holds, to change.
fn text_mut(e: &mut Element) -> Option<&mut Text> {
    match e {
        Element::Text(t) => Some(&mut t.text),
        Element::Shape(s) => s.text.as_mut(),
        Element::Connector(c) => c.label.as_mut(),
        _ => None,
    }
}

fn apply(p: &mut Paragraph, set: &ParagraphLook, clear: &[ParagraphField]) {
    if let Some(v) = &set.list {
        p.list = Some(v.clone());
    }
    if let Some(v) = &set.list_style {
        p.list_style = Some(v.clone());
    }
    if let Some(v) = set.level {
        p.level = (v > 0).then_some(v);
    }
    if let Some(v) = set.start {
        p.start = Some(v);
    }
    if let Some(v) = &set.align {
        p.align = Some(v.clone());
    }
    p.line_spacing = set.line_spacing.or(p.line_spacing);
    p.space_before = set.space_before.or(p.space_before);
    p.space_after = set.space_after.or(p.space_after);
    p.margin_left = set.margin_left.or(p.margin_left);
    p.indent = set.indent.or(p.indent);
    if let Some(v) = &set.bullet_color {
        p.bullet_color = Some(v.clone());
    }
    p.bullet_size = set.bullet_size.or(p.bullet_size);
    for field in clear {
        match field {
            // Taking the list away takes its marker's look and its counting with it.
            ParagraphField::List => {
                p.list = None;
                p.list_style = None;
                p.start = None;
                p.bullet_color = None;
                p.bullet_size = None;
            }
            ParagraphField::ListStyle => p.list_style = None,
            ParagraphField::Level => p.level = None,
            ParagraphField::Start => p.start = None,
            ParagraphField::Align => p.align = None,
            ParagraphField::LineSpacing => p.line_spacing = None,
            ParagraphField::SpaceBefore => p.space_before = None,
            ParagraphField::SpaceAfter => p.space_after = None,
            ParagraphField::MarginLeft => p.margin_left = None,
            ParagraphField::Indent => p.indent = None,
            ParagraphField::BulletColor => p.bullet_color = None,
            ParagraphField::BulletSize => p.bullet_size = None,
        }
    }
}

impl Op for FormatParagraphs {
    type Output = ();
    const NAME: &'static str = "format_paragraphs";
    const ABOUT: &'static str = "Change how paragraphs of a text box or shape are set without rewriting the words: make them a bullet or numbered list and choose its look (listStyle), indent them (level, marginLeft, indent), restart or continue the numbering (start), align them, and set the line and paragraph spacing. Paragraphs are counted from 0; leave `paragraphs` out for all of them. `clear` takes settings away.";

    fn scope(&self, _: &crate::model::Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let slide = slide_mut(cx.deck, &self.slide)?;
        let element = element_mut(slide, &self.id)?;
        let kind = element.kind();
        let text = text_mut(element).ok_or_else(|| {
            Error::refused(format!("A {kind} element has no paragraphs to format."))
        })?;
        let count = text.paragraphs.len();
        let which: Vec<usize> = match &self.paragraphs {
            Some(list) => list.clone(),
            None => (0..count).collect(),
        };
        if let Some(bad) = which.iter().find(|i| **i >= count) {
            return Err(Error::bad_input(
                Self::NAME,
                format!("paragraph {bad} does not exist; the text has {count}, counted from 0"),
            ));
        }
        if self.set.level.is_some_and(|l| l > 8) {
            return Err(Error::bad_input(Self::NAME, "`level` is 0 to 8"));
        }
        for &i in &which {
            if let Some(p) = text.paragraphs.get_mut(i) {
                apply(p, &self.set, &self.clear);
                check_paragraph(p).map_err(|m| Error::bad_input(Self::NAME, m))?;
            }
        }
        Ok(())
    }
}
