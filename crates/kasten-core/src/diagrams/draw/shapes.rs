//! The shapes of the draft picture: the ones the editor uses most, drawn as
//! the editor draws them; anything else (the stencils of the icon libraries)
//! as a labelled box with a badge, and said so.

use super::style::{Look, VAlign, n, number};
use super::text;
use crate::diagrams::model::{Rect, Style};

#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    Rect,
    Ellipse,
    Rhombus,
    Cylinder,
    Hexagon,
    Parallelogram,
    Triangle,
    Actor,
    Cloud,
    Process,
    Document,
    Step,
    Swimlane,
    Text,
    Lifeline,
    /// A picture inside the diagram (`data:image/…`).
    Picture(String),
    /// A shape of an icon library, which the editor draws and this does not: its name.
    Icon(String),
}

/// The `shape=` words the editor's basic shapes go by, which `kind_of` knows.
pub const KNOWN: [&str; 17] = [
    "ellipse",
    "cloud",
    "rhombus",
    "cylinder3",
    "cylinder",
    "cylinder2",
    "hexagon",
    "parallelogram",
    "triangle",
    "umlActor",
    "process",
    "document",
    "step",
    "swimlane",
    "text",
    "umlLifeline",
    "image",
];

/// The flowchart stencils that are the basic shapes under another name.
fn flowchart(name: &str) -> Option<Kind> {
    Some(match name {
        "decision" => Kind::Rhombus,
        "terminator" | "start_1" | "start_2" | "process" | "alternate_process"
        | "predefined_process" => Kind::Rect,
        "document" | "document2" | "multi-document" => Kind::Document,
        "data" | "sequential_data" => Kind::Parallelogram,
        "database" | "stored_data" | "direct_data" => Kind::Cylinder,
        "preparation" => Kind::Hexagon,
        "summing_junction" | "or_2" | "on-page_reference" => Kind::Ellipse,
        _ => return None,
    })
}

/// Which shape a style asks for.
pub fn kind_of(style: &Style) -> Kind {
    let shape = style.get("shape").or_else(|| style.bare());
    match shape {
        Some("ellipse") => Kind::Ellipse,
        Some("cloud") => Kind::Cloud,
        Some("rhombus") => Kind::Rhombus,
        Some("cylinder3" | "cylinder" | "cylinder2") => Kind::Cylinder,
        Some("hexagon") => Kind::Hexagon,
        Some("parallelogram") => Kind::Parallelogram,
        Some("triangle") => Kind::Triangle,
        Some("umlActor") => Kind::Actor,
        Some("process") => Kind::Process,
        Some("document") => Kind::Document,
        Some("step") => Kind::Step,
        Some("swimlane") => Kind::Swimlane,
        Some("text") => Kind::Text,
        Some("umlLifeline") => Kind::Lifeline,
        Some("image") => match style.get("image") {
            Some(src) => picture_or_icon(src),
            None => Kind::Icon("image".to_owned()),
        },
        Some(s) if s.starts_with("mxgraph.") => {
            let name = s.trim_start_matches("mxgraph.");
            if let Some(kind) = name.strip_prefix("flowchart.").and_then(flowchart) {
                return kind;
            }
            let icon = style
                .get("resIcon")
                .or_else(|| style.get("prIcon"))
                .map(|i| i.trim_start_matches("mxgraph."));
            Kind::Icon(icon.map_or_else(|| name.to_owned(), |i| i.to_owned()))
        }
        _ => match style.get("image") {
            Some(src) => picture_or_icon(src),
            None => Kind::Rect,
        },
    }
}

/// The picture a style holds, if it is a small raster picture plainly encoded
/// (the editor writes `data:image/png,<base64>`: a `;` would end the style
/// word), else an icon of the editor's own, named by its file.
fn picture_or_icon(src: &str) -> Kind {
    if let Some(href) = raster(src) {
        return Kind::Picture(href);
    }
    let file = src.rsplit('/').next().unwrap_or("image");
    Kind::Icon(
        file.trim_end_matches(".svg")
            .trim_end_matches(".png")
            .to_owned(),
    )
}

