//! How an element looks apart from its text: fill, outline, arrowheads and
//! shadow, written in the order the schema fixes (fill, outline, effects).

use slides_core::{Arrow, Dash, Style};

use crate::cx::Cx;
use crate::units::{angle, length, thousandths};
use crate::xml::Xml;

/// The outline of a line with none of its own, so that it is never invisible.
/// The editor draws the same.
pub const FALLBACK_WIDTH: f64 = 1.5;
/// How thick an outline is when the deck names a colour and no width: one unit.
pub const DEFAULT_WIDTH: f64 = 1.0;
/// The thickest outline PowerPoint reads: 1584 points, in EMU.
const MOST_WIDTH: i64 = 20_116_800;

/// A see-through amount from a fill's alpha and the element's opacity; None when solid.
pub fn combined(alpha: Option<f64>, opacity: f64) -> Option<f64> {
    let value = (alpha.unwrap_or(1.0) * opacity).clamp(0.0, 1.0);
    (value < 1.0).then_some(value)
}

/// A gradient fill: its colours by position, then the line they blend along or the circle they spread in.
fn write_gradient(x: &mut Xml, cx: &mut Cx, gradient: &slides_core::Gradient, opacity: f64) {
    x.open("a:gradFill").attr("rotWithShape", "1");
    x.open("a:gsLst");
    for stop in &gradient.stops {
        x.open("a:gs")
            .int("pos", thousandths(stop.pos.clamp(0.0, 1.0)));
        let color = cx.color(&stop.color);
        color.write(x, combined(stop.alpha, opacity));
        x.close();
    }
    x.close();
    match gradient.kind {
        slides_core::GradientKind::Linear => {
            x.open("a:lin")
                .int("ang", angle(gradient.angle.unwrap_or(90.0)))
                .attr("scaled", "0")
                .close();
        }
        slides_core::GradientKind::Radial => {
            x.open("a:path").attr("path", "circle");
            x.open("a:fillToRect")
                .int("l", 50_000)
                .int("t", 50_000)
                .int("r", 50_000)
                .int("b", 50_000)
                .close();
            x.close();
        }
    }
    x.close();
}

/// The fill of a shape: a gradient, a solid colour, or none when the style names none.
pub fn write_fill(x: &mut Xml, cx: &mut Cx, style: Option<&Style>, opacity: f64) {
    if let Some(gradient) = style
        .and_then(|s| s.gradient.as_ref())
        .and_then(slides_core::Gradient::tidy)
    {
        write_gradient(x, cx, &gradient, opacity);
        return;
    }
    match style.and_then(|s| s.fill.as_ref()) {
        Some(fill) => {
            let color = cx.color(&fill.color);
            color.solid_fill(x, combined(fill.alpha, opacity));
        }
        None => {
            x.open("a:noFill").close();
        }
    }
}

fn dash(d: &Dash) -> &'static str {
    match d {
        Dash::Solid => "solid",
        Dash::Dash => "dash",
        // The editor draws a dot as one unit on and three off, which is PowerPoint's `dot`.
        Dash::Dot => "dot",
        Dash::DashDot => "dashDot",
        Dash::LongDash => "lgDash",
    }
}

fn head(kind: &Arrow) -> Option<&'static str> {
    match kind {
        Arrow::None => None,
        Arrow::Triangle => Some("triangle"),
        Arrow::Stealth => Some("stealth"),
        Arrow::Open => Some("arrow"),
        Arrow::Oval => Some("oval"),
        Arrow::Diamond => Some("diamond"),
    }
}

/// PowerPoint sizes an arrowhead as small, medium or large (two, three or five
/// line widths). The editor draws it three widths long and at least 8 units, so
/// the nearest of the three is chosen.
fn head_size(width: f64) -> &'static str {
    if width <= 0.0 {
        return "med";
    }
    let ratio = (3.0 * width).max(8.0) / width;
    if ratio >= 4.0 {
        "lg"
    } else if ratio >= 2.5 {
        "med"
    } else {
        "sm"
    }
}

