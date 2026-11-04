//! `p:timing`: the steps of a slide as PowerPoint animations, for a file written with `StepsMode::Animate`.
//!
//! Each click of the slide is one click of the animation sequence. An element that appears at a click comes in with its
//! effect, one that disappears goes out with it, and one that stays and has an effect (pulse, colour, path) draws the eye.
//! Fade, fly, zoom, wipe, pulse, colour and a path map to PowerPoint's own; the rest are written as an appear and the
//! export says so. Dimmed and highlighted steps are not animated in a file.

use slides_core::{Effect, FxKind, FxStart, MotionDirection, Slide, StepFx, StepState};

use crate::color::Color;
use crate::cx::Cx;
use crate::steps::clicks_of;
use crate::xml::Xml;

#[derive(Clone, Copy, PartialEq)]
enum Role {
    Enter,
    Exit,
    Emphasis,
}

struct Event {
    spid: u32,
    element: String,
    fx: StepFx,
    role: Role,
}

/// A counter for the numbers `p:cTn` is given.
struct Counter(u32);

impl Counter {
    fn next(&mut self) -> u32 {
        self.0 += 1;
        self.0
    }
}

fn ms(seconds: f64) -> i64 {
    (seconds.max(0.0) * 1000.0).round() as i64
}

/// The effect the deck uses for a step that names none.
fn deck_effect(cx: &Cx) -> StepFx {
    StepFx::new(
        match cx.deck.present.effect.as_ref().unwrap_or(&Effect::Fade) {
            Effect::None => FxKind::Appear,
            Effect::Fade => FxKind::Fade,
            Effect::FadeUp => FxKind::FadeUp,
            Effect::Grow => FxKind::Grow,
        },
    )
}

/// The side an effect comes from, and PowerPoint's number for it (1 top, 2 right, 4 bottom, 8 left).
fn side(fx: &StepFx) -> (&'static str, u8) {
    match fx.direction.clone().unwrap_or(MotionDirection::Down) {
        MotionDirection::Up => ("up", 1),
        MotionDirection::Right => ("right", 2),
        MotionDirection::Down => ("down", 4),
        MotionDirection::Left => ("left", 8),
    }
}

