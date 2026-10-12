//! What every writer of a part is given: the deck, the pictures and warnings
//! of the whole export, and the relationships and shape numbers of the part
//! being written.

use std::collections::HashMap;

use slides_core::{Deck, Element};

use crate::backing::{Backings, Behind};
use crate::color::Color;
use crate::kept::Kept;
use crate::media::{Images, Media, Picture};
use crate::rels::{self, Rels};

/// Something an export could not do exactly, and what it did instead.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Warning {
    /// The slide it concerns, by id.
    pub slide: Option<String>,
    /// The element it concerns, by id.
    pub element: Option<String>,
    pub message: String,
}

/// Shared by every part of one export.
pub struct Shared<'m> {
    pub media: &'m dyn Media,
    pub images: Images,
    pub warnings: Vec<Warning>,
    /// The part each slide is written to, by slide id, for links between slides.
    pub slide_parts: HashMap<String, String>,
    /// The parts that `raw` elements from an import keep, to be added to the package.
    pub kept: Kept,
}

impl<'m> Shared<'m> {
    pub fn new(media: &'m dyn Media) -> Shared<'m> {
        Shared {
            media,
            images: Images::new(),
            warnings: Vec::new(),
            slide_parts: HashMap::new(),
            kept: Kept::default(),
        }
    }
}

/// The numbers `p:cNvPr` gives to the shapes of one part. Number 1 is the
/// shape tree itself, so shapes start at 2. Elements are numbered in the order
/// they are drawn, before any is written, so a connector can name a shape that
/// comes after it.
pub struct Ids {
    of_element: HashMap<String, u32>,
    next: u32,
}

impl Ids {
    pub fn new() -> Ids {
        Ids {
            of_element: HashMap::new(),
            next: 2,
        }
    }

    /// Numbers the elements and, inside each group, its children after it.
    pub fn assign(&mut self, elements: &[Element]) {
        for element in elements {
            let id = self.fresh();
            self.of_element.insert(element.id().to_owned(), id);
            self.assign(element.children());
        }
    }

    pub fn of(&self, element: &str) -> Option<u32> {
        self.of_element.get(element).copied()
    }

    /// A number for a shape the deck has no element for, such as a connector's label.
    pub fn fresh(&mut self) -> u32 {
        let id = self.next;
        self.next += 1;
        id
    }
}

/// How the writers of one part reach the rest of the export.
pub struct Cx<'a, 'm> {
    pub deck: &'a Deck,
    pub shared: &'a mut Shared<'m>,
    pub rels: Rels,
    pub ids: Ids,
    /// The slide being written, by id, for warnings.
    pub slide: Option<String>,
    /// The element being written, by id, for warnings.
    pub element: Option<String>,
    /// The layout the slide uses; empty for the master, where nothing fills a placeholder.
    pub layout: String,
    /// Whether the part is the master (or a layout), which has no slide number of its own.
    pub master: bool,
    /// The slide's place in the file, from 1: what a slide-number field shows.
    pub number: u32,
    /// The step being drawn; None draws every element as it is styled.
    pub step: Option<u32>,
    /// How much of its colour the element being written keeps after the steps around it
    /// dim it: 1 for one that is not dimmed, the theme's dimmed opacity for one that is (and
    /// what a dimmed group holds is dimmed twice over if it is dimmed itself). A file has no
    /// opacity for an element, so its text is mixed toward what lies behind it by this much.
    pub dim: f64,
    /// The shapes already drawn on the slide, which what comes after may lie over.
    pub backing: Backings,
    /// What lies behind the outermost element that dims the one being written: what its
    /// words are mixed toward.
    pub under: Behind,
    /// What lies behind the words of the element being written: what words that are not
    /// there yet take the colour of.
    pub backdrop: Behind,
    fields: u32,
}

impl<'a, 'm> Cx<'a, 'm> {
    pub fn new(deck: &'a Deck, shared: &'a mut Shared<'m>) -> Cx<'a, 'm> {
        Cx {
            deck,
            shared,
            rels: Rels::new(),
            ids: Ids::new(),
            slide: None,
            element: None,
            layout: String::new(),
            master: false,
            number: 1,
            step: None,
            dim: 1.0,
            backing: Backings::default(),
            under: Behind::Page,
            backdrop: Behind::Page,
            fields: 0,
        }
    }

    /// The picture a deck names by `path`, kept once however often it is used.
    pub fn picture(&mut self, path: &str) -> Result<Picture, String> {
        let Shared { media, images, .. } = &mut *self.shared;
        images.load(*media, path)
    }

    /// Records something the export could not do exactly.
    pub fn warn(&mut self, message: impl Into<String>) {
        self.shared.warnings.push(Warning {
            slide: self.slide.clone(),
            element: self.element.clone(),
            message: message.into(),
        });
    }