/// An outline: `a:ln` with colour, dash, join and, for a line, the arrowheads.
/// `fallback` is drawn when the style names no outline (a line must show).
pub fn write_line(
    x: &mut Xml,
    cx: &mut Cx,
    style: Option<&Style>,
    opacity: f64,
    arrows: bool,
    fallback: bool,
) {
    let stroke = style.and_then(|s| s.stroke.as_ref());
    let (color, width, alpha, pattern) = match stroke {
        Some(s) => (
            s.color.clone(),
            s.width.unwrap_or(DEFAULT_WIDTH).max(0.0),
            s.alpha,
            s.dash.as_ref(),
        ),
        None if fallback => ("text1".to_owned(), FALLBACK_WIDTH, None, None),
        None => (String::new(), 0.0, None, None),
    };
    if width <= 0.0 {
        x.open("a:ln");
        x.open("a:noFill").close();
        x.close();
        return;
    }
    x.open("a:ln")
        .int("w", length(width).min(MOST_WIDTH))
        .attr("cap", "flat")
        .attr("cmpd", "sng");
    cx.color(&color).solid_fill(x, combined(alpha, opacity));
    x.open("a:prstDash")
        .attr("val", pattern.map_or("solid", dash))
        .close();
    x.open("a:round").close();
    if arrows {
        let size = head_size(width);
        for (tag, kind) in [
            ("a:headEnd", style.and_then(|s| s.start_arrow.as_ref())),
            ("a:tailEnd", style.and_then(|s| s.end_arrow.as_ref())),
        ] {
            if let Some(name) = kind.and_then(head) {
                x.open(tag)
                    .attr("type", name)
                    .attr("w", size)
                    .attr("len", size)
                    .close();
            }
        }
    }
    x.close();
}

/// The shadow of an element, as `a:effectLst`. The editor's blur is the spread
/// of a Gaussian, which PowerPoint's blur radius is twice of.
pub fn write_effects(x: &mut Xml, cx: &mut Cx, style: Option<&Style>, opacity: f64) {
    let Some(shadow) = style.and_then(|s| s.shadow.as_ref()) else {
        return;
    };
    let color = cx.color(&shadow.color);
    x.open("a:effectLst");
    x.open("a:outerShdw")
        .int("blurRad", length(2.0 * shadow.blur.max(0.0)))
        .int("dist", length(shadow.dx.hypot(shadow.dy)))
        .int("dir", angle(shadow.dy.atan2(shadow.dx).to_degrees()))
        .attr("algn", "ctr")
        .attr("rotWithShape", "0");
    color.write(x, combined(shadow.alpha, opacity));
    x.close();
    x.close();
}

#[cfg(test)]
mod tests {
    use slides_core::{Fill, Shadow, Stroke};

    use super::*;
    use crate::testing::with_cx;

    fn stroke(color: &str, width: Option<f64>) -> Stroke {
        Stroke {
            color: color.into(),
            width,
            dash: None,
            alpha: None,
            extra: slides_core::Extra::new(),
        }
    }

    fn styled(style: &Style, opacity: f64, arrows: bool, fallback: bool) -> String {
        with_cx(|cx| {
            let mut x = Xml::fragment();
            write_fill(&mut x, cx, Some(style), opacity);
            write_line(&mut x, cx, Some(style), opacity, arrows, fallback);
            write_effects(&mut x, cx, Some(style), opacity);
            x.into_string()
        })
    }

