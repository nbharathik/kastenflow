//! The footer words and the date that slides carry beside their number. The deck holds one set that
//! every slide shows; a slide may hold its own, which wins over the deck's. The slide number is not
//! here: it is the deck's `present.slideNumbers`, so there is one place to turn numbers on or off.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Extra, is_false};

/// The layout whose slides count as the title slide for "hide on the title slide".
pub const TITLE_LAYOUT: &str = "title";
/// How today's date is written when the format is not chosen.
pub const DEFAULT_DATE_FORMAT: &str = "d MMMM yyyy";
/// The longest footer, fixed date and date format, in characters.
pub const LONGEST_FOOTER: usize = 200;
pub const LONGEST_DATE: usize = 80;

model! {
    /// The date a slide shows: words that are written as given, or today's date in a format.
    #[serde(rename_all = "camelCase")]
    pub struct DateSpec {
        /// A date written by hand, shown as it is. When absent the date is today's, and changes every day.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub text: Option<String>,
        /// How today's date is written: `yyyy`, `yy`, `MMMM`, `MMM`, `MM`, `M`, `dd`, `d`, `EEEE` and `EEE` stand for the parts, other characters are kept. `d MMMM yyyy` when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub format: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// What the bottom of a slide says, besides its number.
    #[derive(Default)]
    #[serde(rename_all = "camelCase")]
    pub struct HeaderFooter {
        /// The footer words.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub footer: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub date: Option<DateSpec>,
        /// The deck's footer and date are left off the title slide (a slide whose layout is `title`). A slide with its own footer or date still shows them.
        #[serde(default, skip_serializing_if = "is_false")]
        pub hide_on_title: bool,
        /// On a slide: show no footer and no date here, whatever the deck says.
        #[serde(default, skip_serializing_if = "is_false")]
        pub hidden: bool,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl HeaderFooter {
    /// Whether it says nothing and changes nothing.
    pub fn is_blank(&self) -> bool {
        self.footer.is_none() && self.date.is_none() && !self.hide_on_title && !self.hidden
    }

    /// What a slide of `layout` shows: the slide's own footer and date over the deck's, nothing
    /// when the slide hides them or is the title slide of a deck that leaves them off it. The
    /// result has no `hide_on_title` and no `hidden`.
    pub fn shown(
        deck: Option<&HeaderFooter>,
        slide: Option<&HeaderFooter>,
        layout: &str,
    ) -> HeaderFooter {
        let mut out = HeaderFooter::default();
        if slide.is_some_and(|s| s.hidden) {
            return out;
        }
        let own_footer = slide.and_then(|s| s.footer.clone());
        let own_date = slide.and_then(|s| s.date.clone());
        let own = own_footer.is_some() || own_date.is_some();
        let on_title = deck.is_some_and(|d| d.hide_on_title) && layout == TITLE_LAYOUT && !own;
        if !on_title {
            out.footer = own_footer.or_else(|| deck.and_then(|d| d.footer.clone()));
            out.date = own_date.or_else(|| deck.and_then(|d| d.date.clone()));
        }
        out.footer = out.footer.filter(|f| !f.is_empty());
        out
    }
}

/// The id of the text box that holds a slide's footer words.
pub const FOOTER_ID: &str = "footer-text";
/// The id of the text box that holds its date.
pub const DATE_ID: &str = "footer-date";
/// The `field` of a run that stands for today's date; its `t` is the format (or a sample).
pub const DATE_FIELD: &str = "date";

/// The footer and the date of a slide as text boxes along its bottom edge, ready to be drawn or
/// written: the date at the left, the footer in the middle. The slide number is the theme's, so it
/// is not here. A date that is today's is a run whose `field` is `date` and whose `t` is the format.
pub fn footer_elements(deck: &super::Deck, slide: &super::Slide) -> Vec<super::Element> {
    use super::{Align, Base, Element, Paragraph, Run, Text, TextEl};

    let shown = HeaderFooter::shown(
        deck.present.header_footer.as_ref(),
        slide.footer.as_ref(),
        &slide.layout,
    );
    let (w, h) = (deck.size.w, deck.size.h);
    let (top, height) = (h - h * 0.08, h * 0.05);
    let mut out = Vec::new();
    let mut put = |id: &str, x: f64, width: f64, align: Align, run: Run| {
        let paragraph = Paragraph {
            runs: vec![run],
            align: Some(align),
            style: Some("caption".to_owned()),
            ..Paragraph::plain("")
        };
        let mut base = Base::new(id).place(x, top, width, height);
        base.locked = true;
        out.push(Element::Text(TextEl {
            base,
            text: Text::from_paragraphs(vec![paragraph]),
            columns: None,
            column_gap: None,
            extra: Extra::new(),
        }));
    };
    if let Some(date) = &shown.date {
        let run = match &date.text {
            Some(text) => Run::plain(text.clone()),
            None => Run {
                field: Some(DATE_FIELD.to_owned()),
                ..Run::plain(
                    date.format
                        .clone()
                        .unwrap_or_else(|| DEFAULT_DATE_FORMAT.to_owned()),
                )
            },
        };
        put(DATE_ID, w * 0.05, w * 0.22, Align::Left, run);
    }
    if let Some(footer) = &shown.footer {
        put(
            FOOTER_ID,
            w * 0.3,
            w * 0.4,
            Align::Center,
            Run::plain(footer.clone()),
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::Element;
    use super::*;

    fn words(footer: &str) -> HeaderFooter {
        HeaderFooter {
            footer: Some(footer.to_owned()),
            ..HeaderFooter::default()
        }
    }

    #[test]
    fn a_slide_shows_the_decks_footer_unless_it_has_its_own_or_hides_it() {
        let deck = words("Deck");
        let shown = |slide: Option<&HeaderFooter>| {
            HeaderFooter::shown(Some(&deck), slide, "title-body").footer
        };
        assert_eq!(shown(None).as_deref(), Some("Deck"));
        assert_eq!(shown(Some(&words("Mine"))).as_deref(), Some("Mine"));
        let hidden = HeaderFooter {
            hidden: true,
            ..HeaderFooter::default()
        };
        assert_eq!(shown(Some(&hidden)), None);
    }

    #[test]
    fn the_title_slide_can_be_left_out_but_a_footer_of_its_own_still_shows() {
        let deck = HeaderFooter {
            hide_on_title: true,
            ..words("Deck")
        };
        assert_eq!(HeaderFooter::shown(Some(&deck), None, "title").footer, None);
        assert_eq!(
            HeaderFooter::shown(Some(&deck), None, "section")
                .footer
                .as_deref(),
            Some("Deck")
        );
        let own = words("Cover");
        assert_eq!(
            HeaderFooter::shown(Some(&deck), Some(&own), "title")
                .footer
                .as_deref(),
            Some("Cover")
        );
    }

    #[test]
    fn the_footer_and_the_date_are_boxes_along_the_bottom() {
        let mut engine = crate::ops::Engine::create("T", "Light", 1).unwrap();
        let slide = engine.deck().slides[0].clone();
        assert!(footer_elements(engine.deck(), &slide).is_empty());
        engine
            .apply(
                "set_header_footer",
                serde_json::json!({ "footer": "Review", "date": { "format": "yyyy" } }),
            )
            .unwrap();
        let boxes = footer_elements(engine.deck(), &slide);
        let ids: Vec<&str> = boxes.iter().map(|e| e.id()).collect();
        assert_eq!(ids, [DATE_ID, FOOTER_ID]);
        let height = engine.deck().size.h;
        for b in &boxes {
            let (_, y, _, h) = b.base().rect().unwrap();
            assert!(
                y > height * 0.85 && y + h <= height,
                "along the bottom edge"
            );
        }
        // A date of today's is a field whose sample is its format; one written by hand is words.
        let Element::Text(date) = &boxes[0] else {
            panic!("text")
        };
        let run = &date.text.paragraphs[0].runs[0];
        assert_eq!(
            (run.field.as_deref(), run.t.as_str()),
            (Some(DATE_FIELD), "yyyy")
        );
    }

    #[test]
    fn an_empty_footer_shows_nothing() {
        assert_eq!(
            HeaderFooter::shown(Some(&words("")), None, "x").footer,
            None
        );
    }
}
