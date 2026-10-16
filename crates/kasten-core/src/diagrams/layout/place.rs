//! Where a new box goes, and how big it is: sizes estimated from the words,
//! the first free place on the grid, a place beside another box.

use crate::diagrams::model::Rect;

/// The editor's grid, in pixels.
pub const GRID: f64 = 10.0;
/// Room kept around a box when looking for a free place.
const MARGIN: f64 = 20.0;
/// Pixels a character of a 12 px label takes.
const CHAR_W: f64 = 7.0;
/// Where a box's words wrap.
pub const WRAP: f64 = 220.0;
const LINE_H: f64 = 18.0;

/// The nearest point of the grid.
pub fn snap(v: f64) -> f64 {
    (v / GRID).round() * GRID
}

/// A box's size for its words: at least `w` by `h`, wider for a long label
/// up to where it wraps, taller for each wrapped line.
pub fn estimate_size(label: &str, w: f64, h: f64) -> (f64, f64) {
    let lines: Vec<&str> = label.lines().collect();
    let longest = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f64;
    let wanted = longest * CHAR_W + 24.0;
    let width = if wanted > w {
        up(wanted.min(w.max(WRAP)))
    } else {
        w
    };
    let room = ((width - 24.0) / CHAR_W).floor().max(1.0);
    let shown: f64 = lines
        .iter()
        .map(|l| ((l.chars().count() as f64) / room).ceil().max(1.0))
        .sum::<f64>()
        .max(1.0);
    let needed = shown * LINE_H + 8.0;
    let height = if needed > h { up(needed) } else { h };
    (width, height)
}

fn up(v: f64) -> f64 {
    (v / GRID).ceil() * GRID
}

/// The first place, scanning row by row from `start`, where a box of `w` by
/// `h` keeps clear of `taken` and its left edge is at most `last_x`.
pub fn free_slot(taken: &[Rect], start: (f64, f64), last_x: f64, w: f64, h: f64) -> (f64, f64) {
    let (start_x, start_y) = (snap(start.0), snap(start.1));
    let last_x = last_x.max(start_x);
    let mut y = start_y;
    for _ in 0..2000 {
        let mut x = start_x;
        while x <= last_x {
            let candidate = Rect { x, y, w, h };
            if !taken.iter().any(|t| candidate.overlaps(t, -MARGIN)) {
                return (x, y);
            }
            x += 20.0;
        }
        y += 20.0;
    }
    (start_x, y)
}

/// Which side of a box another goes on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Right,
    Left,
    Above,
    Below,
}

impl Side {
    pub fn parse(word: &str) -> Option<Side> {
        match word.trim().to_lowercase().as_str() {
            "right" | "east" => Some(Side::Right),
            "left" | "west" => Some(Side::Left),
            "above" | "top" | "north" | "up" => Some(Side::Above),
            "below" | "bottom" | "south" | "down" => Some(Side::Below),
            _ => None,
        }
    }
}

/// A place for a box of `w` by `h` on `side` of `anchor`, `gap` away, slid
/// along the side until it keeps clear of `taken`.
pub fn beside(taken: &[Rect], anchor: Rect, side: Side, w: f64, h: f64, gap: f64) -> (f64, f64) {
    let (cx, cy) = anchor.center();
    let base = match side {
        Side::Right => (anchor.right() + gap, cy - h / 2.0),
        Side::Left => (anchor.x - gap - w, cy - h / 2.0),
        Side::Above => (cx - w / 2.0, anchor.y - gap - h),
        Side::Below => (cx - w / 2.0, anchor.bottom() + gap),
    };
    let along_x = matches!(side, Side::Above | Side::Below);
    for step in 0..60 {
        // 0, +1, -1, +2, -2 …: the nearest free slot on either side.
        let n = (step + 1) / 2;
        let sign = if step % 2 == 1 { 1.0 } else { -1.0 };
        let shift = n as f64 * (if along_x { w } else { h } + 20.0) * sign;
        let (x, y) = if along_x {
            (base.0 + shift, base.1)
        } else {
            (base.0, base.1 + shift)
        };
        let (x, y) = (snap(x), snap(y));
        if !taken
            .iter()
            .any(|t| Rect { x, y, w, h }.overlaps(t, -MARGIN / 2.0))
        {
            return (x, y);
        }
    }
    (snap(base.0), snap(base.1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_long_label_widens_a_box_up_to_where_it_wraps_and_then_grows_it_taller() {
        assert_eq!(estimate_size("API", 120.0, 60.0), (120.0, 60.0));
        let (w, h) = estimate_size("Authentication and authorisation gateway", 120.0, 60.0);
        assert_eq!((w, h), (220.0, 60.0));
        let (w, h) = estimate_size(&"word ".repeat(30), 120.0, 60.0);
        assert_eq!(w, 220.0);
        assert!(h > 100.0 && h % 10.0 == 0.0, "{h}");
        let (_, h) = estimate_size("one\ntwo\nthree\nfour", 120.0, 60.0);
        assert_eq!(h, 80.0);
        // A box that is already big enough is left as it is, whatever its size.
        assert_eq!(estimate_size("id: uuid", 160.0, 26.0), (160.0, 26.0));
    }

    #[test]
    fn the_first_free_place_skips_what_is_taken_and_stays_on_the_grid() {
        assert_eq!(
            free_slot(&[], (40.0, 40.0), 700.0, 120.0, 60.0),
            (40.0, 40.0)
        );
        let taken = [Rect {
            x: 40.0,
            y: 40.0,
            w: 120.0,
            h: 60.0,
        }];
        let (x, y) = free_slot(&taken, (40.0, 40.0), 700.0, 120.0, 60.0);
        assert!(
            !Rect {
                x,
                y,
                w: 120.0,
                h: 60.0
            }
            .overlaps(&taken[0], -20.0)
        );
        assert_eq!((x % 10.0, y % 10.0), (0.0, 0.0));
    }

    #[test]
    fn a_box_goes_beside_another_and_slides_past_what_is_in_the_way() {
        let anchor = Rect {
            x: 100.0,
            y: 100.0,
            w: 120.0,
            h: 60.0,
        };
        assert_eq!(
            beside(&[], anchor, Side::Right, 120.0, 60.0, 80.0),
            (300.0, 100.0)
        );
        assert_eq!(
            beside(&[], anchor, Side::Below, 120.0, 60.0, 60.0),
            (100.0, 220.0)
        );
        let in_the_way = [Rect {
            x: 300.0,
            y: 100.0,
            w: 120.0,
            h: 60.0,
        }];
        let (x, y) = beside(&in_the_way, anchor, Side::Right, 120.0, 60.0, 80.0);
        assert_eq!(x, 300.0);
        assert_ne!(y, 100.0);
        assert_eq!(Side::parse("Below"), Some(Side::Below));
        assert_eq!(Side::parse("sideways"), None);
    }
}
