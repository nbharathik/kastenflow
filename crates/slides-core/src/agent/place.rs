//! `place_image`: a picture from the store on a slide, in a slot, in a box, or
//! in the largest free space, always at its own proportions.

use serde_json::{Value, json};

use super::edit::apply_all;
use super::images;
use super::read::slide_id;
use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolResult};
use crate::lint::estimate::text_size;
use crate::lint::is_blank;
use crate::model::{Deck, Element, PageSource, Slide, VAlign};
use crate::resolve::placeholder_of;
use crate::resolve::{Rect, box_in};

/// A picture is never placed smaller than this, either way.
const LEAST: f64 = 60.0;
/// Room kept between a picture placed in free space and what is round it.
const BREATHING: f64 = 12.0;
const SIDE: f64 = 64.0;
const FOOT: f64 = 48.0;
const BELOW_TITLE: f64 = 16.0;

/// The largest box of the proportions `aspect` (width over height) that fits in `area`, centred in it.
pub fn fit(aspect: f64, area: Rect) -> Rect {
    let (mut w, mut h) = (area.w, area.w / aspect);
    if h > area.h {
        h = area.h;
        w = h * aspect;
    }
    let round = |v: f64| (v * 100.0).round() / 100.0;
    Rect {
        x: round(area.x + (area.w - w) / 2.0),
        y: round(area.y + (area.h - h) / 2.0),
        w: round(w),
        h: round(h),
    }
}

/// The area of the picture that fits.
fn fitted_area(aspect: f64, w: f64, h: f64) -> f64 {
    let f = fit(
        aspect,
        Rect {
            x: 0.0,
            y: 0.0,
            w,
            h,
        },
    );
    f.w * f.h
}

/// The free space with the most room for a picture of these proportions: inside `bounds`, clear of `obstacles`.
pub fn free_space(aspect: f64, bounds: Rect, obstacles: &[Rect]) -> Option<Rect> {
    let mut xs = vec![bounds.x, bounds.x + bounds.w];
    for o in obstacles {
        xs.extend([o.x, o.x + o.w]);
    }
    xs.retain(|x| *x >= bounds.x && *x <= bounds.x + bounds.w);
    xs.sort_by(f64::total_cmp);
    xs.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
    let mut best: Option<(f64, Rect)> = None;
    for (i, &left) in xs.iter().enumerate() {
        for &right in &xs[i + 1..] {
            if right - left < LEAST {
                continue;
            }
            // What stands in the way between these two edges, top to bottom.
            let mut blocks: Vec<(f64, f64)> = obstacles
                .iter()
                .filter(|o| o.x < right - 1e-6 && o.x + o.w > left + 1e-6)
                .map(|o| (o.y.max(bounds.y), (o.y + o.h).min(bounds.y + bounds.h)))
                .filter(|(a, b)| b > a)
                .collect();
            blocks.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut top = bounds.y;
            let mut gaps = Vec::new();
            for (from, to) in blocks {
                if from > top {
                    gaps.push((top, from));
                }
                top = top.max(to);
            }
            if top < bounds.y + bounds.h {
                gaps.push((top, bounds.y + bounds.h));
            }
            for (from, to) in gaps {
                if to - from < LEAST {
                    continue;
                }
                let area = fitted_area(aspect, right - left, to - from);
                let space = Rect {
                    x: left,
                    y: from,
                    w: right - left,
                    h: to - from,
                };
                let better = match &best {
                    None => true,
                    Some((a, r)) => {
                        area > a + 1e-6
                            || ((area - a).abs() <= 1e-6 && (space.y, space.x) < (r.y, r.x))
                    }
                };
                if better {
                    best = Some((area, space));
                }
            }
        }
    }
    best.map(|(_, space)| fit(aspect, space))
        .filter(|r| r.w >= LEAST && r.h >= LEAST)
}

/// The area of a slide a picture may take: inside the margins and under the title.
fn bounds_of(deck: &Deck, slide: &Slide) -> Rect {
    let title = slide
        .elements
        .iter()
        .find(|e| e.base().placeholder.as_deref() == Some("title"))
        .and_then(|e| box_in(&deck.theme, &slide.layout, e));
    let top = title.map_or(FOOT, |t| t.y + t.h + BELOW_TITLE);
    Rect {
        x: SIDE,
        y: top,
        w: deck.size.w - 2.0 * SIDE,
        h: deck.size.h - FOOT - top,
    }
}