fn target(spid: u32) -> String {
    format!(r#"<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>"#)
}

/// Sets a shape visible (or hidden) `at` milliseconds into the effect.
fn visibility(n: &mut Counter, spid: u32, value: &str, at: i64) -> String {
    format!(
        r#"<p:set><p:cBhvr><p:cTn id="{}" dur="1" fill="hold"><p:stCondLst><p:cond delay="{at}"/></p:stCondLst></p:cTn>{}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="{value}"/></p:to></p:set>"#,
        n.next(),
        target(spid)
    )
}

/// An animation of one shape property between two values.
fn tween(n: &mut Counter, spid: u32, name: &str, from: &str, to: &str, dur: i64) -> String {
    let value = |v: &str| {
        if v.starts_with('#') || v.contains('+') || v.contains('-') || v.contains('/') {
            format!(r#"<p:strVal val="{v}"/>"#)
        } else {
            format!(r#"<p:fltVal val="{v}"/>"#)
        }
    };
    format!(
        r#"<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="{}" dur="{dur}" fill="hold"/>{}<p:attrNameLst><p:attrName>{name}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val>{}</p:val></p:tav><p:tav tm="100000"><p:val>{}</p:val></p:tav></p:tavLst></p:anim>"#,
        n.next(),
        target(spid),
        value(from),
        value(to)
    )
}

fn filter(n: &mut Counter, spid: u32, name: &str, enter: bool, dur: i64) -> String {
    format!(
        r#"<p:animEffect transition="{}" filter="{name}"><p:cBhvr><p:cTn id="{}" dur="{dur}"/>{}</p:cBhvr></p:animEffect>"#,
        if enter { "in" } else { "out" },
        n.next(),
        target(spid)
    )
}

/// What an effect becomes: PowerPoint's preset number, its class, its subtype, its markup, and whether it had to be an appear.
struct Written {
    preset: u32,
    class: &'static str,
    subtype: u8,
    body: String,
    fell_back: bool,
}

fn write_effect(n: &mut Counter, ev: &Event, width: f64, height: f64) -> Written {
    let spid = ev.spid;
    let fx = &ev.fx;
    let dur = ms(fx.duration.unwrap_or(0.4)).max(1);
    let enter = ev.role != Role::Exit;
    let class = match ev.role {
        Role::Enter => "entr",
        Role::Exit => "exit",
        Role::Emphasis => "emph",
    };
    let shown = if enter { "visible" } else { "hidden" };
    let (name, subtype) = side(fx);
    // An entrance sets the shape visible first; an exit hides it at the end.
    let (first, last) = if enter {
        (visibility(n, spid, "visible", 0), String::new())
    } else {
        (String::new(), visibility(n, spid, shown, dur))
    };
    let wrap = |preset: u32, subtype: u8, body: String, fell_back: bool| Written {
        preset,
        class,
        subtype,
        body: format!("{first}{body}{last}"),
        fell_back,
    };
    match (&fx.kind, ev.role) {
        (FxKind::Pulse, _) => Written {
            preset: 26,
            class: "emph",
            subtype: 0,
            body: format!(
                r#"<p:animScale><p:cBhvr><p:cTn id="{}" dur="{}" autoRev="1" fill="hold"/>{}</p:cBhvr><p:by x="110000" y="110000"/></p:animScale>"#,
                n.next(),
                (dur / 2).max(1),
                target(spid)
            ),
            fell_back: false,
        },
        (FxKind::Colour, _) => {
            let mut c = Xml::fragment();
            if let Some(color) = fx.color.as_deref().and_then(Color::parse) {
                color.write(&mut c, None);
            } else {
                Color::Scheme("accent1").write(&mut c, None);
            }
            Written {
                preset: 7,
                class: "emph",
                subtype: 0,
                body: format!(
                    r#"<p:animClr clrSpc="rgb" dir="cw"><p:cBhvr override="childStyle"><p:cTn id="{}" dur="{dur}" autoRev="1" fill="hold"/>{}<p:attrNameLst><p:attrName>style.color</p:attrName></p:attrNameLst></p:cBhvr><p:to>{}</p:to></p:animClr>"#,
                    n.next(),
                    target(spid),
                    c.into_string()
                ),
                fell_back: false,
            }
        }
        (FxKind::Path, _) => {
            let (dx, dy) = (fx.dx.unwrap_or(0.0) / width, fx.dy.unwrap_or(0.0) / height);
            let body = format!(
                "{}{}",
                tween(n, spid, "ppt_x", &format!("#ppt_x{dx:+.4}"), "#ppt_x", dur),
                tween(n, spid, "ppt_y", &format!("#ppt_y{dy:+.4}"), "#ppt_y", dur)
            );
            wrap(2, 0, body, false)
        }
        (FxKind::Fade, _) => wrap(10, 0, filter(n, spid, "fade", enter, dur), false),
        (FxKind::Wipe, _) => wrap(
            22,
            subtype,
            filter(n, spid, &format!("wipe({name})"), enter, dur),
            false,
        ),
        (FxKind::Zoom, _) => {
            let (from, to) = if enter {
                ("0", "#ppt_w")
            } else {
                ("#ppt_w", "0")
            };
            let (hfrom, hto) = if enter {
                ("0", "#ppt_h")
            } else {
                ("#ppt_h", "0")
            };
            let body = format!(
                "{}{}",
                tween(n, spid, "ppt_w", from, to, dur),
                tween(n, spid, "ppt_h", hfrom, hto, dur)
            );
            wrap(53, 16, body, false)
        }
        (FxKind::Fly, _) => {
            let off = match name {
                "left" => ("0-#ppt_w/2", "#ppt_y"),
                "right" => ("1+#ppt_w/2", "#ppt_y"),
                "up" => ("#ppt_x", "0-#ppt_h/2"),
                _ => ("#ppt_x", "1+#ppt_h/2"),
            };
            let (x_from, x_to, y_from, y_to) = if enter {
                (off.0, "#ppt_x", off.1, "#ppt_y")
            } else {
                ("#ppt_x", off.0, "#ppt_y", off.1)
            };
            let body = format!(
                "{}{}",
                tween(n, spid, "ppt_x", x_from, x_to, dur),
                tween(n, spid, "ppt_y", y_from, y_to, dur)
            );
            wrap(2, subtype, body, false)
        }
        (FxKind::Appear, _) => wrap(1, 0, String::new(), false),
        _ => wrap(1, 0, String::new(), true),
    }
}

/// Every top-level element, with the events of each click.
fn events(cx: &mut Cx, slide: &Slide, click: u32, told: &mut bool) -> Vec<Event> {
    let fallback = deck_effect(cx);
    let mut out = Vec::new();
    for el in &slide.elements {
        let Some(spid) = cx.ids.of(el.id()) else {
            continue;
        };
        let base = el.base();
        let (was, now) = (base.state_at(click - 1), base.state_at(click));
        let (was_hidden, now_hidden) = (was == StepState::Hidden, now == StepState::Hidden);
        let own = base.step_fx.get(&click).cloned();
        let role = match (was_hidden, now_hidden) {
            (true, false) => Role::Enter,
            (false, true) => Role::Exit,
            _ if own.is_some() => Role::Emphasis,
            _ => {
                if was != now && !was_hidden {
                    *told = true;
                }
                continue;
            }
        };
        out.push(Event {
            spid,
            element: el.id().to_owned(),
            fx: own.unwrap_or_else(|| fallback.clone()),
            role,
        });
    }
    out
}

/// One click: its events grouped into the effects that begin together.
fn click(cx: &mut Cx, n: &mut Counter, evs: &[Event], width: f64, height: f64) -> String {
    let mut groups: Vec<(i64, String)> = Vec::new();
    let mut previous_end = 0;
    let mut group_start = 0;
    for (i, ev) in evs.iter().enumerate() {
        let after = i > 0 && ev.fx.start == Some(FxStart::After);
        if i == 0 || after {
            group_start = if i == 0 { 0 } else { previous_end };
            groups.push((group_start, String::new()));
        }
        let node = match (i, after) {
            (0, _) => "clickEffect",
            (_, true) => "afterEffect",
            _ => "withEffect",
        };
        let delay = ms(ev.fx.delay.unwrap_or(0.0));
        let dur = ms(ev.fx.duration.unwrap_or(0.4));
        let w = write_effect(n, ev, width, height);
        if w.fell_back {
            let name = serde_json::to_value(&ev.fx.kind)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();
            cx.element = Some(ev.element.clone());
            cx.warn(format!(
                "the effect `{name}` has no PowerPoint equivalent here and was written as an appear"
            ));
        }
        let cid = n.next();
        let markup = format!(
            r#"<p:par><p:cTn id="{cid}" presetID="{}" presetClass="{}" presetSubtype="{}" fill="hold" nodeType="{node}"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>{}</p:childTnLst></p:cTn></p:par>"#,
            w.preset, w.class, w.subtype, w.body
        );
        if let Some(last) = groups.last_mut() {
            last.1.push_str(&markup);
        }
        previous_end = group_start + delay + dur;
    }
    cx.element = None;
    let mut inner = String::new();
    for (start, markup) in groups {
        inner.push_str(&format!(
            r#"<p:par><p:cTn id="{}" fill="hold"><p:stCondLst><p:cond delay="{start}"/></p:stCondLst><p:childTnLst>{markup}</p:childTnLst></p:cTn></p:par>"#,
            n.next()
        ));
    }
    format!(
        r#"<p:par><p:cTn id="{}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>{inner}</p:childTnLst></p:cTn></p:par>"#,
        n.next()
    )
}

/// Writes the slide's `p:timing`; nothing for a slide with no steps.
pub fn write(x: &mut Xml, cx: &mut Cx, slide: &Slide) {
    let clicks = clicks_of(slide);
    if clicks == 0 {
        return;
    }
    let (width, height) = (cx.deck.size.w.max(1.0), cx.deck.size.h.max(1.0));
    let mut n = Counter(2);
    let mut told = false;
    let mut sequence = String::new();
    for k in 1..=clicks {
        let evs = events(cx, slide, k, &mut told);
        if !evs.is_empty() {
            sequence.push_str(&click(cx, &mut n, &evs, width, height));
        }
    }
    if told {
        cx.warn("dimmed and highlighted steps are not animated in the file; the element stays as it is styled");
    }
    if sequence.is_empty() {
        return;
    }
    x.verbatim(&timing_markup(&sequence));
}

fn timing_markup(sequence: &str) -> String {
    format!(
        r#"<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{sequence}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>"#
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use slides_core::Engine;

    use super::*;
    use crate::testing::{MapMedia, with_deck};

    /// A slide with one box that is hidden until the first click, with `fx` on that click.
    fn deck_with(fx: serde_json::Value) -> (slides_core::Deck, String, String) {
        let mut e = Engine::create("t", "Light", 5).unwrap_or_else(|x| panic!("{x}"));
        let slide = e
            .apply("add_slide", json!({ "layout": "blank" }))
            .unwrap_or_else(|x| panic!("{x}"))
            .output["slide"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let id = e
            .apply(
                "add_elements",
                json!({ "slide": slide, "elements": [{ "type": "shape", "shape": "rect", "x": 10, "y": 10, "w": 100, "h": 50 }] }),
            )
            .unwrap_or_else(|x| panic!("{x}"))
            .output["ids"][0]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        e.apply(
            "set_step_states",
            json!({ "slide": slide, "id": id, "states": { "0": "hidden", "1": "normal" } }),
        )
        .unwrap_or_else(|x| panic!("{x}"));
        e.apply(
            "set_step_fx",
            json!({ "slide": slide, "id": id, "fx": { "1": fx } }),
        )
        .unwrap_or_else(|x| panic!("{x}"));
        (e.into_deck(), slide, id)
    }

    fn timing(fx: serde_json::Value) -> (String, Vec<String>) {
        let (deck, slide_id, _) = deck_with(fx);
        let slide = deck
            .slide(&slide_id)
            .cloned()
            .unwrap_or_else(|| panic!("slide"));
        with_deck(&deck, &MapMedia::default(), |cx| {
            cx.slide = Some(slide.id.clone());
            cx.ids.assign(&slide.elements);
            let mut x = Xml::fragment();
            write(&mut x, cx, &slide);
            (
                x.into_string(),
                cx.shared
                    .warnings
                    .iter()
                    .map(|w| w.message.clone())
                    .collect(),
            )
        })
    }

    #[test]
    fn a_fly_in_is_a_click_effect_that_shows_the_shape_and_moves_it() {
        let (out, warnings) =
            timing(json!({ "kind": "fly", "direction": "left", "duration": 0.5 }));
        assert!(out.contains(r#"presetID="2" presetClass="entr" presetSubtype="8" fill="hold" nodeType="clickEffect""#), "{out}");
        assert!(
            out.contains("<p:attrName>style.visibility</p:attrName>"),
            "{out}"
        );
        assert!(out.contains(r#"<p:strVal val="0-#ppt_w/2"/>"#), "{out}");
        assert!(out.contains(r#"dur="500""#), "{out}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn fade_wipe_and_zoom_map_and_an_effect_with_no_equivalent_is_an_appear_that_is_reported() {
        let (fade, _) = timing(json!({ "kind": "fade" }));
        assert!(
            fade.contains(r#"<p:animEffect transition="in" filter="fade">"#),
            "{fade}"
        );
        let (wipe, _) = timing(json!({ "kind": "wipe", "direction": "up" }));
        assert!(wipe.contains(r#"filter="wipe(up)""#), "{wipe}");
        let (zoom, _) = timing(json!({ "kind": "zoom" }));
        assert!(zoom.contains("<p:attrName>ppt_w</p:attrName>"), "{zoom}");
        let (pop, warnings) = timing(json!({ "kind": "pop" }));
        assert!(pop.contains(r#"presetID="1" presetClass="entr""#), "{pop}");
        assert!(
            warnings
                .iter()
                .any(|w| w.contains("pop") && w.contains("appear")),
            "{warnings:?}"
        );
    }

    #[test]
    fn a_path_comes_in_from_its_offset_as_a_fraction_of_the_slide() {
        let (out, _) = timing(json!({ "kind": "path", "dx": 96, "dy": -54 }));
        assert!(
            out.contains(r##"<p:strVal val="#ppt_x+0.1000"/>"##),
            "{out}"
        );
        assert!(
            out.contains(r##"<p:strVal val="#ppt_y-0.1000"/>"##),
            "{out}"
        );
    }

    #[test]
    fn a_slide_without_steps_has_no_timing() {
        let (deck, slide_id, _) = deck_with(json!({ "kind": "fade" }));
        let mut slide = deck
            .slide(&slide_id)
            .cloned()
            .unwrap_or_else(|| panic!("slide"));
        slide.steps = 0;
        let out = with_deck(&deck, &MapMedia::default(), |cx| {
            let mut x = Xml::fragment();
            write(&mut x, cx, &slide);
            x.into_string()
        });
        assert!(out.is_empty());
    }
}