fn raster(src: &str) -> Option<String> {
    let rest = src.strip_prefix("data:image/")?;
    let (kind, data) = rest.split_once(',')?;
    let data = data.strip_prefix("base64,").unwrap_or(data);
    (matches!(kind, "png" | "jpeg" | "jpg" | "gif" | "webp")
        && !data.is_empty()
        && data.len() <= 400_000
        && data
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=')))
    .then(|| format!("data:image/{kind};base64,{data}"))
}

fn poly(points: &[(f64, f64)]) -> String {
    points
        .iter()
        .map(|(x, y)| format!("{},{}", n(*x), n(*y)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn path(d: &str, look: &Look) -> String {
    format!("<path d=\"{d}\"{}/>\n", look.paint())
}

/// A size given as a share of `whole`, or in pixels with `fixedSize=1`.
fn sized(style: &Style, key: &str, default: f64, whole: f64) -> f64 {
    let v = number(style.get(key), 0.0, 10_000.0).unwrap_or(default);
    if style.flag("fixedSize") {
        v.min(whole)
    } else {
        (v * whole).min(whole)
    }
}

/// Draws a box of `kind` into `out`; its label is set by the caller.
pub fn draw(out: &mut String, kind: &Kind, look: &Look, style: &Style, r: Rect) {
    let (x, y, w, h) = (r.x, r.y, r.w, r.h);
    let (cx, cy, right, bottom) = (x + w / 2.0, y + h / 2.0, r.right(), r.bottom());
    match kind {
        Kind::Rect | Kind::Text => {
            if *kind == Kind::Text && look.fill.is_none() && look.stroke.is_none() {
                return;
            }
            let rx = if look.rounded { look.radius(w, h) } else { 0.0 };
            let round = if rx > 0.0 {
                format!(" rx=\"{0}\" ry=\"{0}\"", n(rx))
            } else {
                String::new()
            };
            out.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"{round}{}/>\n",
                n(x),
                n(y),
                n(w),
                n(h),
                look.paint()
            ));
        }
        Kind::Ellipse => out.push_str(&format!(
            "<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\"{}/>\n",
            n(cx),
            n(cy),
            n(w / 2.0),
            n(h / 2.0),
            look.paint()
        )),
        Kind::Rhombus => out.push_str(&format!(
            "<polygon points=\"{}\"{}/>\n",
            poly(&[(cx, y), (right, cy), (cx, bottom), (x, cy)]),
            look.paint()
        )),
        Kind::Triangle => out.push_str(&format!(
            "<polygon points=\"{}\"{}/>\n",
            poly(&[(x, bottom), (cx, y), (right, bottom)]),
            look.paint()
        )),
        Kind::Hexagon => {
            let s = sized(style, "size", 0.25, w).min(w / 2.0);
            out.push_str(&format!(
                "<polygon points=\"{}\"{}/>\n",
                poly(&[
                    (x + s, y),
                    (right - s, y),
                    (right, cy),
                    (right - s, bottom),
                    (x + s, bottom),
                    (x, cy)
                ]),
                look.paint()
            ));
        }
        Kind::Parallelogram => {
            let s = sized(style, "size", 0.25, w).min(w - 1.0);
            out.push_str(&format!(
                "<polygon points=\"{}\"{}/>\n",
                poly(&[(x + s, y), (right, y), (right - s, bottom), (x, bottom)]),
                look.paint()
            ));
        }
        Kind::Step => {
            let s = sized(style, "size", 0.2, w).min(w / 2.0);
            out.push_str(&format!(
                "<polygon points=\"{}\"{}/>\n",
                poly(&[
                    (x, y),
                    (right - s, y),
                    (right, cy),
                    (right - s, bottom),
                    (x, bottom),
                    (x + s, cy)
                ]),
                look.paint()
            ));
        }
        Kind::Cylinder => {
            let ry = number(style.get("size"), 0.0, 10_000.0)
                .unwrap_or(15.0)
                .min(h / 2.0);
            let rx = w / 2.0;
            let d = format!(
                "M {x0} {t} A {rx} {ry} 0 0 1 {x1} {t} L {x1} {b} A {rx} {ry} 0 0 1 {x0} {b} Z M {x0} {t} A {rx} {ry} 0 0 0 {x1} {t}",
                x0 = n(x),
                x1 = n(right),
                t = n(y + ry),
                b = n(bottom - ry),
                rx = n(rx),
                ry = n(ry)
            );
            out.push_str(&path(&d, look));
        }
        Kind::Cloud => {
            let p = |fx: f64, fy: f64| format!("{} {}", n(x + fx * w), n(y + fy * h));
            let d = format!(
                "M {} C {}, {}, {} C {}, {}, {} C {}, {}, {} C {}, {}, {} C {}, {}, {} C {}, {}, {} Z",
                p(0.25, 0.25),
                p(0.05, 0.25),
                p(0.0, 0.5),
                p(0.16, 0.55),
                p(0.0, 0.66),
                p(0.18, 0.9),
                p(0.31, 0.8),
                p(0.4, 1.0),
                p(0.7, 1.0),
                p(0.8, 0.8),
                p(1.0, 0.8),
                p(1.0, 0.6),
                p(0.875, 0.5),
                p(1.0, 0.3),
                p(0.8, 0.1),
                p(0.625, 0.2),
                p(0.5, 0.05),
                p(0.3, 0.05),
                p(0.25, 0.25),
            );
            out.push_str(&path(&d, look));
        }
        Kind::Actor => {
            let head = (w * 0.28).min(h * 0.16);
            out.push_str(&format!(
                "<circle cx=\"{}\" cy=\"{}\" r=\"{}\"{}/>\n",
                n(cx),
                n(y + head),
                n(head),
                look.paint()
            ));
            let d = format!(
                "M {cx} {a} V {b} M {x} {c} H {r} M {cx} {b} L {x} {bt} M {cx} {b} L {r} {bt}",
                cx = n(cx),
                a = n(y + 2.0 * head),
                b = n(y + h * 0.62),
                c = n(y + h * 0.4),
                x = n(x),
                r = n(right),
                bt = n(bottom)
            );
            out.push_str(&format!("<path d=\"{d}\"{}/>\n", look.line()));
        }
        Kind::Process => {
            let s = sized(style, "size", 0.1, w);
            out.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"{}/>\n",
                n(x),
                n(y),
                n(w),
                n(h),
                look.paint()
            ));
            out.push_str(&format!(
                "<path d=\"M {a} {y} V {b} M {c} {y} V {b}\"{}/>\n",
                look.line(),
                a = n(x + s),
                b = n(bottom),
                c = n(right - s),
                y = n(y)
            ));
        }
        Kind::Document => {
            let fy = h * 0.1;
            let d = format!(
                "M {x} {y} L {r} {y} L {r} {a} Q {q1x} {q1y} {mx} {a} Q {q2x} {q2y} {x} {a} Z",
                x = n(x),
                y = n(y),
                r = n(right),
                a = n(bottom - fy),
                mx = n(cx),
                q1x = n(x + 0.75 * w),
                q1y = n(bottom - 3.0 * fy),
                q2x = n(x + 0.25 * w),
                q2y = n(bottom + fy)
            );
            out.push_str(&path(&d, look));
        }
        Kind::Swimlane => {
            let start = number(style.get("startSize"), 0.0, 1000.0).unwrap_or(23.0);
            let side = style.get("horizontal") == Some("0");
            let header = if side {
                Rect {
                    x,
                    y,
                    w: start.min(w),
                    h,
                }
            } else {
                Rect {
                    x,
                    y,
                    w,
                    h: start.min(h),
                }
            };
            let body = style.get("swimlaneFillColor").and_then(super::style::hex);
            if let Some(fill) = body {
                out.push_str(&format!("<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{fill}\" stroke=\"none\"/>\n", n(x), n(y), n(w), n(h)));
            }
            out.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"{}/>\n",
                n(header.x),
                n(header.y),
                n(header.w),
                n(header.h),
                look.paint()
            ));
            let mut frame = look.clone();
            frame.fill = None;
            out.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"{}/>\n",
                n(x),
                n(y),
                n(w),
                n(h),
                frame.paint()
            ));
        }
        Kind::Lifeline => {
            let head = number(style.get("size"), 0.0, 1000.0)
                .unwrap_or(40.0)
                .min(h);
            out.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"{}/>\n",
                n(x),
                n(y),
                n(w),
                n(head),
                look.paint()
            ));
            let mut dashed = look.clone();
            dashed.dashed = true;
            out.push_str(&format!(
                "<path d=\"M {} {} V {}\"{}/>\n",
                n(cx),
                n(y + head),
                n(bottom),
                dashed.line()
            ));
        }
        Kind::Picture(src) => {
            out.push_str(&format!("<image x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" preserveAspectRatio=\"xMidYMid meet\" href=\"{src}\"/>\n", n(x), n(y), n(w), n(h)));
        }
        Kind::Icon(name) => {
            let mut boxed = look.clone();
            if boxed.fill.is_none() || boxed.fill.as_deref() == Some("#ffffff") {
                boxed.fill = Some("#f5f5f5".to_owned());
            }
            boxed.stroke = boxed.stroke.or_else(|| Some("#666666".to_owned()));
            out.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"4\" ry=\"4\"{}/>\n",
                n(x),
                n(y),
                n(w),
                n(h),
                boxed.paint()
            ));
            // The icon's name, small, in the corner: what the editor draws here.
            let mut badge = look.clone();
            badge.font_size = 8.0;
            badge.font_color = "#666666".to_owned();
            badge.align = super::style::Align::Left;
            badge.valign = VAlign::Top;
            badge.spacing = 3.0;
            text::put(out, name, &badge, r);
        }
    }
}

