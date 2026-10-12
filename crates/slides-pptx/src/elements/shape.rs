//! Text boxes and shapes: a `p:sp` with a preset geometry, its fill, outline and
//! shadow, and the text inside. A text box is a rectangle that says it is one,
//! and one that fills a layout's slot also says which.

use slides_core::{Base, PlaceholderDef, ShapeEl, Text, TextEl, VAlign};

use super::Site;
use super::common::{Frame, name_of, write_c_nv_pr, write_xfrm};
use super::presets::is_preset;
use crate::cx::Cx;
use crate::style::{write_effects, write_fill, write_line};
use crate::text::{self, Look};
use crate::units::thousandths;
use crate::xml::Xml;

/// The slot of the layout an element names, whether or not it fits the element's kind.
pub fn slot<'a>(cx: &'a Cx, base: &Base) -> Option<&'a PlaceholderDef> {
    let role = base.placeholder.as_deref()?;
    cx.deck.theme.layout(&cx.layout)?.placeholder(role)
}

/// The share of the shorter side a corner radius takes, as PowerPoint's adjust value.
pub(super) fn corner(radius: f64, frame: &Frame) -> i64 {
    let side = frame.rect.w.min(frame.rect.h);
    if side <= 0.0 {
        return 0;
    }
    thousandths(radius / side).clamp(0, 50_000)
}

/// The adjustments a preset is given: only the corner radius of a rounded one.
fn adjust(shape: &str, radius: Option<f64>, frame: &Frame) -> Vec<(&'static str, i64)> {
    match (shape, radius) {
        ("roundRect", Some(r)) => vec![("adj", corner(r, frame))],
        ("wedgeRoundRectCallout", Some(r)) => vec![("adj3", corner(r, frame))],
        _ => Vec::new(),
    }
}

/// The room the text of a preset shape has: the part of its box the words are set in.
fn text_area(shape: &str, radius: Option<f64>, frame: &Frame) -> (f64, f64) {
    let (w, h) = (frame.rect.w, frame.rect.h);
    let room = slides_core::lint::estimate::room(shape, w, h, radius);
    (
        (w * room.across - room.pad).max(1.0),
        (h * room.down - room.pad).max(1.0),
    )
}

struct Sp<'a> {
    base: &'a Base,
    site: &'a Site,
    label: &'a str,
    text_box: bool,
    geometry: &'a str,
    adjust: Vec<(&'static str, i64)>,
    text: Option<(&'a Text, Look<'a>)>,
}

fn write_sp(x: &mut Xml, cx: &mut Cx, sp: Sp) {
    let Site {
        id,
        frame,
        opacity,
        ph,
    } = sp.site;
    let name = match ph {
        Some(ph) if sp.base.name.is_none() => name_of(sp.base, ph.label(), *id),
        _ => name_of(sp.base, sp.label, *id),
    };
    x.open("p:sp");
    x.open("p:nvSpPr");
    write_c_nv_pr(x, cx, *id, &name, sp.base);
    x.open("p:cNvSpPr");
    if sp.text_box && ph.is_none() {
        x.attr("txBox", "1");
    }
    if ph.is_some() {
        x.open("a:spLocks").attr("noGrp", "1").close();
    }
    x.close();
    x.open("p:nvPr");
    if cx.master && ph.is_none() {
        x.attr("userDrawn", "1");
    }
    if let Some(ph) = ph {
        ph.write(x);
    }
    x.close();
    x.close();

    x.open("p:spPr");
    write_xfrm(x, "a:xfrm", frame);
    x.open("a:prstGeom").attr("prst", sp.geometry);
    x.open("a:avLst");
    for (name, value) in &sp.adjust {
        x.open("a:gd")
            .attr("name", name)
            .attr("fmla", &format!("val {value}"))
            .close();
    }
    x.close();
    x.close();
    write_fill(x, cx, sp.base.style.as_ref(), *opacity);
    write_line(x, cx, sp.base.style.as_ref(), *opacity, false, false);
    write_effects(x, cx, sp.base.style.as_ref(), *opacity);
    x.close();

    if let Some((text, look)) = &sp.text {
        text::write_body(x, cx, "p:txBody", text, look);
    }
    x.close();
}

/// A text box, or the text of a slot on the layout.
pub fn write_text(x: &mut Xml, cx: &mut Cx, el: &TextEl, site: &Site) {
    let slot = slot(cx, &el.base);
    let style = slot
        .and_then(|s| s.style.clone())
        .unwrap_or_else(|| "body".to_owned());
    let valign = slot.and_then(|s| s.valign.clone()).unwrap_or(VAlign::Top);
    let radius = el
        .base
        .style
        .as_ref()
        .and_then(|s| s.radius)
        .filter(|r| *r > 0.0);
    let geometry = if radius.is_some() {
        "roundRect"
    } else {
        "rect"
    };
    write_sp(
        x,
        cx,
        Sp {
            base: &el.base,
            site,
            label: "TextBox",
            text_box: true,
            geometry,
            adjust: adjust(geometry, radius, &site.frame),
            text: Some((
                &el.text,
                Look {
                    style: &style,
                    valign,
                    wrap: true,
                    opacity: site.opacity,
                    flipped: site.frame.flip_v,
                    area: Some((site.frame.rect.w, site.frame.rect.h)),
                },
            )),
        },
    );
}

