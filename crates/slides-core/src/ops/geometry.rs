//! Boxes, moves and connectors: the arithmetic behind moving, resizing and
//! grouping elements.

use std::collections::{HashMap, HashSet};

use super::util::{each_mut, path_of, round2};
use crate::model::{Anchor, Element, Side, Slide, Theme};
use crate::resolve::{Rect, box_in};

pub fn rect_of(theme: &Theme, layout: &str, e: &Element) -> Option<Rect> {
    box_in(theme, layout, e)
}

pub fn set_rect(e: &mut Element, r: Rect) {
    let b = e.base_mut();
    b.x = Some(round2(r.x));
    b.y = Some(round2(r.y));
    b.w = Some(round2(r.w));
    b.h = Some(round2(r.h));
}

/// Writes the box an element has, from its placeholder if it came from
/// there, into the element and its children, so what moves it need not know
/// about layouts.
pub fn pin(theme: &Theme, layout: &str, e: &mut Element) {
    if let Some(r) = rect_of(theme, layout, e) {
        set_rect(e, r);
    }
    if let Some(children) = e.children_mut() {
        for child in children {
            pin(theme, layout, child);
        }
    }
}

pub fn centre(r: Rect) -> (f64, f64) {
    (r.x + r.w / 2.0, r.y + r.h / 2.0)
}

/// The smallest box holding all of `rects`.
pub fn union(rects: impl IntoIterator<Item = Rect>) -> Option<Rect> {
    rects.into_iter().reduce(|a, b| {
        let x = a.x.min(b.x);
        let y = a.y.min(b.y);
        Rect {
            x,
            y,
            w: (a.x + a.w).max(b.x + b.w) - x,
            h: (a.y + a.h).max(b.y + b.h) - y,
        }
    })
}

/// The upright box holding `r` turned by `degrees` about its centre.
pub fn turned(r: Rect, degrees: f64) -> Rect {
    if degrees == 0.0 {
        return r;
    }
    let t = degrees.to_radians();
    let (sin, cos) = (t.sin().abs(), t.cos().abs());
    let (cx, cy) = centre(r);
    let (w, h) = (r.w * cos + r.h * sin, r.w * sin + r.h * cos);
    Rect {
        x: cx - w / 2.0,
        y: cy - h / 2.0,
        w,
        h,
    }
}

/// Moves an element, and what a group holds, by `dx`, `dy`. Boxes must be pinned.
pub fn translate(e: &mut Element, dx: f64, dy: f64) {
    let b = e.base_mut();
    if let (Some(x), Some(y)) = (b.x, b.y) {
        b.x = Some(round2(x + dx));
        b.y = Some(round2(y + dy));
    }
    if let Some(children) = e.children_mut() {
        for child in children {
            translate(child, dx, dy);
        }
    }
}

/// Maps `e` and everything in it from a group that was at `old` to one that is
/// at `new`, turned by `turn` degrees about the new group's centre.
pub fn remap(e: &mut Element, old: Rect, new: Rect, turn: f64) {
    let sx = if old.w > 0.0 { new.w / old.w } else { 1.0 };
    let sy = if old.h > 0.0 { new.h / old.h } else { 1.0 };
    let pivot = centre(new);
    remap_with(e, old, new, sx, sy, turn, pivot);
}

fn remap_with(
    e: &mut Element,
    old: Rect,
    new: Rect,
    sx: f64,
    sy: f64,
    turn: f64,
    pivot: (f64, f64),
) {
    if let Some(r) = e.base().rect().map(|(x, y, w, h)| Rect { x, y, w, h }) {
        let mut r = Rect {
            x: new.x + (r.x - old.x) * sx,
            y: new.y + (r.y - old.y) * sy,
            w: r.w * sx,
            h: r.h * sy,
        };
        if turn != 0.0 {
            let (cx, cy) = centre(r);
            let t = turn.to_radians();
            let (dx, dy) = (cx - pivot.0, cy - pivot.1);
            let (nx, ny) = (
                pivot.0 + dx * t.cos() - dy * t.sin(),
                pivot.1 + dx * t.sin() + dy * t.cos(),
            );
            r.x = nx - r.w / 2.0;
            r.y = ny - r.h / 2.0;
            if !matches!(e, Element::Group(_)) {
                let base = e.base_mut();
                base.rotation = Some(round2(base.rotation.unwrap_or(0.0) + turn));
            }
        }
        set_rect(e, r);
    }
    if let Some(children) = e.children_mut() {
        for child in children {
            remap_with(child, old, new, sx, sy, turn, pivot);
        }
    }
}

