//! The words round a chart that a person or an agent can add: the titles of its axes, and a legend in a
//! column at its side.

use super::{Align, Data, LEGEND_PT, Parts, Rect, StyleExt, VAlign, cut, filled, unit, words};

/// The size of an axis title, in points.
const TITLE_PT: f64 = 13.0;

/// Draws the titles of the axes (the vertical axis's over the top left of the plot, the horizontal axis's
/// under it) and gives back the room that is left for the axes. A plot too small for them goes without.
pub(super) fn titled(parts: &mut Parts, plot: Rect, data: &Data) -> Rect {
    let row = unit(TITLE_PT * 1.5);
    let mut room = plot;
    if let Some(title) = &data.y_title
        && room.h > row * 3.0
    {
        words(
            parts,
            Rect {
                x: room.x,
                y: room.y,
                w: room.w,
                h: row,
            },
            title,
            TITLE_PT,
            Align::Left,
            VAlign::Middle,
            "text2",
            true,
        );
        room.y += row;
        room.h -= row;
    }
    if let Some(title) = &data.x_title
        && room.h > row * 3.0
    {
        room.h -= row;
        words(
            parts,
            Rect {
                x: room.x,
                y: room.y + room.h,
                w: room.w,
                h: row,
            },
            title,
            TITLE_PT,
            Align::Center,
            VAlign::Middle,
            "text2",
            true,
        );
    }
    room
}

/// A legend as a column of swatches and names, centred up and down in `room`.
pub(super) fn legend_column(parts: &mut Parts, room: Rect, entries: &[(String, String)]) {
    if entries.is_empty() || room.w <= 0.0 {
        return;
    }
    let row = unit(LEGEND_PT * 1.7);
    let shown = ((room.h / row).floor() as usize).min(entries.len());
    if shown == 0 {
        return;
    }
    let swatch = unit(LEGEND_PT) * 0.8;
    let top = room.y + (room.h - row * shown as f64) / 2.0;
    for (n, (name, color)) in entries.iter().take(shown).enumerate() {
        let y = top + row * n as f64;
        parts.shape(
            "roundRect",
            Rect {
                x: room.x,
                y: y + (row - swatch) / 2.0,
                w: swatch,
                h: swatch,
            },
            filled(color).radius(2.0),
            None,
        );
        let at = swatch + unit(LEGEND_PT) * 0.5;
        let space = (room.w - at).max(12.0);
        words(
            parts,
            Rect {
                x: room.x + at,
                y,
                w: space,
                h: row,
            },
            &cut(name, space, LEGEND_PT),
            LEGEND_PT,
            Align::Left,
            VAlign::Middle,
            "text1",
            false,
        );
    }
}