    #[test]
    fn a_gradient_is_written_with_its_stops_in_order_and_its_angle() {
        let style = Style {
            fill: Some(Fill {
                color: "accent1".into(),
                alpha: None,
                extra: slides_core::Extra::new(),
            }),
            gradient: Some(slides_core::Gradient::linear(
                45.0,
                vec![
                    slides_core::GradientStop::new(1.0, "#ffffff"),
                    slides_core::GradientStop::new(0.0, "accent1"),
                ],
            )),
            ..Style::default()
        };
        let out = styled(&style, 1.0, false, false);
        assert!(
            out.starts_with(r#"<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>"#),
            "{out}"
        );
    }

    #[test]
    fn a_radial_gradient_spreads_from_the_middle() {
        let mut gradient = slides_core::Gradient::linear(
            0.0,
            vec![
                slides_core::GradientStop::new(0.0, "accent1"),
                slides_core::GradientStop::new(1.0, "accent2"),
            ],
        );
        gradient.kind = slides_core::GradientKind::Radial;
        let style = Style {
            gradient: Some(gradient),
            ..Style::default()
        };
        let out = styled(&style, 1.0, false, false);
        assert!(out.contains(r#"<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>"#), "{out}");
    }

    #[test]
    fn no_fill_and_no_outline_are_written_as_none() {
        assert_eq!(
            styled(&Style::default(), 1.0, false, false),
            "<a:noFill/><a:ln><a:noFill/></a:ln>"
        );
    }

    #[test]
    fn a_fill_is_a_solid_colour_with_its_alpha_and_the_elements_opacity() {
        let style = Style {
            fill: Some(Fill {
                color: "accent2".into(),
                alpha: Some(0.5),
                extra: slides_core::Extra::new(),
            }),
            ..Style::default()
        };
        assert!(styled(&style, 1.0, false, false).starts_with(
            r#"<a:solidFill><a:schemeClr val="accent2"><a:alpha val="50000"/></a:schemeClr></a:solidFill>"#
        ));
        assert!(styled(&style, 0.5, false, false).starts_with(
            r#"<a:solidFill><a:schemeClr val="accent2"><a:alpha val="25000"/></a:schemeClr></a:solidFill>"#
        ));
    }

    #[test]
    fn an_outline_is_in_emu_with_a_dash_and_a_round_join() {
        let style = Style {
            stroke: Some(Stroke {
                dash: Some(Dash::LongDash),
                ..stroke("#ff0000", Some(2.0))
            }),
            ..Style::default()
        };
        assert_eq!(
            styled(&style, 1.0, false, false),
            concat!(
                r#"<a:noFill/><a:ln w="19050" cap="flat" cmpd="sng"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>"#,
                r#"<a:prstDash val="lgDash"/><a:round/></a:ln>"#
            )
        );
    }

    #[test]
    fn an_outline_never_gets_thicker_than_powerpoint_reads() {
        for width in [5000.0, 1e9, f64::INFINITY] {
            let style = Style {
                stroke: Some(stroke("text1", Some(width))),
                ..Style::default()
            };
            assert!(
                styled(&style, 1.0, false, false).contains(r#"<a:ln w="20116800""#),
                "{width}"
            );
        }
    }

    #[test]
    fn a_stroke_with_a_colour_and_no_width_is_one_unit_and_zero_width_is_none() {
        let named = Style {
            stroke: Some(stroke("text2", None)),
            ..Style::default()
        };
        assert!(styled(&named, 1.0, false, false).contains(r#"<a:ln w="9525""#));
        let zero = Style {
            stroke: Some(stroke("text2", Some(0.0))),
            ..Style::default()
        };
        assert!(styled(&zero, 1.0, false, false).ends_with("<a:ln><a:noFill/></a:ln>"));
    }

    #[test]
    fn the_dash_names_are_the_ones_the_editor_draws() {
        let names: Vec<_> = [
            Dash::Solid,
            Dash::Dash,
            Dash::Dot,
            Dash::DashDot,
            Dash::LongDash,
        ]
        .iter()
        .map(dash)
        .collect();
        assert_eq!(names, ["solid", "dash", "dot", "dashDot", "lgDash"]);
    }

    #[test]
    fn a_line_with_no_stroke_gets_the_editors_fallback_and_arrowheads_go_last() {
        let style = Style {
            start_arrow: Some(Arrow::Oval),
            end_arrow: Some(Arrow::Open),
            ..Style::default()
        };
        assert_eq!(
            styled(&style, 1.0, true, true),
            concat!(
                r#"<a:noFill/><a:ln w="14288" cap="flat" cmpd="sng"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>"#,
                r#"<a:prstDash val="solid"/><a:round/>"#,
                r#"<a:headEnd type="oval" w="lg" len="lg"/><a:tailEnd type="arrow" w="lg" len="lg"/></a:ln>"#
            )
        );
    }

    #[test]
    fn arrowheads_grow_with_the_line_as_the_editor_draws_them() {
        assert_eq!(head_size(1.0), "lg");
        assert_eq!(head_size(2.0), "lg");
        assert_eq!(head_size(3.0), "med");
        assert_eq!(head_size(6.0), "med");
        assert_eq!(head_size(0.0), "med");
    }

    #[test]
    fn a_shadow_is_an_outer_shadow_with_its_offset_as_distance_and_direction() {
        let style = Style {
            shadow: Some(Shadow {
                color: "#000000".into(),
                blur: 6.0,
                dx: 0.0,
                dy: 4.0,
                alpha: Some(0.4),
                extra: slides_core::Extra::new(),
            }),
            ..Style::default()
        };
        let out = styled(&style, 1.0, false, false);
        assert!(
            out.ends_with(concat!(
                r#"<a:effectLst><a:outerShdw blurRad="114300" dist="38100" dir="5400000" algn="ctr" rotWithShape="0">"#,
                r#"<a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>"#
            )),
            "{out}"
        );
    }

    #[test]
    fn a_shadow_up_and_left_points_the_other_way() {
        let style = Style {
            shadow: Some(Shadow {
                color: "text1".into(),
                blur: 0.0,
                dx: -3.0,
                dy: 0.0,
                alpha: None,
                extra: slides_core::Extra::new(),
            }),
            ..Style::default()
        };
        assert!(styled(&style, 1.0, false, false).contains(r#"dist="28575" dir="10800000""#));
    }

    #[test]
    fn a_colour_that_is_not_one_is_the_text_colour_and_is_reported() {
        let style = Style {
            fill: Some(Fill {
                color: "chartreuse".into(),
                alpha: None,
                extra: slides_core::Extra::new(),
            }),
            ..Style::default()
        };
        let (out, warned) = with_cx(|cx| {
            let mut x = Xml::fragment();
            write_fill(&mut x, cx, Some(&style), 1.0);
            (x.into_string(), cx.shared.warnings.len())
        });
        assert_eq!(
            out,
            r#"<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>"#
        );
        assert_eq!(warned, 1);
    }
}