/// Sets each group's box to the box that holds its children, from the inside out.
pub fn refit(e: &mut Element) {
    let Some(children) = e.children_mut() else {
        return;
    };
    for child in children.iter_mut() {
        refit(child);
    }
    let boxes: Vec<Rect> = children
        .iter()
        .filter_map(|c| {
            c.base()
                .rect()
                .map(|(x, y, w, h)| turned(Rect { x, y, w, h }, c.base().rotation.unwrap_or(0.0)))
        })
        .collect();
    if let Some(r) = union(boxes) {
        set_rect(e, r);
    }
}

/// The outermost group that holds the element with `id`, by its id, or `None` for an element that
/// is not in a group (or is not there).
pub fn outer_group(slide: &Slide, id: &str) -> Option<String> {
    let path = path_of(&slide.elements, id)?;
    (path.len() > 1).then(|| slide.elements[path[0]].id().to_owned())
}

/// Puts the groups that held elements of `holders` (named by `outer_group` before the change) back
/// to the box that holds what is in them now. A group that is gone is skipped.
pub fn settle_groups(slide: &mut Slide, holders: &HashSet<String>) {
    for e in &mut slide.elements {
        if holders.contains(e.id()) {
            refit(e);
        }
    }
}

fn anchor_point(rects: &HashMap<String, Rect>, anchor: &Anchor) -> Option<(f64, f64)> {
    let r = rects.get(&anchor.el)?;
    Some(match anchor.side {
        Side::Left => (r.x, r.y + r.h / 2.0),
        Side::Right => (r.x + r.w, r.y + r.h / 2.0),
        Side::Top => (r.x + r.w / 2.0, r.y),
        Side::Bottom => (r.x + r.w / 2.0, r.y + r.h),
    })
}

fn collect_rects(list: &[Element], theme: &Theme, layout: &str, out: &mut HashMap<String, Rect>) {
    for e in list {
        if let Some(r) = rect_of(theme, layout, e) {
            out.insert(e.id().to_owned(), r);
        }
        collect_rects(e.children(), theme, layout, out);
    }
}

/// Lets a connector that names both elements it joins do without a box: it gets
/// an empty one at the origin, which `reroute` then replaces with the space
/// between the two. `known` holds the ids that are on the slide or in the same
/// batch; naming any other element is an error, and a connector with a free end
/// still needs its box.
pub fn seat_connectors(
    list: &mut [Element],
    known: &HashSet<String>,
) -> std::result::Result<(), String> {
    for e in list {
        if let Element::Connector(c) = e {
            let b = &c.base;
            let boxless = b.x.is_none()
                && b.y.is_none()
                && b.w.is_none()
                && b.h.is_none()
                && b.placeholder.is_none();
            if boxless && let (Some(from), Some(to)) = (&c.from, &c.to) {
                if let Some(missing) = [from, to].into_iter().find(|a| !known.contains(&a.el)) {
                    return Err(format!(
                        "the connector is attached to `{}`, which is not on the slide",
                        missing.el
                    ));
                }
                c.base.x = Some(0.0);
                c.base.y = Some(0.0);
                c.base.w = Some(0.0);
                c.base.h = Some(0.0);
            }
        }
        if let Some(children) = e.children_mut() {
            seat_connectors(children, known)?;
        }
    }
    Ok(())
}

