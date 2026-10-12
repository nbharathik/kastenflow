//! What a list item says to PowerPoint: the scheme of its numbers and where a run of them
//! begins again, and the glyph and typeface of its bullet. Which number each item has, and
//! how far in its marker hangs, are the editor's rules, which `slides_core::list` holds.

use slides_core::list::{self, counted};
use slides_core::{ListStyle, Paragraph};

pub use slides_core::list::level;

/// The PowerPoint name of a numbering style.
pub fn scheme(style: &ListStyle) -> &'static str {
    match style {
        ListStyle::DecimalParen => "arabicParenR",
        ListStyle::LowerAlpha => "alphaLcPeriod",
        ListStyle::UpperAlpha => "alphaUcPeriod",
        ListStyle::LowerRoman => "romanLcPeriod",
        ListStyle::UpperRoman => "romanUcPeriod",
        _ => "arabicPeriod",
    }
}

/// The numbering style a PowerPoint scheme stands for, when this build has one.
pub fn style_of_scheme(scheme: &str) -> Option<ListStyle> {
    Some(match scheme {
        "arabicPeriod" => ListStyle::Decimal,
        "arabicParenR" => ListStyle::DecimalParen,
        "alphaLcPeriod" => ListStyle::LowerAlpha,
        "alphaUcPeriod" => ListStyle::UpperAlpha,
        "romanLcPeriod" => ListStyle::LowerRoman,
        "romanUcPeriod" => ListStyle::UpperRoman,
        _ => return None,
    })
}

/// The glyph of a bullet style and the typeface it is drawn in; none for a numbered style.
pub fn bullet(style: &ListStyle) -> Option<(&'static str, &'static str)> {
    let glyph = list::glyph(style)?;
    let face = match style {
        ListStyle::Arrow | ListStyle::Check => "Segoe UI Symbol",
        _ => "Arial",
    };
    Some((glyph, face))
}

/// The bullet style a glyph stands for when it is read back from a file.
pub fn style_of_glyph(glyph: &str) -> Option<ListStyle> {
    Some(match glyph {
        "●" | "•" | "l" => ListStyle::Disc,
        "○" | "o" | "◦" => ListStyle::Circle,
        "■" | "▪" | "§" | "q" | "n" => ListStyle::Square,
        "➢" | "Ø" | "➤" | "➔" | "➜" => ListStyle::Arrow,
        "✓" | "✔" | "ü" | "√" => ListStyle::Check,
        "–" | "-" | "—" => ListStyle::Dash,
        _ => return None,
    })
}

/// How a numbered paragraph is numbered.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Number {
    pub scheme: &'static str,
    /// The number the item's run began at, set on a run that does not begin at 1 and on the
    /// first item of one that begins again at 1. PowerPoint counts an item on from the one
    /// before it only when both name the same number to begin at, so every item of a run
    /// that begins elsewhere says so.
    pub start_at: Option<u32>,
}

/// The numbering of each paragraph: its scheme, and where its run began.
pub fn numbering(paragraphs: &[Paragraph]) -> Vec<Option<Number>> {
    let mut seen = [false; list::MAX_LEVEL + 1];
    // The number the run each level is in began at.
    let mut began = [1; list::MAX_LEVEL + 1];
    counted(paragraphs)
        .into_iter()
        .zip(paragraphs)
        .map(|(counted, p)| {
            let counted = counted?;
            let at = level(p);
            let style = list::style_of(p)?;
            if counted.begins {
                began[at] = counted.n;
            }
            // The first item of a level that counts from 1 has nothing to say; one that begins
            // again at 1 later on says so, so a program that counts on does not.
            let says = began[at] != 1 || (counted.begins && seen[at]);
            seen[at] = true;
            Some(Number {
                scheme: scheme(&style),
                start_at: says.then_some(began[at]),
            })
        })
        .collect()
}

#[cfg(test)]
mod widths;

#[cfg(test)]
mod tests {
    use slides_core::ListKind;

    use super::*;

    fn item(kind: Option<ListKind>, level: u8) -> Paragraph {
        Paragraph {
            list: kind,
            level: Some(level),
            ..Paragraph::plain("x")
        }
    }

    fn num(level: u8) -> Paragraph {
        item(Some(ListKind::Number), level)
    }

    fn plain() -> Paragraph {
        item(None, 0)
    }

    #[test]
    fn only_a_run_that_begins_again_is_told_to_start() {
        let list = [
            num(0),
            num(0),
            plain(),
            num(0),
            num(0),
            num(1),
            num(1),
            num(0),
        ];
        let starts: Vec<_> = numbering(&list)
            .into_iter()
            .map(|n| n.map(|n| n.start_at))
            .collect();
        assert_eq!(
            starts,
            [
                Some(None),
                Some(None),
                None,
                Some(Some(1)),
                Some(None),
                Some(None),
                Some(None),
                Some(None)
            ]
        );
    }

    #[test]
    fn an_item_that_counts_from_a_number_of_its_own_says_so() {
        let mut third = num(0);
        third.start = Some(4);
        let list = [num(0), third.clone(), num(0), plain(), third, num(0)];
        let starts: Vec<_> = numbering(&list)
            .into_iter()
            .map(|n| n.map(|n| n.start_at))
            .collect();
        // PowerPoint counts a paragraph on from the one before it only when both name the same
        // starting number, so the items that follow one counting from four name four as well.
        assert_eq!(
            starts,
            [
                Some(None),
                Some(Some(4)),
                Some(Some(4)),
                None,
                Some(Some(4)),
                Some(Some(4))
            ]
        );
    }

    #[test]
    fn a_run_that_begins_again_at_one_names_it_on_its_first_item_only() {
        let mut ten = num(0);
        ten.start = Some(10);
        let list = [num(0), ten, num(0), num(0), plain(), num(0), num(0)];
        let starts: Vec<_> = numbering(&list)
            .into_iter()
            .map(|n| n.map(|n| n.start_at))
            .collect();
        assert_eq!(
            starts,
            [
                Some(None),
                Some(Some(10)),
                Some(Some(10)),
                Some(Some(10)),
                None,
                Some(Some(1)),
                Some(None)
            ]
        );
    }

    #[test]
    fn schemes_and_glyphs_read_back_as_they_were_written() {
        for style in [
            ListStyle::Decimal,
            ListStyle::DecimalParen,
            ListStyle::LowerAlpha,
            ListStyle::UpperAlpha,
            ListStyle::LowerRoman,
            ListStyle::UpperRoman,
        ] {
            assert_eq!(style_of_scheme(scheme(&style)), Some(style));
        }
        for style in [
            ListStyle::Disc,
            ListStyle::Circle,
            ListStyle::Square,
            ListStyle::Arrow,
            ListStyle::Check,
            ListStyle::Dash,
        ] {
            let (glyph, _) = bullet(&style).expect("a glyph");
            assert_eq!(style_of_glyph(glyph), Some(style));
        }
        assert_eq!(style_of_scheme("thaiAlphaPeriod"), None);
        assert_eq!(style_of_glyph("¤"), None);
        assert_eq!(bullet(&ListStyle::Decimal), None);
    }

    #[test]
    fn levels_stop_at_the_ninth() {
        assert_eq!(level(&num(200)), list::MAX_LEVEL);
        assert_eq!(level(&Paragraph::plain("x")), 0);
    }
}