/// Where the label of a shape goes: inside it, or outside when the style says so.
pub fn label_area(
    kind: &Kind,
    look: &Look,
    style: &Style,
    r: Rect,
    label: &str,
) -> (Rect, Look, bool) {
    let mut set = look.clone();
    let lines = label.lines().count().max(1) as f64;
    let height = lines * look.font_size * 1.2 + 4.0;
    if matches!(kind, Kind::Swimlane) {
        let start = number(style.get("startSize"), 0.0, 1000.0).unwrap_or(23.0);
        if style.get("horizontal") == Some("0") {
            return (
                Rect {
                    x: r.x,
                    y: r.y,
                    w: start.min(r.w),
                    h: r.h,
                },
                set,
                true,
            );
        }
        return (
            Rect {
                x: r.x,
                y: r.y,
                w: r.w,
                h: start.min(r.h),
            },
            set,
            false,
        );
    }
    if matches!(kind, Kind::Lifeline) {
        let head = number(style.get("size"), 0.0, 1000.0)
            .unwrap_or(40.0)
            .min(r.h);
        return (
            Rect {
                x: r.x,
                y: r.y,
                w: r.w,
                h: head,
            },
            set,
            false,
        );
    }
    if look.label_below {
        set.valign = VAlign::Top;
        return (
            Rect {
                x: r.x - 20.0,
                y: r.bottom(),
                w: r.w + 40.0,
                h: height,
            },
            set,
            false,
        );
    }
    if look.label_above {
        set.valign = VAlign::Bottom;
        return (
            Rect {
                x: r.x - 20.0,
                y: r.y - height,
                w: r.w + 40.0,
                h: height,
            },
            set,
            false,
        );
    }
    if look.label_right {
        set.align = super::style::Align::Left;
        return (
            Rect {
                x: r.right() + 4.0,
                y: r.y,
                w: r.w.max(80.0),
                h: r.h,
            },
            set,
            false,
        );
    }
    if look.label_left {
        set.align = super::style::Align::Right;
        return (
            Rect {
                x: r.x - 4.0 - r.w.max(80.0),
                y: r.y,
                w: r.w.max(80.0),
                h: r.h,
            },
            set,
            false,
        );
    }
    (r, set, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drawn(style: &str, r: Rect) -> String {
        let s = Style::parse(style);
        let look = Look::of(&s, false, s.bare() == Some("text"));
        let mut out = String::new();
        draw(&mut out, &kind_of(&s), &look, &s, r);
        out
    }

    const BOX: Rect = Rect {
        x: 40.0,
        y: 80.0,
        w: 120.0,
        h: 60.0,
    };

    #[test]
    fn a_style_asks_for_its_shape_by_word_or_by_shape() {
        for (style, kind) in [
            ("rounded=1;whiteSpace=wrap;html=1;", Kind::Rect),
            ("ellipse;whiteSpace=wrap;", Kind::Ellipse),
            ("ellipse;shape=cloud;", Kind::Cloud),
            ("rhombus;", Kind::Rhombus),
            ("shape=cylinder3;size=15;", Kind::Cylinder),
            ("shape=umlActor;", Kind::Actor),
            ("shape=hexagon;size=0.3;", Kind::Hexagon),
            ("swimlane;startSize=30;", Kind::Swimlane),
            ("text;html=1;", Kind::Text),
            ("shape=mxgraph.flowchart.decision;", Kind::Rhombus),
            ("shape=mxgraph.flowchart.terminator;", Kind::Rect),
            (
                "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;",
                Kind::Icon("aws4.lambda".into()),
            ),
            (
                "shape=mxgraph.kubernetes.icon2;prIcon=pod",
                Kind::Icon("pod".into()),
            ),
            ("shape=mxgraph.c4.person2;", Kind::Icon("c4.person2".into())),
            (
                "image;image=img/lib/clip_art/networking/Router_128x128.png;",
                Kind::Icon("Router_128x128".into()),
            ),
        ] {
            assert_eq!(kind_of(&Style::parse(style)), kind, "{style}");
        }
        assert_eq!(
            kind_of(&Style::parse("shape=image;image=data:image/png,AAAA")),
            Kind::Picture("data:image/png;base64,AAAA".into())
        );
        // A picture that is not plainly encoded, or is a vector picture, is not embedded.
        for bad in [
            "data:image/svg+xml,AAAA",
            "data:image/png,AA\"onload=\"x",
            "https://x.example/a.png",
            "data:image/png",
            "data:image/png,",
        ] {
            assert!(
                !matches!(
                    kind_of(&Style::parse(&format!("shape=image;image={bad}"))),
                    Kind::Picture(_)
                ),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_basic_shapes_are_drawn_where_the_box_is() {
        assert!(drawn("rounded=1;arcSize=12;fillColor=#dae8fc;strokeColor=#6c8ebf;", BOX).contains("<rect x=\"40\" y=\"80\" width=\"120\" height=\"60\" rx=\"7.2\" ry=\"7.2\" fill=\"#dae8fc\" stroke=\"#6c8ebf\""));
        assert!(
            drawn("ellipse;", BOX).contains("<ellipse cx=\"100\" cy=\"110\" rx=\"60\" ry=\"30\"")
        );
        assert!(drawn("rhombus;", BOX).contains("points=\"100,80 160,110 100,140 40,110\""));
        assert!(
            drawn("shape=hexagon;size=0.25;", BOX)
                .contains("points=\"70,80 130,80 160,110 130,140 70,140 40,110\"")
        );
        assert!(
            drawn("shape=parallelogram;fixedSize=1;size=20;", BOX)
                .contains("points=\"60,80 160,80 140,140 40,140\"")
        );
        let db = drawn(
            "shape=cylinder3;size=15;",
            Rect {
                x: 0.0,
                y: 0.0,
                w: 80.0,
                h: 100.0,
            },
        );
        assert!(
            db.contains("A 40 15 0 0 1 80 15") && db.contains("L 80 85"),
            "{db}"
        );
        assert!(drawn("shape=process;", BOX).contains("M 52 80 V 140 M 148 80 V 140"));
        let cloud = drawn("ellipse;shape=cloud;", BOX);
        assert!(
            cloud.contains("M 70 95 C ") && cloud.contains(" Z\""),
            "{cloud}"
        );
        let actor = drawn(
            "shape=umlActor;",
            Rect {
                x: 0.0,
                y: 0.0,
                w: 30.0,
                h: 60.0,
            },
        );
        assert!(
            actor.contains("<circle cx=\"15\"") && actor.contains("<path d=\"M 15 "),
            "{actor}"
        );
        assert!(drawn("shape=document;", BOX).contains(" Q "));
        assert!(drawn("shape=step;", BOX).contains("polygon"));
    }

    #[test]
    fn a_container_has_its_title_strip_and_a_lifeline_its_dashed_line() {
        let lane = drawn(
            "swimlane;startSize=30;fillColor=#f5f5f5;strokeColor=#666666;swimlaneFillColor=#ffffff;",
            Rect {
                x: 0.0,
                y: 0.0,
                w: 300.0,
                h: 200.0,
            },
        );
        assert!(
            lane.matches("<rect").count() == 3 && lane.contains("height=\"30\" fill=\"#f5f5f5\""),
            "{lane}"
        );
        let side = drawn(
            "swimlane;horizontal=0;startSize=30;",
            Rect {
                x: 0.0,
                y: 0.0,
                w: 300.0,
                h: 200.0,
            },
        );
        assert!(side.contains("width=\"30\" height=\"200\""), "{side}");
        let line = drawn(
            "shape=umlLifeline;size=40;",
            Rect {
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 300.0,
            },
        );
        assert!(
            line.contains("height=\"40\"")
                && line.contains("M 50 40 V 300")
                && line.contains("stroke-dasharray"),
            "{line}"
        );
    }

    #[test]
    fn an_icon_is_a_labelled_box_with_its_name_for_a_badge_and_nothing_raw_from_the_style() {
        let icon = drawn(
            "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;strokeColor=#ffffff;",
            Rect {
                x: 0.0,
                y: 0.0,
                w: 78.0,
                h: 78.0,
            },
        );
        assert!(
            icon.contains("fill=\"#ed7100\"")
                && icon.contains(">aws4.lambda</text>")
                && icon.contains("rx=\"4\""),
            "{icon}"
        );
        let hostile = drawn(
            "fillColor=#fff\" onload=\"alert(1);strokeColor=url(#x);strokeWidth=1e9;opacity=abc",
            BOX,
        );
        assert!(
            !hostile.contains("onload") && !hostile.contains("url("),
            "{hostile}"
        );
        assert!(hostile.contains("fill=\"#ffffff\""));
    }

    #[test]
    fn labels_go_inside_below_or_beside_as_the_style_says() {
        let s = |style: &str| {
            let s = Style::parse(style);
            let look = Look::of(&s, false, false);
            label_area(&kind_of(&s), &look, &s, BOX, "Name")
        };
        assert_eq!(s("").0, BOX);
        let (below, look, _) = s("verticalLabelPosition=bottom;verticalAlign=top;");
        assert_eq!((below.y, look.valign), (140.0, VAlign::Top));
        assert_eq!(s("labelPosition=right;align=left;").0.x, 164.0);
        let (strip, _, turned) = s("swimlane;horizontal=0;startSize=30;");
        assert_eq!((strip.w, turned), (30.0, true));
        assert_eq!(s("shape=umlLifeline;").0.h, 40.0);
    }
}