/// A preset shape with its text, centred in the shape unless the text says otherwise.
pub fn write_shape(x: &mut Xml, cx: &mut Cx, el: &ShapeEl, site: &Site) {
    let slot = slot(cx, &el.base);
    let style = slot
        .and_then(|s| s.style.clone())
        .unwrap_or_else(|| "body".to_owned());
    let valign = slot
        .and_then(|s| s.valign.clone())
        .unwrap_or(VAlign::Middle);
    let geometry = if is_preset(&el.shape) {
        el.shape.as_str()
    } else {
        cx.warn(format!(
            "`{}` is not a shape PowerPoint has; it is drawn as a rectangle",
            el.shape
        ));
        "rect"
    };
    let radius = el.base.style.as_ref().and_then(|s| s.radius);
    write_sp(
        x,
        cx,
        Sp {
            base: &el.base,
            site: &Site { ph: None, ..*site },
            label: "Shape",
            text_box: false,
            geometry,
            adjust: adjust(geometry, radius, &site.frame),
            text: el.text.as_ref().map(|t| {
                (
                    t,
                    Look {
                        style: &style,
                        valign,
                        wrap: true,
                        opacity: site.opacity,
                        flipped: site.frame.flip_v,
                        area: Some(text_area(&el.shape, radius, &site.frame)),
                    },
                )
            }),
        },
    );
}

#[cfg(test)]
mod tests {
    use slides_core::{Base, Element, Fill, Style, Text};

    use super::*;
    use crate::elements::xml_of;
    use crate::testing::{deck, with_cx, with_deck};

    #[test]
    fn a_text_box_is_a_rectangle_that_says_it_is_one() {
        let el = Element::text_el(
            Base::new("e-1").place(10.0, 20.0, 300.0, 40.0),
            Text::plain("Hi"),
        );
        let out = with_cx(|cx| xml_of(cx, &el));
        assert!(
            out.starts_with(concat!(
                r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="TextBox 2"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>"#,
                r#"<p:spPr><a:xfrm><a:off x="95250" y="190500"/><a:ext cx="2857500" cy="381000"/></a:xfrm>"#,
                r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>"#,
                r#"<p:txBody><a:bodyPr wrap="square""#
            )),
            "{out}"
        );
        assert!(out.ends_with("</p:txBody></p:sp>"), "{out}");
    }

    #[test]
    fn a_text_box_with_a_style_and_a_radius_is_a_rounded_rectangle_with_its_fill() {
        let mut base = Base::new("e-1").place(0.0, 0.0, 200.0, 100.0);
        base.style = Some(Style {
            fill: Some(Fill {
                color: "bg2".into(),
                alpha: None,
                extra: slides_core::Extra::new(),
            }),
            radius: Some(20.0),
            ..Style::default()
        });
        let el = Element::text_el(base, Text::plain("x"));
        let out = with_cx(|cx| xml_of(cx, &el));
        assert!(
            out.contains(r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom><a:solidFill><a:schemeClr val="bg2"/>"#),
            "{out}"
        );
    }

    #[test]
    fn the_corner_radius_is_a_share_of_the_shorter_side_and_stops_at_half() {
        let frame = |w, h| Frame {
            rect: slides_core::resolve::Rect {
                x: 0.0,
                y: 0.0,
                w,
                h,
            },
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
        };
        assert_eq!(corner(10.0, &frame(200.0, 100.0)), 10_000);
        assert_eq!(corner(500.0, &frame(200.0, 100.0)), 50_000);
        assert_eq!(corner(5.0, &frame(0.0, 0.0)), 0);
    }

    #[test]
    fn a_shape_centres_its_text_and_takes_the_preset_by_name() {
        let el = Element::shape(
            Base::new("e-2").place(0.0, 0.0, 160.0, 90.0),
            "roundRect",
            Some(Text::plain("LLM")),
        );
        let out = with_cx(|cx| xml_of(cx, &el));
        assert!(
            out.contains(r#"<p:cNvPr id="2" name="Shape 2"/><p:cNvSpPr/>"#),
            "{out}"
        );
        assert!(
            out.contains(r#"<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>"#),
            "{out}"
        );
        assert!(out.contains(r#"anchor="ctr""#), "{out}");
    }

    #[test]
    fn an_unknown_preset_is_a_rectangle_and_is_reported() {
        let el = Element::shape(Base::new("e-3").place(0.0, 0.0, 10.0, 10.0), "circle", None);
        let (out, warnings) = with_cx(|cx| (xml_of(cx, &el), cx.shared.warnings.clone()));
        assert!(
            out.contains(r#"prst="rect""#) && !out.contains("txBody"),
            "{out}"
        );
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].message.contains("circle"));
        assert_eq!(warnings[0].element.as_deref(), Some("e-3"));
    }

    #[test]
    fn a_text_box_that_fills_a_slot_says_so_and_keeps_the_slots_look() {
        let deck = deck();
        let title = deck.slides[0]
            .elements
            .iter()
            .find(|e| e.base().placeholder.as_deref() == Some("title"))
            .cloned()
            .unwrap_or_else(|| panic!("a title"));
        let out = with_deck(&deck, &Default::default(), |cx| {
            cx.layout = "title".into();
            xml_of(cx, &title)
        });
        assert!(
            out.starts_with(concat!(
                r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>"#,
                r#"<p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600""#
            )),
            "{out}"
        );
        assert!(
            out.contains(r#"anchor="b""#),
            "the slot's own alignment: {out}"
        );
        assert!(
            out.contains(r#"sz="4400" b="1""#),
            "the slot's style: {out}"
        );
    }

    #[test]
    fn rotation_and_mirroring_go_on_the_frame() {
        let mut base = Base::new("e-4").place(0.0, 0.0, 10.0, 10.0);
        base.rotation = Some(30.0);
        base.flip_h = true;
        let el = Element::shape(base, "rightArrow", None);
        let out = with_cx(|cx| xml_of(cx, &el));
        assert!(out.contains(r#"<a:xfrm rot="1800000" flipH="1">"#), "{out}");
    }
}