/// Puts every connector that is attached to elements back between them.
pub fn reroute(theme: &Theme, slide: &mut Slide) {
    let layout = slide.layout.clone();
    let mut rects = HashMap::new();
    collect_rects(&slide.elements, theme, &layout, &mut rects);
    each_mut(&mut slide.elements, &mut |e| {
        let Element::Connector(c) = e else {
            return;
        };
        if c.from.is_none() && c.to.is_none() {
            return;
        }
        let Some((x, y, w, h)) = c.base.rect() else {
            return;
        };
        let now_start = (
            if c.base.flip_h { x + w } else { x },
            if c.base.flip_v { y + h } else { y },
        );
        let now_end = (
            if c.base.flip_h { x } else { x + w },
            if c.base.flip_v { y } else { y + h },
        );
        let start = c
            .from
            .as_ref()
            .and_then(|a| anchor_point(&rects, a))
            .unwrap_or(now_start);
        let end =
            c.to.as_ref()
                .and_then(|a| anchor_point(&rects, a))
                .unwrap_or(now_end);
        c.base.x = Some(round2(start.0.min(end.0)));
        c.base.y = Some(round2(start.1.min(end.1)));
        c.base.w = Some(round2((end.0 - start.0).abs()));
        c.base.h = Some(round2((end.1 - start.1).abs()));
        c.base.flip_h = end.0 < start.0;
        c.base.flip_v = end.1 < start.1;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Base, ConnectorEl, GroupEl, Route, Text};

    fn boxed(id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
        Element::text_el(Base::new(id).place(x, y, w, h), Text::plain("x"))
    }

    #[test]
    fn a_turned_quarter_swaps_width_and_height_about_the_centre() {
        let t = turned(
            Rect {
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 50.0,
            },
            90.0,
        );
        assert!((t.w - 50.0).abs() < 1e-9 && (t.h - 100.0).abs() < 1e-9);
        assert!((t.x - 25.0).abs() < 1e-9 && (t.y + 25.0).abs() < 1e-9);
    }

    #[test]
    fn remapping_a_group_scales_and_moves_what_it_holds() {
        let mut group = Element::Group(GroupEl {
            base: Base::new("g").place(0.0, 0.0, 200.0, 100.0),
            children: vec![
                boxed("a", 0.0, 0.0, 100.0, 50.0),
                boxed("b", 100.0, 50.0, 100.0, 50.0),
            ],
            extra: Default::default(),
        });
        remap(
            &mut group,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 200.0,
                h: 100.0,
            },
            Rect {
                x: 10.0,
                y: 20.0,
                w: 400.0,
                h: 100.0,
            },
            0.0,
        );
        let kids = group.children();
        assert_eq!(kids[0].base().rect(), Some((10.0, 20.0, 200.0, 50.0)));
        assert_eq!(kids[1].base().rect(), Some((210.0, 70.0, 200.0, 50.0)));
    }

    #[test]
    fn a_connector_follows_the_elements_it_joins() {
        let theme = crate::themes::light();
        let mut slide = Slide::new("s", "blank");
        slide.elements = vec![
            boxed("a", 0.0, 0.0, 100.0, 50.0),
            boxed("b", 300.0, 100.0, 100.0, 50.0),
            Element::Connector(ConnectorEl {
                base: Base::new("k").place(0.0, 0.0, 1.0, 1.0),
                route: Route::Straight,
                from: Some(Anchor {
                    el: "a".into(),
                    side: Side::Right,
                    extra: crate::model::Extra::new(),
                }),
                to: Some(Anchor {
                    el: "b".into(),
                    side: Side::Left,
                    extra: crate::model::Extra::new(),
                }),
                label: None,
                extra: Default::default(),
            }),
        ];
        reroute(&theme, &mut slide);
        assert_eq!(
            slide.elements[2].base().rect(),
            Some((100.0, 25.0, 200.0, 100.0))
        );
        assert!(!slide.elements[2].base().flip_h && !slide.elements[2].base().flip_v);
        // Move b up and to the left of a's right side: the line flips.
        set_rect(
            &mut slide.elements[1],
            Rect {
                x: 50.0,
                y: 0.0,
                w: 10.0,
                h: 10.0,
            },
        );
        reroute(&theme, &mut slide);
        assert!(slide.elements[2].base().flip_h);
    }

    #[test]
    fn union_covers_every_box() {
        let u = union([
            Rect {
                x: 0.0,
                y: 10.0,
                w: 5.0,
                h: 5.0,
            },
            Rect {
                x: 20.0,
                y: 0.0,
                w: 5.0,
                h: 5.0,
            },
        ]);
        assert_eq!(
            u,
            Some(Rect {
                x: 0.0,
                y: 0.0,
                w: 25.0,
                h: 15.0
            })
        );
        assert_eq!(union([]), None);
    }
}
