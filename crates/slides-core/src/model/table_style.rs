//! Table styles: a few looks for a whole table, made from the theme's colours, so a table follows
//! its theme when the theme changes. A style gives each cell its fill, its words' colour and
//! weight, and its four lines (`look`); a cell's own fill and its own `borders` win over it. The
//! editor's renderer works the same rules out in TypeScript (`table-style.ts`); keep the two
//! alike, the tests on both sides check the same cells.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Extra, Fill, Stroke, is_false};

model! {
    /// The style of a table as a whole.
    #[serde(rename_all = "camelCase")]
    pub struct TableStyle {
        /// One of `table_style_ids()`; a name that is not known is drawn as the first.
        pub preset: String,
        /// Every other row, after the header, is shaded.
        #[serde(default, skip_serializing_if = "is_false")]
        pub banded_rows: bool,
        /// The first column is set apart.
        #[serde(default, skip_serializing_if = "is_false")]
        pub first_column: bool,
        /// The last row is set apart, as a total row is.
        #[serde(default, skip_serializing_if = "is_false")]
        pub last_row: bool,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The lines around one cell. A side left out follows the table's style; a line of width 0 is no line.
    #[derive(Default)]
    #[serde(rename_all = "camelCase")]
    pub struct CellBorders {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub top: Option<Stroke>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub right: Option<Stroke>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub bottom: Option<Stroke>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub left: Option<Stroke>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl CellBorders {
    pub fn is_empty(&self) -> bool {
        self.top.is_none() && self.right.is_none() && self.bottom.is_none() && self.left.is_none()
    }
}

/// A theme colour at a strength from 0 to 1.
#[derive(Clone, Copy)]
struct Tint(&'static str, f64);

#[derive(Clone, Copy, PartialEq)]
enum Rules {
    Grid,
    Horizontal,
    Outer,
    Nothing,
}

struct Preset {
    id: &'static str,
    label: &'static str,
    header: Option<Tint>,
    /// The colour of the header's words, when the fill needs it.
    header_text: Option<&'static str>,
    band: Option<Tint>,
    first: Option<Tint>,
    rules: Rules,
    rule: Tint,
}

const GRID: Tint = Tint("text2", 0.3);

static PRESETS: [Preset; 10] = [
    Preset {
        id: "grid",
        label: "Plain grid",
        header: None,
        header_text: None,
        band: Some(Tint("bg2", 0.6)),
        first: None,
        rules: Rules::Grid,
        rule: GRID,
    },
    Preset {
        id: "accent",
        label: "Accent header",
        header: Some(Tint("accent1", 1.0)),
        header_text: Some("bg1"),
        band: Some(Tint("accent1", 0.1)),
        first: Some(Tint("accent1", 0.2)),
        rules: Rules::Grid,
        rule: Tint("accent1", 0.3),
    },
    Preset {
        id: "accent-light",
        label: "Soft accent",
        header: Some(Tint("accent1", 0.25)),
        header_text: None,
        band: Some(Tint("accent1", 0.08)),
        first: Some(Tint("accent1", 0.12)),
        rules: Rules::Horizontal,
        rule: Tint("accent1", 0.4),
    },
    Preset {
        id: "dark",
        label: "Dark header",
        header: Some(Tint("text1", 1.0)),
        header_text: Some("bg1"),
        band: Some(Tint("bg2", 1.0)),
        first: Some(Tint("bg2", 1.0)),
        rules: Rules::Horizontal,
        rule: GRID,
    },
    Preset {
        id: "rules",
        label: "Horizontal rules",
        header: None,
        header_text: None,
        band: None,
        first: None,
        rules: Rules::Horizontal,
        rule: Tint("text1", 0.6),
    },
    Preset {
        id: "minimal",
        label: "Minimal",
        header: None,
        header_text: None,
        band: Some(Tint("bg2", 0.7)),
        first: None,
        rules: Rules::Nothing,
        rule: GRID,
    },
    Preset {
        id: "soft",
        label: "Soft bands",
        header: Some(Tint("bg2", 1.0)),
        header_text: None,
        band: Some(Tint("bg2", 0.5)),
        first: Some(Tint("bg2", 1.0)),
        rules: Rules::Nothing,
        rule: GRID,
    },
    Preset {
        id: "outline",
        label: "Outline",
        header: Some(Tint("accent1", 0.15)),
        header_text: None,
        band: None,
        first: Some(Tint("accent1", 0.08)),
        rules: Rules::Outer,
        rule: Tint("accent1", 0.8),
    },
    Preset {
        id: "accent2",
        label: "Second accent",
        header: Some(Tint("accent2", 1.0)),
        header_text: Some("bg1"),
        band: Some(Tint("accent2", 0.1)),
        first: Some(Tint("accent2", 0.2)),
        rules: Rules::Grid,
        rule: Tint("accent2", 0.3),
    },
    Preset {
        id: "accent3",
        label: "Third accent",
        header: Some(Tint("accent3", 1.0)),
        header_text: Some("bg1"),
        band: Some(Tint("accent3", 0.1)),
        first: Some(Tint("accent3", 0.2)),
        rules: Rules::Grid,
        rule: Tint("accent3", 0.3),
    },
];

/// The ids of the table styles, in the order a gallery shows them.
pub fn table_style_ids() -> Vec<&'static str> {
    PRESETS.iter().map(|p| p.id).collect()
}

/// What a person sees for a style id.
pub fn table_style_label(id: &str) -> Option<&'static str> {
    PRESETS.iter().find(|p| p.id == id).map(|p| p.label)
}

/// Whether `id` names a table style.
pub fn is_table_style(id: &str) -> bool {
    PRESETS.iter().any(|p| p.id == id)
}

/// What a style makes of one cell.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct CellLook {
    pub fill: Option<Fill>,
    /// A theme colour for the words, when the fill calls for one.
    pub text: Option<&'static str>,
    pub bold: bool,
    pub top: Option<Stroke>,
    pub right: Option<Stroke>,
    pub bottom: Option<Stroke>,
    pub left: Option<Stroke>,
}

fn fill(t: Tint) -> Fill {
    Fill {
        color: t.0.to_owned(),
        alpha: (t.1 < 1.0).then_some(t.1),
        extra: Extra::new(),
    }
}

fn line(t: Tint, width: f64) -> Stroke {
    Stroke {
        color: t.0.to_owned(),
        width: Some(width),
        dash: None,
        alpha: (t.1 < 1.0).then_some(t.1),
        extra: Extra::new(),
    }
}

/// How the style looks on the cell at `row`, `col` of a table of `rows` by `cols`. The first row is
/// the header only when `header_row` says so.
pub fn cell_look(
    style: &TableStyle,
    header_row: bool,
    rows: usize,
    cols: usize,
    row: usize,
    col: usize,
) -> CellLook {
    let p = PRESETS
        .iter()
        .find(|p| p.id == style.preset)
        .unwrap_or(&PRESETS[0]);
    let header = header_row && row == 0;
    let last = style.last_row && !header && row + 1 == rows;
    let first = style.first_column && !header && !last && col == 0;
    let data_row = row.saturating_sub(usize::from(header_row));
    let band = style.banded_rows && !header && !last && data_row % 2 == 1;

    let mut out = CellLook::default();
    if header {
        out.fill = p.header.map(fill);
        out.text = p.header_text;
        out.bold = true;
    } else if last {
        out.bold = true;
    } else if first {
        out.fill = p.first.map(fill);
        out.bold = true;
    } else if band {
        out.fill = p.band.map(fill);
    }

    let thin = 1.0;
    match p.rules {
        Rules::Grid => {
            for side in [&mut out.top, &mut out.right, &mut out.bottom, &mut out.left] {
                *side = Some(line(p.rule, thin));
            }
        }
        Rules::Horizontal => {
            out.top = Some(line(p.rule, thin));
            out.bottom = Some(line(p.rule, if header { thin * 2.0 } else { thin }));
        }
        Rules::Outer => {
            if row == 0 {
                out.top = Some(line(p.rule, thin * 1.5));
            }
            if row + 1 == rows {
                out.bottom = Some(line(p.rule, thin * 1.5));
            }
            if col == 0 {
                out.left = Some(line(p.rule, thin * 1.5));
            }
            if col + 1 == cols {
                out.right = Some(line(p.rule, thin * 1.5));
            }
            if header {
                out.bottom = Some(line(p.rule, thin));
            }
        }
        Rules::Nothing => {}
    }
    if last && p.rules != Rules::Grid {
        out.top = Some(line(Tint("text1", 0.8), thin * 1.5));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(preset: &str) -> TableStyle {
        TableStyle {
            preset: preset.to_owned(),
            banded_rows: true,
            first_column: false,
            last_row: false,
            extra: Extra::new(),
        }
    }

    #[test]
    fn there_are_ten_styles_each_with_a_label() {
        let ids = table_style_ids();
        assert_eq!(ids.len(), 10);
        assert!(ids.iter().all(|id| table_style_label(id).is_some()));
    }

    #[test]
    fn the_header_takes_the_accent_and_the_rows_after_it_alternate() {
        let s = style("accent");
        let header = cell_look(&s, true, 4, 2, 0, 0);
        assert_eq!(
            header.fill.as_ref().map(|f| f.color.as_str()),
            Some("accent1")
        );
        assert_eq!(header.fill.as_ref().and_then(|f| f.alpha), None);
        assert_eq!(header.text, Some("bg1"));
        assert!(header.bold);
        // Rows 1, 2, 3 are the data rows 0, 1, 2: the second is shaded.
        assert_eq!(cell_look(&s, true, 4, 2, 1, 1).fill, None);
        let band = cell_look(&s, true, 4, 2, 2, 1).fill.unwrap();
        assert_eq!((band.color.as_str(), band.alpha), ("accent1", Some(0.1)));
        assert_eq!(cell_look(&s, true, 4, 2, 3, 1).fill, None);
    }

    #[test]
    fn without_a_header_row_the_first_row_is_data() {
        let s = style("accent");
        let first = cell_look(&s, false, 3, 2, 0, 0);
        assert_eq!(first.fill, None);
        assert!(!first.bold);
        assert!(cell_look(&s, false, 3, 2, 1, 0).fill.is_some());
    }

    #[test]
    fn the_first_column_and_the_last_row_are_set_apart_when_asked() {
        let mut s = style("grid");
        s.banded_rows = false;
        assert!(!cell_look(&s, true, 3, 3, 1, 0).bold);
        s.first_column = true;
        s.last_row = true;
        assert!(cell_look(&s, true, 3, 3, 1, 0).bold);
        assert!(cell_look(&s, true, 3, 3, 2, 2).bold);
        assert!(!cell_look(&s, true, 3, 3, 1, 1).bold);
    }

    #[test]
    fn the_outline_draws_only_the_edges_of_the_table() {
        let s = style("outline");
        let inner = cell_look(&s, false, 3, 3, 1, 1);
        assert!(inner.top.is_none() && inner.left.is_none());
        let corner = cell_look(&s, false, 3, 3, 0, 0);
        assert!(corner.top.is_some() && corner.left.is_some());
        assert!(corner.right.is_none() && corner.bottom.is_none());
    }

    #[test]
    fn an_unknown_style_is_drawn_as_the_first() {
        let known = cell_look(&style("grid"), true, 3, 3, 1, 1);
        assert_eq!(cell_look(&style("nonsense"), true, 3, 3, 1, 1), known);
    }
}
