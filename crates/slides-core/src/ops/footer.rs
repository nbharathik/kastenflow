//! The footer words and the date of the slides, with the slide number beside them.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::util::slide_mut;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{DateSpec, Deck, HeaderFooter, LONGEST_DATE, LONGEST_FOOTER, Slide, is_false};

op_types! {
    /// Sets the footer words, the date, the title-slide rule and the slide number.
    pub struct SetHeaderFooter {
        /// The slides that get a footer and date of their own. Left out, the settings are the deck's, for every slide that has none of its own.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub slides: Option<Vec<String>>,
        /// The footer words. An empty text takes them away (on a slide it hides the deck's).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub footer: Option<String>,
        /// The date: `text` for one written by hand, or a `format` for today's date.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub date: Option<DateSpec>,
        /// Takes the date away.
        #[serde(default, skip_serializing_if = "is_false")]
        pub no_date: bool,
        /// The deck's footer and date are left off the title slide. Deck settings only.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub hide_on_title: Option<bool>,
        /// On the named slides: show no footer and date at all.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub hidden: Option<bool>,
        /// Shows or hides the slide number, which is the deck's choice (`set_present` sets the same).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub slide_numbers: Option<bool>,
        /// On the named slides: forget their own footer and date, so the deck's show again.
        #[serde(default, skip_serializing_if = "is_false")]
        pub reset: bool,
    }
}

impl Op for SetHeaderFooter {
    type Output = ();
    const NAME: &'static str = "set_header_footer";
    const ABOUT: &'static str = "Set the footer words and the date at the bottom of the slides. Without `slides` the settings are the deck's and every slide's own footer is forgotten when `footer` or the date is given (\"apply to all\"); with `slides` only those slides get footer, date or `hidden`, and `reset` takes their own settings away. `footer` is words (empty takes them away); `date` is {text} for a date written by hand or {format} (yyyy, MMMM, MMM, MM, dd, d, EEEE) for today's date; `noDate` takes it away; `hideOnTitle` leaves them off `title` layout slides; `slideNumbers` shows or hides the theme's number.";

    fn scope(&self, deck: &Deck) -> Scope {
        match &self.slides {
            Some(ids) => Scope::slides(ids),
            None if self.clears_slides() && deck.slides.iter().any(|s| s.footer.is_some()) => {
                Scope {
                    every_slide: true,
                    ..Scope::default().with_meta()
                }
            }
            None => Scope::default().with_meta(),
        }
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        self.check()?;
        let change = Change::of(&self);
        match &self.slides {
            Some(ids) => {
                if self.hide_on_title.is_some() {
                    return Err(Error::bad_input(
                        Self::NAME,
                        "`hideOnTitle` is a setting of the deck: leave `slides` out",
                    ));
                }
                for id in ids {
                    let slide = slide_mut(cx.deck, id)?;
                    slide_change(slide, &change, self.reset, self.hidden);
                }
            }
            None => {
                let clears = self.clears_slides();
                let mut own = cx.deck.present.header_footer.take().unwrap_or_default();
                change.apply(&mut own, true);
                if let Some(on) = self.hide_on_title {
                    own.hide_on_title = on;
                }
                cx.deck.present.header_footer = (!own.is_blank()).then_some(own);
                if clears {
                    for slide in &mut cx.deck.slides {
                        slide.footer = None;
                    }
                }
            }
        }
        if let Some(on) = self.slide_numbers {
            cx.deck.present.slide_numbers = on;
        }
        Ok(())
    }
}

impl SetHeaderFooter {
    /// Whether it sets words or a date for the whole deck, which clears what slides set for themselves.
    fn clears_slides(&self) -> bool {
        self.footer.is_some() || self.date.is_some() || self.no_date
    }

    fn check(&self) -> Result<()> {
        let long = |what: &str, most: usize| {
            Error::bad_input(Self::NAME, format!("{what} is at most {most} characters"))
        };
        if self
            .footer
            .as_ref()
            .is_some_and(|f| f.chars().count() > LONGEST_FOOTER)
        {
            return Err(long("the footer", LONGEST_FOOTER));
        }
        if let Some(date) = &self.date {
            for text in [&date.text, &date.format].into_iter().flatten() {
                if text.chars().count() > LONGEST_DATE {
                    return Err(long("the date", LONGEST_DATE));
                }
            }
            if date.text.is_some() && date.format.is_some() {
                return Err(Error::bad_input(
                    Self::NAME,
                    "give the date `text` or a `format`, not both",
                ));
            }
        }
        if self.date.is_some() && self.no_date {
            return Err(Error::bad_input(
                Self::NAME,
                "give a `date` or `noDate`, not both",
            ));
        }
        Ok(())
    }
}

/// The words and date a call sets.
struct Change {
    footer: Option<String>,
    date: Option<DateSpec>,
    no_date: bool,
}

impl Change {
    fn of(op: &SetHeaderFooter) -> Change {
        Change {
            footer: op.footer.clone(),
            date: op.date.clone(),
            no_date: op.no_date,
        }
    }

    /// Writes it into `own`. The deck drops an empty footer; a slide keeps it, as a way to say "none here".
    fn apply(&self, own: &mut HeaderFooter, deck: bool) {
        if let Some(footer) = &self.footer {
            own.footer = (!deck || !footer.is_empty()).then(|| footer.clone());
        }
        if let Some(date) = &self.date {
            own.date = Some(date.clone());
        }
        if self.no_date {
            own.date = None;
        }
    }
}

fn slide_change(slide: &mut Slide, change: &Change, reset: bool, hidden: Option<bool>) {
    if reset {
        slide.footer = None;
    }
    let mut own = slide.footer.take().unwrap_or_default();
    change.apply(&mut own, false);
    if let Some(hidden) = hidden {
        own.hidden = hidden;
    }
    slide.footer = (!own.is_blank()).then_some(own);
}