    /// A colour value of the deck. One that is neither a token nor hex is
    /// drawn in the text colour, as the editor does, and reported.
    pub fn color(&mut self, value: &str) -> Color {
        Color::parse(value).unwrap_or_else(|| {
            self.warn(format!(
                "`{value}` is not a colour; it is drawn in the theme's text colour"
            ));
            Color::Scheme("tx1")
        })
    }

    /// The colour behind everything on the slide, as `#rrggbb`: the slide's own background
    /// colour, its layout's, or the theme's. None when that is not a colour the deck can resolve.
    pub fn ground(&self) -> Option<String> {
        let own = self
            .slide
            .as_deref()
            .and_then(|id| self.deck.slide(id))
            .and_then(|slide| slides_core::resolve::background_of(&self.deck.theme, slide))
            .and_then(|background| background.color.as_deref());
        self.deck.theme.resolve_color(own.unwrap_or("bg1"))
    }

    /// The colour `behind` shows as, `#rrggbb`; None for one with no colour to mix words with.
    pub fn shown(&self, behind: &Behind) -> Option<String> {
        match behind {
            Behind::Page => self.ground(),
            Behind::Color(hex) => Some(hex.clone()),
            Behind::Unknown => None,
        }
    }

    /// What the step label says on the page being written: the deck's words with the step and
    /// the slide's steps put in. None when the slide has no steps, or no step is being drawn.
    pub fn step_label(&self) -> Option<String> {
        let step = self.step?;
        let slide = self.deck.slide(self.slide.as_deref()?)?;
        (slide.steps > 0).then(|| {
            self.deck
                .present
                .step_label
                .replace("{n}", &step.to_string())
                .replace("{total}", &slide.steps.to_string())
        })
    }

    /// A fresh id for a slide-number field, which PPTX wants as a GUID.
    pub fn field_id(&mut self) -> String {
        self.fields += 1;
        guid(0x464c_4400 + self.number, self.fields)
    }

    /// The relationship id of an address a run or element links to; None for one that is not safe to write.
    pub fn link(&mut self, address: &str) -> Option<Link> {
        let address = address.trim();
        if let Some(slide) = address.strip_prefix("slide:") {
            let Some(target) = self.shared.slide_parts.get(slide).cloned() else {
                self.warn(format!(
                    "the link to slide `{slide}` was left out: that slide is not in the file"
                ));
                return None;
            };
            return Some(Link::Slide(self.rels.add(rels::SLIDE, &target)));
        }
        // A page of the place the deck is edited in: only that place can open it.
        if address
            .get(..5)
            .is_some_and(|s| s.eq_ignore_ascii_case("page:"))
        {
            self.warn("a link to a page of KastenFlow was left out: PowerPoint cannot open it");
            return None;
        }
        let scheme = address.split_once(':').map(|(s, _)| s.to_ascii_lowercase());
        let safe = match scheme.as_deref() {
            Some(s) => matches!(s, "http" | "https" | "mailto" | "tel" | "ftp"),
            None => !address.is_empty() && !address.contains(char::is_whitespace),
        };
        if !safe {
            self.warn(format!(
                "the link `{address}` was left out: only web, mail and phone addresses are kept"
            ));
            return None;
        }
        let full = if scheme.is_some() {
            address.to_owned()
        } else {
            format!("https://{address}")
        };
        Some(Link::Web(
            self.rels.add_external(rels::HYPERLINK, &rels::uri(&full)),
        ))
    }
}

/// A link inside a part, as a relationship id.
#[derive(Clone, Debug, PartialEq)]
pub enum Link {
    Web(String),
    Slide(String),
}

/// A GUID made of two numbers: the same every time, and unique per pair.
pub fn guid(a: u32, b: u32) -> String {
    format!("{{{a:08X}-0000-4000-8000-{b:012X}}}")
}

#[cfg(test)]
mod tests {
    use slides_core::{Base, Extra, GroupEl, Text};

    use super::*;
    use crate::testing::with_cx;

    fn text(id: &str) -> Element {
        Element::text_el(Base::new(id), Text::plain("t"))
    }

    #[test]
    fn shapes_are_numbered_from_two_in_drawing_order_with_a_groups_children_after_it() {
        let group = Element::Group(GroupEl {
            base: Base::new("g"),
            children: vec![text("a"), text("b")],
            extra: Extra::new(),
        });
        let mut ids = Ids::new();
        ids.assign(&[text("first"), group, text("last")]);
        let numbers: Vec<_> = ["first", "g", "a", "b", "last"]
            .iter()
            .map(|id| ids.of(id))
            .collect();
        assert_eq!(numbers, [Some(2), Some(3), Some(4), Some(5), Some(6)]);
        assert_eq!(ids.of("missing"), None);
        assert_eq!(
            ids.fresh(),
            7,
            "a shape without an element comes after them"
        );
    }