/// The part of a text box the words take: a box is mostly empty when it holds a few lines.
fn text_extent(deck: &Deck, slide: &Slide, element: &Element, r: Rect) -> Option<Rect> {
    let Element::Text(t) = element else {
        return Some(r);
    };
    if is_blank(&t.text) {
        return None;
    }
    let slot = placeholder_of(&deck.theme, slide, element);
    let base = slot
        .and_then(|s| s.style.clone())
        .unwrap_or_else(|| "body".to_owned());
    let needs = text_size(&deck.theme, &base, &t.text, r.w).height.min(r.h);
    let valign = t
        .text
        .valign
        .clone()
        .or_else(|| slot.and_then(|s| s.valign.clone()))
        .unwrap_or(VAlign::Top);
    let y = match valign {
        VAlign::Top => r.y,
        VAlign::Middle => r.y + (r.h - needs) / 2.0,
        VAlign::Bottom => r.y + r.h - needs,
    };
    Some(Rect {
        x: r.x,
        y,
        w: r.w,
        h: needs,
    })
}

/// What is in the way of a picture on a slide: every element's box, except that a text box takes only the room its words do, and a picture covering the whole slide is a background.
fn obstacles_of(deck: &Deck, slide: &Slide) -> Vec<Rect> {
    let whole = deck.size.w * deck.size.h;
    slide
        .elements
        .iter()
        .filter(|e| !matches!(e, Element::Line(_) | Element::Connector(_)))
        .filter(|e| {
            !(e.base().placeholder.is_some()
                && matches!(e, Element::Image(i) if i.src.trim().is_empty()))
        })
        .filter_map(|e| {
            box_in(&deck.theme, &slide.layout, e).and_then(|r| text_extent(deck, slide, e, r))
        })
        .filter(|r| r.w * r.h < 0.9 * whole)
        .map(|r| Rect {
            x: r.x - BREATHING,
            y: r.y - BREATHING,
            w: r.w + 2.0 * BREATHING,
            h: r.h + 2.0 * BREATHING,
        })
        .collect()
}

fn number(v: &Value, key: &str) -> Result<f64, ToolError> {
    v.get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .ok_or_else(|| {
            ToolError::new(format!(
                "`box` needs x, y, w and h as numbers; `{key}` is missing."
            ))
        })
}

pub fn place_image(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    place_image_with(agent, store, args, None)
}

