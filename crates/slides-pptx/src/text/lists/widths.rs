//! The room a list leaves in front of its text has to be wider than its widest
//! marker, or PowerPoint draws the marker into the text. The widest is not
//! always the last: "xxviii." is the widest of thirty Roman numerals, "aa." of
//! thirty letters (past "z." they need two).

use slides_core::list::{AIR, MOST_HANGING, hangs_by_level, marker, width_in_ems};
use slides_core::units::points_to_units;
use slides_core::{ListKind, ListStyle, Paragraph};

fn item(style: &ListStyle, level: u8) -> Paragraph {
    Paragraph {
        list: Some(ListKind::Number),
        list_style: Some(style.clone()),
        level: Some(level),
        ..Paragraph::plain("x")
    }
}

/// How far the first item of a numbered list of `n` items in `style` at `level` hangs at `points`.
fn hang(n: usize, style: &ListStyle, level: u8, points: f64) -> f64 {
    let list: Vec<Paragraph> = (0..n).map(|_| item(style, level)).collect();
    hangs_by_level(&list, &vec![points; n])[usize::from(level)]
}

fn room_for(marker: &str, points: f64) -> f64 {
    (width_in_ems(marker) + AIR) * points_to_units(points)
}

#[test]
fn thirty_roman_numerals_hang_for_xxviii() {
    let widest = (1..=30)
        .map(|n| marker(&ListStyle::LowerRoman, n))
        .max_by(|a, b| width_in_ems(a).total_cmp(&width_in_ems(b)))
        .unwrap_or_default();
    assert_eq!(widest, "xxviii.");
    for points in [12.0, 14.0, 18.0, 22.0] {
        let hung = hang(30, &ListStyle::LowerRoman, 2, points);
        assert!(hung >= room_for("xxviii.", points), "{points} pt: {hung}");
        assert!(
            hung > hang(8, &ListStyle::LowerRoman, 2, points),
            "{points} pt: more than the room 'viii.' needs"
        );
    }
}

#[test]
fn letters_past_z_hang_for_two_letters() {
    assert_eq!(marker(&ListStyle::LowerAlpha, 27), "aa.");
    assert!(
        width_in_ems("aa.") > width_in_ems("m."),
        "two letters are wider than the widest one"
    );
    for points in [12.0, 14.0, 18.0, 22.0] {
        let hung = hang(30, &ListStyle::LowerAlpha, 1, points);
        assert!(hung >= room_for("aa.", points), "{points} pt: {hung}");
        assert!(
            hung > hang(26, &ListStyle::LowerAlpha, 1, points),
            "{points} pt: 'aa.' needs more than 'm.'"
        );
        assert_eq!(
            hung,
            hang(27, &ListStyle::LowerAlpha, 1, points),
            "the first two-letter marker is the widest of them"
        );
    }
}

#[test]
fn every_marker_of_every_style_fits_in_the_room_its_list_leaves() {
    for style in [
        ListStyle::Decimal,
        ListStyle::DecimalParen,
        ListStyle::LowerAlpha,
        ListStyle::UpperAlpha,
        ListStyle::LowerRoman,
        ListStyle::UpperRoman,
    ] {
        for count in (1..=130).step_by(3) {
            for points in [12.0, 14.0, 18.0, 22.0, 28.0] {
                let hung = hang(count, &style, 0, points);
                for n in 1..=count as u32 {
                    let room = room_for(&marker(&style, n), points);
                    assert!(
                        hung + 1e-9 >= room.min(MOST_HANGING),
                        "{style:?} up to {count} at {points} pt: {} needs {room}, the list hangs {hung}",
                        marker(&style, n)
                    );
                }
            }
        }
    }
}