    #[test]
    fn a_warning_says_which_slide_and_element_it_is_about() {
        let warning = with_cx(|cx| {
            cx.element = Some("e-9".into());
            cx.warn("something");
            cx.shared.warnings[0].clone()
        });
        assert_eq!(
            warning,
            Warning {
                slide: Some("s-test".into()),
                element: Some("e-9".into()),
                message: "something".into()
            }
        );
    }

    #[test]
    fn a_colour_that_is_not_one_is_the_text_colour_and_reported() {
        let (color, warned) = with_cx(|cx| (cx.color("teal"), cx.shared.warnings.len()));
        assert_eq!((color, warned), (Color::Scheme("tx1"), 1));
        assert_eq!(with_cx(|cx| cx.color("accent3")), Color::Scheme("accent3"));
    }

    #[test]
    fn field_numbers_are_guids_that_differ_by_slide_and_by_field() {
        let (a, b, other) = with_cx(|cx| {
            cx.number = 1;
            let (a, b) = (cx.field_id(), cx.field_id());
            cx.number = 2;
            (a, b, cx.field_id())
        });
        assert_eq!(a, "{464C4401-0000-4000-8000-000000000001}");
        assert_eq!(b, "{464C4401-0000-4000-8000-000000000002}");
        assert_ne!(a, other);
    }

    fn rels_of(cx: &Cx) -> String {
        String::from_utf8(cx.rels.to_xml()).unwrap_or_default()
    }

    #[test]
    fn web_mail_and_phone_addresses_are_external_links_and_one_address_is_one_relationship() {
        with_cx(|cx| {
            let first = cx.link("https://example.com/a?b=1&c=2");
            assert_eq!(first, Some(Link::Web("rId1".into())));
            assert_eq!(
                cx.link(" https://example.com/a?b=1&c=2 "),
                first,
                "trimmed, and kept once"
            );
            assert_eq!(
                cx.link("mailto:me@example.com"),
                Some(Link::Web("rId2".into()))
            );
            assert_eq!(cx.link("tel:+441234"), Some(Link::Web("rId3".into())));
            assert_eq!(
                cx.link("HTTP://Example.com"),
                Some(Link::Web("rId4".into()))
            );
            let rels = rels_of(cx);
            assert_eq!(rels.matches("TargetMode=\"External\"").count(), 4, "{rels}");
            assert!(rels.contains("https://example.com/a?b=1&amp;c=2"), "{rels}");
            assert!(cx.shared.warnings.is_empty());
        });
    }

    #[test]
    fn an_address_without_a_scheme_is_taken_for_a_web_address() {
        with_cx(|cx| {
            assert_eq!(cx.link("example.com/x"), Some(Link::Web("rId1".into())));
            assert!(rels_of(cx).contains(r#"Target="https://example.com/x""#));
        });
    }

    #[test]
    fn addresses_that_run_code_or_read_files_are_left_out_with_a_warning() {
        with_cx(|cx| {
            for bad in [
                "javascript:alert(1)",
                "JaVaScRiPt:alert(1)",
                "data:text/html,<b>x</b>",
                "file:///etc/passwd",
                "vbscript:x",
                "two words",
                "",
                "   ",
            ] {
                assert_eq!(cx.link(bad), None, "{bad}");
            }
            assert_eq!(cx.shared.warnings.len(), 8);
            assert!(!rels_of(cx).contains("Target="));
        });
    }

    #[test]
    fn a_link_to_a_slide_is_a_relationship_to_its_part() {
        with_cx(|cx| {
            cx.shared
                .slide_parts
                .insert("s-2".into(), "slide2.xml".into());
            assert_eq!(cx.link("slide:s-2"), Some(Link::Slide("rId1".into())));
            assert!(
                rels_of(cx).contains(r#"relationships/slide" Target="slide2.xml""#),
                "{}",
                rels_of(cx)
            );
            assert_eq!(cx.link("slide:s-404"), None);
            assert_eq!(cx.shared.warnings.len(), 1);
            assert!(cx.shared.warnings[0].message.contains("s-404"));
        });
    }

    #[test]
    fn a_link_to_a_page_of_kasten_is_left_out_and_the_warning_says_why() {
        with_cx(|cx| {
            assert_eq!(cx.link("page:library/plan.md#Risks"), None);
            assert_eq!(cx.link("PAGE:a.md"), None);
            assert_eq!(cx.shared.warnings.len(), 2);
            assert!(cx.shared.warnings[0].message.contains("page of KastenFlow"));
            assert!(!rels_of(cx).contains("Target="));
        });
    }
}
