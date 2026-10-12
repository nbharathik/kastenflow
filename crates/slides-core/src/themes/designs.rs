//! The seven designed themes. Each is drawn for a 960 by 540 slide with flat colours only (a
//! gradient would reach PowerPoint as its average colour): a palette, a pair of typefaces the
//! editor bundles, a master of stripes, rules and marks, the room a layout leaves for them, and
//! the sizes of the type. The twelve layouts are the same in every theme; where they put their
//! slots is the frame's doing.

use super::layouts::{Frame, twelve};
use super::master::{mark, slide_number_at};
use super::styles::{Type, text_styles_of};
use super::{fonts, palette};
use crate::model::{Colors, Element, Extra, Fonts, Highlight, Layout, Theme};

/// What a designed theme is made of.
struct Design {
    name: &'static str,
    colors: Colors,
    fonts: Fonts,
    frame: Frame,
    kind: Type,
    master: Vec<Element>,
}

impl Design {
    fn build(self) -> Theme {
        let layouts: Vec<Layout> = twelve(&self.frame);
        Theme {
            name: self.name.to_owned(),
            colors: self.colors,
            fonts: self.fonts,
            text_styles: text_styles_of(&self.kind),
            layouts,
            master: self.master,
            dimmed_opacity: 0.25,
            highlight: Highlight {
                color: "accent1".to_owned(),
                width: 2.0,
                extra: Extra::new(),
            },
            new_slide_layout: None,
            extra: Extra::new(),
        }
    }
}

/// Type that is not the classic four's: the sizes that follow, bold or italic as given.
fn kind(title: f64, display: f64, subtitle: f64, body: f64, big_number: f64, quote: f64) -> Type {
    Type {
        title,
        title_bold: true,
        display,
        display_bold: true,
        subtitle,
        body,
        big_number,
        big_number_bold: true,
        quote,
        quote_italic: true,
    }
}

/// Pure type on white: a short vermilion tab above the title and a hairline under the content.
pub(super) fn minimal() -> Theme {
    Design {
        name: "Minimal",
        colors: palette::minimal(),
        fonts: fonts::lato(),
        frame: Frame {
            left: 72.0,
            right: 72.0,
            top: 44.0,
            title_h: 88.0,
            gap: 12.0,
            bottom: 488.0,
            mid: 272.0,
        },
        kind: Type {
            title_bold: false,
            display_bold: false,
            big_number_bold: false,
            ..kind(36.0, 48.0, 20.0, 22.0, 120.0, 34.0)
        },
        master: vec![
            mark("master-tab", (72.0, 24.0, 28.0, 4.0), "accent1", None),
            mark(
                "master-rule",
                (72.0, 494.0, 816.0, 1.5),
                "text2",
                Some(0.35),
            ),
            slide_number_at(808.0, 502.0),
        ],
    }
    .build()
}

/// A rose-red band down the left edge with a dark cap, and large heavy type.
pub(super) fn bold() -> Theme {
    Design {
        name: "Bold",
        colors: palette::bold(),
        fonts: fonts::roboto(),
        frame: Frame {
            left: 96.0,
            right: 56.0,
            top: 44.0,
            title_h: 104.0,
            gap: 12.0,
            bottom: 490.0,
            mid: 272.0,
        },
        kind: kind(40.0, 50.0, 22.0, 24.0, 120.0, 34.0),
        master: vec![
            mark("master-band", (0.0, 0.0, 32.0, 540.0), "accent1", None),
            mark("master-cap", (0.0, 0.0, 32.0, 88.0), "accent2", None),
            slide_number_at(860.0, 500.0),
        ],
    }
    .build()
}

/// Three colours across the top edge and an indigo lead, set in Inter over Lato.
pub(super) fn modern() -> Theme {
    Design {
        name: "Modern",
        colors: palette::modern(),
        fonts: fonts::inter_lato(),
        frame: Frame {
            left: 80.0,
            right: 64.0,
            top: 52.0,
            title_h: 88.0,
            gap: 12.0,
            bottom: 488.0,
            mid: 272.0,
        },
        kind: kind(36.0, 48.0, 20.0, 22.0, 104.0, 32.0),
        master: vec![
            mark("master-rule-1", (0.0, 0.0, 320.0, 6.0), "accent1", None),
            mark("master-rule-2", (320.0, 0.0, 320.0, 6.0), "accent2", None),
            mark("master-rule-3", (640.0, 0.0, 320.0, 6.0), "accent3", None),
            slide_number_at(860.0, 500.0),
        ],
    }
    .build()
}

