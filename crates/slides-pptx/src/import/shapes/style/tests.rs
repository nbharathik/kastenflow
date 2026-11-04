use super::*;
use crate::import::testing::{with_parts, xml};
use crate::import::themefile::FormatScheme;

fn format() -> FormatScheme {
    let n = |x: &str| xml(x);
    FormatScheme {
        fills: vec![
            n(r#"<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>"#),
            n(
                r#"<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst></a:gradFill>"#,
            ),
            n(
                r#"<a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>"#,
            ),
        ],
        lines: vec![
            n(
                r#"<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>"#,
            ),
            n(
                r#"<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill></a:ln>"#,
            ),
        ],
        effects: vec![
            n(r#"<a:effectStyle><a:effectLst/></a:effectStyle>"#),
            n(
                r#"<a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle>"#,
            ),
        ],
        backgrounds: vec![],
    }
}

fn frame() -> Frame {
    Frame {
        x: 0.0,
        y: 0.0,
        w: 200.0,
        h: 100.0,
        rot: 0.0,
        flip_h: false,
        flip_v: false,
    }
}

fn read_shape(shape: &str) -> (Style, Vec<String>) {
    let node = xml(shape);
    with_parts(&[], format(), |cx| {
        let geometry = node.at(&["p:spPr", "a:prstGeom"]).cloned();
        let style = read(cx, &node, geometry.as_ref(), &frame());
        (style, Vec::new())
    })
}

#[test]
fn what_the_shape_says_in_its_own_properties() {
    let (s, _) = read_shape(
        r#"<p:sp><p:spPr><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>
        <a:solidFill><a:schemeClr val="accent2"><a:alpha val="20000"/></a:schemeClr></a:solidFill>
        <a:ln w="19050" cap="flat"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="lgDash"/><a:headEnd type="oval"/><a:tailEnd type="triangle"/></a:ln>
        <a:effectLst><a:outerShdw blurRad="114300" dist="38100" dir="5400000" algn="ctr"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr></p:sp>"#,
    );
    assert_eq!(
        s.fill,
        Some(Fill {
            color: "accent2".into(),
            alpha: Some(0.2),
            extra: slides_core::Extra::new(),
        })
    );
    assert_eq!(
        s.stroke,
        Some(Stroke {
            color: "#ff0000".into(),
            width: Some(2.0),
            dash: Some(Dash::LongDash),
            alpha: None,
            extra: slides_core::Extra::new(),
        })
    );
    assert_eq!(s.radius, Some(20.0), "a fifth of the shorter side");
    assert_eq!(
        (s.start_arrow, s.end_arrow),
        (Some(Arrow::Oval), Some(Arrow::Triangle))
    );
    let shadow = s.shadow.unwrap_or_else(|| panic!("a shadow"));
    assert_eq!(
        (shadow.blur, shadow.dx, shadow.dy, shadow.alpha),
        (6.0, 0.0, 4.0, Some(0.4))
    );
    assert_eq!(shadow.color, "#000000");
}

#[test]
fn a_shape_with_nothing_of_its_own_has_no_fill_or_line() {
    let (s, _) = read_shape(
        r#"<p:sp><p:spPr><a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp>"#,
    );
    assert_eq!((s.fill, s.stroke), (None, None));
    let (s, _) = read_shape(r#"<p:sp><p:spPr/></p:sp>"#);
    assert_eq!((s.fill, s.stroke, s.shadow), (None, None, None));
}

#[test]
fn the_style_a_shape_names_supplies_what_it_leaves_out() {
    let (s, _) = read_shape(
        r#"<p:sp><p:spPr/><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>
        <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>"#,
    );
    assert_eq!(
        s.fill,
        Some(Fill {
            color: "accent1".into(),
            alpha: None,
            extra: slides_core::Extra::new(),
        })
    );
    let stroke = s.stroke.unwrap_or_else(|| panic!("a line"));
    assert_eq!(stroke.width, Some(2.67), "the theme's 25400 EMU");
    assert!(
        stroke.color.starts_with('#'),
        "accent 1 shaded: {}",
        stroke.color
    );
    assert_eq!(s.shadow, None);
}

#[test]
fn a_shape_can_override_part_of_the_style() {
    let (s, _) = read_shape(
        r#"<p:sp><p:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln></p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef></p:style></p:sp>"#,
    );
    assert_eq!(s.fill, None, "fill reference 0 is no fill");
    assert_eq!(
        s.stroke.as_ref().map(|l| (l.color.as_str(), l.width)),
        Some(("#00ff00", Some(1.33)))
    );
    let shadow = s.shadow.unwrap_or_else(|| panic!("the theme's shadow"));
    assert_eq!((shadow.dx, shadow.dy), (0.0, 2.41));
}

#[test]
fn a_gradient_is_kept_with_its_stops_and_angle_and_its_average_stays_as_the_fill() {
    let node = xml(
        r#"<p:sp><p:spPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill></p:spPr></p:sp>"#,
    );
    let (style, warned) = with_parts(&[], format(), |cx| {
        let s = read(cx, &node, None, &frame());
        (s, cx.imp.warnings.count())
    });
    assert_eq!(style.fill.map(|f| f.color), Some("#808080".to_owned()));
    assert_eq!(warned, 0, "nothing is lost, so nothing is said");
    let gradient = style.gradient.unwrap_or_else(|| panic!("the gradient"));
    assert_eq!(gradient.kind, GradientKind::Linear);
    assert_eq!(gradient.angle, Some(45.0));
    let places: Vec<f64> = gradient.stops.iter().map(|s| s.pos).collect();
    assert_eq!(places, [0.0, 1.0]);
    assert!(gradient.stops[0].color.eq_ignore_ascii_case("#000000"));
    // A fill the theme names as a gradient is kept the same way.
    let (s, _) = read_shape(
        r#"<p:sp><p:spPr/><p:style><a:fillRef idx="2"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>"#,
    );
    assert_eq!(s.fill.map(|f| f.color), Some("#808080".to_owned()));
    assert_eq!(s.gradient.map(|g| g.stops.len()), Some(2));
}

#[test]
fn a_path_gradient_is_radial() {
    let (s, _) = read_shape(
        r#"<p:sp><p:spPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:path path="circle"/></a:gradFill></p:spPr></p:sp>"#,
    );
    let g = s.gradient.unwrap_or_else(|| panic!("the gradient"));
    assert_eq!((g.kind, g.angle), (GradientKind::Radial, None));
}

#[test]
fn the_corner_of_a_rounded_rectangle_and_the_text_colour_of_a_style() {
    let g = xml(r#"<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>"#);
    assert_eq!(
        radius_of(&g, &frame()),
        Some(16.67),
        "the default sixth of the shorter side"
    );
    let plain = xml(r#"<a:prstGeom prst="rect"/>"#);
    assert_eq!(radius_of(&plain, &frame()), None);
    let sp = xml(
        r#"<p:sp><p:style><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>"#,
    );
    let colour = with_parts(&[], format(), |cx| font_colour(cx, sp.child("p:style")));
    assert_eq!(colour, Some(Paint::solid("bg1")));
}