/// `place_image`, and with a `generator` block (a code picture's program) the picture carries it in
/// the same change, so one undo takes the picture and its program away together.
pub(super) fn place_image_with(
    agent: &mut Agent,
    store: &mut dyn Store,
    args: &Value,
    generator: Option<&Value>,
) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let src = args.get("src").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).ok_or_else(|| ToolError::new("`src` is the picture's path, such as `assets/figure.png`; search_assets lists the pictures and add_asset adds one."))?;
    let bytes = store.read_asset(src).map_err(|_| ToolError::new(format!("There is no picture `{src}`. search_assets lists the pictures there are; add_asset puts a new one in the store.")))?;
    let (pw, ph) = images::dimensions(&bytes).ok_or_else(|| {
        ToolError::new(format!(
            "`{src}` is not a picture this tool can read the size of (PNG, JPEG, GIF, WebP or SVG)."
        ))
    })?;
    let aspect = f64::from(pw) / f64::from(ph);
    let alt = args.get("alt").and_then(Value::as_str).map(str::to_owned);
    // `place_diagram` says which diagram the picture was drawn from, so the picture remembers it.
    let source = args
        .get("diagram")
        .and_then(Value::as_str)
        .filter(|d| !d.is_empty())
        .and_then(|path| {
            let hash = args
                .get("diagramHash")
                .and_then(Value::as_str)
                .map(str::to_owned);
            serde_json::to_value(PageSource::of_diagram(path, hash)).ok()
        });
    let edited = agent.edit(store, &name, None, |engine| {
        let slide_key = slide_id(engine.deck(), args.get("slide").unwrap_or(&Value::Null))?;
        let deck = engine.deck();
        let slide = deck.slide(&slide_key).ok_or_else(|| ToolError::new("That slide is not in the deck."))?;
        let requested = args.get("placeholder").and_then(Value::as_str);
        let by_id = args.get("id").and_then(Value::as_str);
        let empty_slot = slide.elements.iter().find(|e| matches!(e, Element::Image(i) if i.src.trim().is_empty() && e.base().placeholder.is_some()));
        let (mode, target, existing): (&str, Rect, Option<String>) = if let Some(b) = args.get("box").filter(|b| b.is_object()) {
            let area = Rect { x: number(b, "x")?, y: number(b, "y")?, w: number(b, "w")?, h: number(b, "h")? };
            if area.w < LEAST || area.h < LEAST {
                return Err(ToolError::new(format!("The box must be at least {LEAST} units each way.")));
            }
            ("box", area, by_id.map(str::to_owned))
        } else if args.get("auto").and_then(Value::as_bool) == Some(true) {
            let bounds = bounds_of(deck, slide);
            let free = free_space(aspect, bounds, &obstacles_of(deck, slide)).ok_or_else(|| ToolError::new("There is no free space on this slide big enough for the picture. Give a `box`, or make room by moving or resizing what is there."))?;
            ("auto", free, by_id.map(str::to_owned))
        } else {
            let slot = match (requested, by_id) {
                (Some(role), _) => slide.elements.iter().find(|e| e.base().placeholder.as_deref() == Some(role)),
                (None, Some(id)) => slide.element(id),
                (None, None) => empty_slot,
            };
            let slot = slot.ok_or_else(|| ToolError::new("Say where the picture goes: `placeholder` (a slot of the layout), `box` ({x, y, w, h}), or `auto` (the largest free space). This slide has no empty picture slot."))?;
            if !matches!(slot, Element::Image(_)) {
                return Err(ToolError::new(format!("`{}` is a {}, not a picture slot.", slot.id(), slot.kind())));
            }
            let area = box_in(&deck.theme, &slide.layout, slot).ok_or_else(|| ToolError::new("That slot has no position."))?;
            ("placeholder", area, Some(slot.id().to_owned()))
        };
        let placed = fit(aspect, target);
        let mut patch = json!({ "src": src });
        if let Some(alt) = &alt {
            patch["alt"] = json!(alt);
        }
        if let Some(block) = generator {
            patch["generator"] = block.clone();
        }
        if let Some(source) = &source {
            patch["source"] = source.clone();
        }
        let (operations, element) = match existing {
            Some(id) => (
                vec![
                    ("patch_elements".to_owned(), json!({ "slide": slide_key, "patches": [{ "id": id, "patch": patch }] })),
                    ("transform_elements".to_owned(), json!({ "slide": slide_key, "items": [{ "id": id, "x": placed.x, "y": placed.y, "w": placed.w, "h": placed.h }] })),
                ],
                Some(id),
            ),
            None => {
                let mut image = json!({ "type": "image", "src": src, "x": placed.x, "y": placed.y, "w": placed.w, "h": placed.h });
                if let Some(alt) = &alt {
                    image["alt"] = json!(alt);
                }
                if let Some(block) = generator {
                    image["generator"] = block.clone();
                }
                if let Some(source) = &source {
                    image["source"] = source.clone();
                }
                (vec![("add_elements".to_owned(), json!({ "slide": slide_key, "elements": [image] }))], None)
            }
        };
        let results = apply_all(engine, operations)?;
        let element = element.or_else(|| results.first().and_then(|r| r["ids"][0].as_str().map(str::to_owned)));
        Ok(json!({ "element": element, "mode": mode, "box": { "x": placed.x, "y": placed.y, "w": placed.w, "h": placed.h }, "picture": { "width": pw, "height": ph } }))
    })?;
    agent.answer(store, &edited, json!({}))
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: fn(f64, f64, f64, f64) -> Rect = |x, y, w, h| Rect { x, y, w, h };

    #[test]
    fn a_picture_is_fitted_to_its_proportions_and_centred() {
        let wide = fit(2.0, R(0.0, 0.0, 400.0, 400.0));
        assert_eq!((wide.w, wide.h, wide.x, wide.y), (400.0, 200.0, 0.0, 100.0));
        let tall = fit(0.5, R(10.0, 10.0, 400.0, 200.0));
        assert_eq!(
            (tall.w, tall.h, tall.x, tall.y),
            (100.0, 200.0, 160.0, 10.0)
        );
    }

    #[test]
    fn free_space_is_the_biggest_place_that_avoids_everything() {
        let bounds = R(0.0, 0.0, 800.0, 400.0);
        // A wide box across the top left leaves the right and the bottom.
        let found = free_space(1.0, bounds, &[R(0.0, 0.0, 500.0, 200.0)]).unwrap();
        assert!(found.x >= 500.0 || found.y >= 200.0, "{found:?}");
        assert!(found.w >= 200.0 - 1e-6, "{found:?}");
        // With nothing in the way it is the whole area, fitted.
        assert_eq!(
            free_space(2.0, bounds, &[]),
            Some(R(0.0, 0.0, 800.0, 400.0))
        );
        // Nothing left.
        assert_eq!(
            free_space(1.0, R(0.0, 0.0, 100.0, 100.0), &[R(0.0, 0.0, 100.0, 60.0)]),
            None
        );
    }

    #[test]
    fn the_same_obstacles_always_give_the_same_place() {
        let bounds = R(64.0, 148.0, 832.0, 344.0);
        let obstacles = [R(64.0, 148.0, 300.0, 344.0), R(600.0, 300.0, 200.0, 100.0)];
        assert_eq!(
            free_space(1.5, bounds, &obstacles),
            free_space(1.5, bounds, &obstacles)
        );
    }
}