/// Cream paper in a journal's manner: a double rule over the title and a thin one under the page.
pub(super) fn academic() -> Theme {
    Design {
        name: "Academic",
        colors: palette::academic(),
        fonts: fonts::academic(),
        frame: Frame {
            left: 80.0,
            right: 80.0,
            top: 56.0,
            title_h: 88.0,
            gap: 16.0,
            bottom: 484.0,
            mid: 272.0,
        },
        kind: kind(34.0, 44.0, 20.0, 22.0, 96.0, 30.0),
        master: vec![
            mark("master-rule", (80.0, 28.0, 800.0, 2.5), "accent1", None),
            mark(
                "master-rule-thin",
                (80.0, 34.0, 800.0, 0.75),
                "accent1",
                None,
            ),
            mark(
                "master-rule-foot",
                (80.0, 494.0, 800.0, 0.75),
                "accent1",
                Some(0.5),
            ),
            slide_number_at(800.0, 500.0),
        ],
    }
    .build()
}

/// Midnight blue with an amber stripe down the right edge.
pub(super) fn pitch() -> Theme {
    Design {
        name: "Pitch",
        colors: palette::pitch(),
        fonts: fonts::roboto_lato(),
        frame: Frame {
            left: 64.0,
            right: 96.0,
            top: 40.0,
            title_h: 96.0,
            gap: 16.0,
            bottom: 492.0,
            mid: 272.0,
        },
        kind: kind(38.0, 50.0, 22.0, 22.0, 120.0, 34.0),
        master: vec![
            mark("master-stripe", (936.0, 0.0, 24.0, 540.0), "accent1", None),
            mark(
                "master-stripe-foot",
                (936.0, 492.0, 24.0, 48.0),
                "accent4",
                None,
            ),
            slide_number_at(840.0, 500.0),
        ],
    }
    .build()
}

/// Near-black with cyan corner marks, like the frame of a viewfinder.
pub(super) fn dark_studio() -> Theme {
    let corner = |id: &str, rect| mark(id, rect, "accent1", None);
    Design {
        name: "Dark Studio",
        colors: palette::dark_studio(),
        fonts: fonts::sans(),
        frame: Frame {
            left: 72.0,
            right: 72.0,
            top: 48.0,
            title_h: 92.0,
            gap: 14.0,
            bottom: 488.0,
            mid: 272.0,
        },
        kind: kind(36.0, 48.0, 20.0, 22.0, 112.0, 32.0),
        master: vec![
            corner("master-corner-tr-h", (900.0, 32.0, 28.0, 2.0)),
            corner("master-corner-tr-v", (926.0, 32.0, 2.0, 28.0)),
            corner("master-corner-bl-h", (32.0, 506.0, 28.0, 2.0)),
            corner("master-corner-bl-v", (32.0, 480.0, 2.0, 28.0)),
            slide_number_at(860.0, 500.0),
        ],
    }
    .build()
}

/// Warm paper under a strip of terracotta and ochre, like the tape on a folder.
pub(super) fn warm_paper() -> Theme {
    Design {
        name: "Warm Paper",
        colors: palette::warm_paper(),
        fonts: fonts::paper(),
        frame: Frame {
            left: 72.0,
            right: 72.0,
            top: 48.0,
            title_h: 92.0,
            gap: 14.0,
            bottom: 490.0,
            mid: 272.0,
        },
        kind: kind(38.0, 48.0, 22.0, 22.0, 104.0, 34.0),
        master: vec![
            mark("master-tape", (0.0, 0.0, 960.0, 14.0), "accent1", None),
            mark("master-tape-edge", (0.0, 14.0, 960.0, 4.0), "accent3", None),
            slide_number_at(860.0, 500.0),
        ],
    }
    .build()
}
