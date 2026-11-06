//! How a shape looks apart from its text: fill, outline, arrowheads, shadow and
//! corner radius. A shape says some of it in its own `p:spPr` and leaves the
//! rest to the format style its `p:style` names in the theme (`fillRef idx="2"`
//! is the theme's second fill, drawn in the colour the reference gives).

use slides_core::{Arrow, Dash, Fill, Gradient, GradientKind, GradientStop, Shadow, Stroke, Style};

use super::frame::Frame;
use crate::import::color::{ColorCx, Paint};
use crate::import::cx::Cx;
use crate::import::dom::Node;
use crate::import::units::{round2, round4};

/// What a fill element says.
#[derive(Clone, Debug, PartialEq)]
enum Filling {
    None,
    Solid(Paint),
    /// A gradient: the one colour it averages to (for what draws no gradients), and the gradient when it has two colours or more.
    Gradient(Paint, Option<Gradient>),
}

/// The gradient a `a:gradFill` says, with its stops by position.
fn gradient_of(colors: &ColorCx<'_>, node: &Node, placeholder: Option<&Paint>) -> Option<Gradient> {
    let stops: Vec<GradientStop> = node
        .child("a:gsLst")?
        .children_named("a:gs")
        .filter_map(|gs| {
            let pos = gs.int("pos").unwrap_or(0) as f64 / 100_000.0;
            let paint = colors.first(gs, placeholder)?;
            Some(GradientStop {
                pos: round4(pos.clamp(0.0, 1.0)),
                color: paint.value,
                alpha: paint.alpha,
                extra: slides_core::Extra::new(),
            })
        })
        .collect();
    if stops.len() < 2 {
        return None;
    }
    let radial = node.child("a:path").is_some();
    let angle = node
        .child("a:lin")
        .and_then(|l| l.int("ang"))
        .map(|a| round2(a as f64 / 60_000.0));
    Some(Gradient {
        kind: if radial {
            GradientKind::Radial
        } else {
            GradientKind::Linear
        },
        angle: if radial {
            None
        } else {
            Some(angle.unwrap_or(0.0))
        },
        stops,
        extra: slides_core::Extra::new(),
    })
    .and_then(|g| g.tidy())
}

fn fill_names(name: &str) -> bool {
    matches!(
        name,
        "a:solidFill" | "a:noFill" | "a:gradFill" | "a:pattFill" | "a:blipFill" | "a:grpFill"
    )
}

/// One fill element read; a fill a deck cannot hold is drawn as the nearest solid one, and said so.
fn filling(cx: &mut Cx, node: &Node, placeholder: Option<&Paint>) -> Option<Filling> {
    let colors = cx.colors();
    match node.name.as_str() {
        "a:noFill" => Some(Filling::None),
        "a:solidFill" => colors.first(node, placeholder).map(Filling::Solid),
        "a:gradFill" => colors
            .gradient_average(node, placeholder)
            .map(|average| Filling::Gradient(average, gradient_of(&colors, node, placeholder))),
        "a:pattFill" => {
            cx.warn_slide("a pattern fill is drawn as its foreground colour");
            node.child("a:fgClr")
                .and_then(|c| colors.first(c, placeholder))
                .map(Filling::Solid)
        }
        "a:blipFill" => {
            cx.warn_slide("a picture fill was left out");
            Some(Filling::None)
        }
        _ => None,
    }
}

/// The one colour a fill element is drawn as: a solid fill's own, a gradient's average or a pattern's foreground.
pub fn paint_of(cx: &mut Cx, node: &Node, placeholder: Option<&Paint>) -> Option<Paint> {
    match filling(cx, node, placeholder)? {
        Filling::Solid(paint) | Filling::Gradient(paint, _) => Some(paint),
        Filling::None => None,
    }
}

/// The colour a style reference (`a:fillRef` ...) gives, and its index.
fn reference(cx: &Cx, style: Option<&Node>, name: &str) -> Option<(i64, Option<Paint>)> {
    let node = style?.child(name)?;
    let idx = node.int("idx")?;
    Some((idx, cx.colors().first(node, None)))
}

/// A shape's fill, and its gradient when it has one (the fill is then the colour the gradient averages to).
fn fill_of(
    cx: &mut Cx,
    sp_pr: Option<&Node>,
    style: Option<&Node>,
) -> Option<(Fill, Option<Gradient>)> {
    let own = sp_pr.and_then(|p| p.elements().find(|n| fill_names(&n.name)));
    let chosen = match own {
        Some(node) if node.name == "a:grpFill" => None,
        Some(node) => filling(cx, node, None),
        None => {
            let (idx, ph) = reference(cx, style, "a:fillRef")?;
            let list = if idx >= 1001 {
                cx.env.theme.format.backgrounds.get((idx - 1001) as usize)
            } else if idx >= 1 {
                cx.env.theme.format.fills.get((idx - 1) as usize)
            } else {
                None
            };
            let node = list?.clone();
            filling(cx, &node, ph.as_ref())
        }
    };
    let (p, gradient) = match chosen? {
        Filling::None => return None,
        Filling::Solid(p) => (p, None),
        Filling::Gradient(p, gradient) => (p, gradient),
    };
    Some((
        Fill {
            color: p.value,
            alpha: p.alpha,
            extra: slides_core::Extra::new(),
        },
        gradient,
    ))
}

fn dash_of(value: &str) -> Dash {
    match value {
        "dash" | "sysDash" => Dash::Dash,
        "dot" | "sysDot" => Dash::Dot,
        "dashDot" | "sysDashDot" | "lgDashDot" | "lgDashDotDot" | "sysDashDotDot" => Dash::DashDot,
        "lgDash" => Dash::LongDash,
        _ => Dash::Solid,
    }
}

fn arrow_of(node: Option<&Node>) -> Option<Arrow> {
    Some(match node?.attr("type")? {
        "triangle" => Arrow::Triangle,
        "stealth" => Arrow::Stealth,
        "arrow" => Arrow::Open,
        "oval" => Arrow::Oval,
        "diamond" => Arrow::Diamond,
        _ => Arrow::None,
    })
}

/// What an `a:ln` says, each part optional.
#[derive(Clone, Debug, Default)]
struct LineSpec {
    width: Option<f64>,
    fill: Option<Filling>,
    dash: Option<Dash>,
    head: Option<Arrow>,
    tail: Option<Arrow>,
}

impl LineSpec {
    fn over(self, below: LineSpec) -> LineSpec {
        LineSpec {
            width: self.width.or(below.width),
            fill: self.fill.or(below.fill),
            dash: self.dash.or(below.dash),
            head: self.head.or(below.head),
            tail: self.tail.or(below.tail),
        }
    }
}

fn line_spec(cx: &mut Cx, ln: &Node, placeholder: Option<&Paint>) -> LineSpec {
    let fill = ln
        .elements()
        .find(|n| fill_names(&n.name))
        .and_then(|n| filling(cx, n, placeholder));
    LineSpec {
        width: ln
            .int("w")
            .map(|w| round2(w.clamp(0, 20_116_800) as f64 / 9525.0)),
        fill,
        dash: ln
            .child("a:prstDash")
            .and_then(|d| d.attr("val"))
            .map(dash_of),
        head: arrow_of(ln.child("a:headEnd")),
        tail: arrow_of(ln.child("a:tailEnd")),
    }
}

/// A shadow from an `a:effectLst`.
fn shadow_of(cx: &Cx, effects: &Node, placeholder: Option<&Paint>) -> Option<Shadow> {
    let shadow = effects.child("a:outerShdw")?;
    let colour = cx.colors().first(shadow, placeholder)?;
    let unit = |name: &str| shadow.int(name).unwrap_or(0).clamp(0, 2_000_000_000) as f64 / 9525.0;
    let dist = unit("dist");
    let dir = shadow.int("dir").unwrap_or(0) as f64 / 60_000.0;
    let (sin, cos) = dir.to_radians().sin_cos();
    Some(Shadow {
        color: colour.value,
        blur: round2(unit("blurRad") / 2.0),
        dx: round2(dist * cos),
        dy: round2(dist * sin),
        alpha: colour.alpha,
        extra: slides_core::Extra::new(),
    })
}

/// What a rounded rectangle's `adj` asks for, if it asks for anything.
fn adj_of(geometry: &Node) -> Option<f64> {
    geometry
        .child("a:avLst")
        .and_then(|l| {
            l.children_named("a:gd")
                .find(|g| g.attr("name") == Some("adj"))
        })
        .and_then(|g| g.attr("fmla"))
        .and_then(|f| f.strip_prefix("val "))
        .and_then(|v| v.trim().parse::<f64>().ok())
}

/// The corner radius a rounded rectangle's `adj` asks for, in slide units.
pub fn radius_of(geometry: &Node, frame: &Frame) -> Option<f64> {
    if geometry.attr("prst") != Some("roundRect") {
        return None;
    }
    let side = frame.w.min(frame.h);
    let adj = adj_of(geometry).unwrap_or(16_667.0);
    let radius = round2(adj.clamp(0.0, 50_000.0) / 100_000.0 * side);
    (radius > 0.0).then_some(radius)
}

/// Whether a rounded rectangle has the corners the preset gives when nothing is asked for, a sixth of
/// its shorter side, which a deck's shape has when it names no radius.
pub fn has_default_radius(geometry: &Node) -> bool {
    adj_of(geometry).is_none_or(|adj| (adj - 16_667.0).abs() < 3.0)
}

/// The colour text takes from the shape's font reference, if it names one.
pub fn font_colour(cx: &Cx, style: Option<&Node>) -> Option<Paint> {
    let font = style?.child("a:fontRef")?;
    cx.colors().first(font, None)
}

/// A shape's looks. `line` says whether an outline is wanted when the shape names none of its own: lines
/// always have one.
pub fn read(cx: &mut Cx, shape: &Node, geometry: Option<&Node>, frame: &Frame) -> Style {
    let sp_pr = shape.child("p:spPr");
    let style = shape.child("p:style");
    let (fill, gradient) = match fill_of(cx, sp_pr, style) {
        Some((fill, gradient)) => (Some(fill), gradient),
        None => (None, None),
    };
    let mut out = Style {
        fill,
        gradient,
        ..Style::default()
    };

    let from_ref = match reference(cx, style, "a:lnRef") {
        Some((idx, ph)) if idx >= 1 => {
            let base = cx.env.theme.format.lines.get((idx - 1) as usize).cloned();
            base.map(|ln| line_spec(cx, &ln, ph.as_ref()))
        }
        _ => None,
    };
    let own = sp_pr
        .and_then(|p| p.child("a:ln"))
        .map(|ln| line_spec(cx, ln, None));
    let line = match (own, from_ref) {
        (Some(own), Some(base)) => Some(own.over(base)),
        (Some(own), None) => Some(own),
        (None, base) => base,
    };
    if let Some(line) = line {
        if let Some(Filling::Solid(paint) | Filling::Gradient(paint, _)) = line.fill {
            out.stroke = Some(Stroke {
                color: paint.value,
                width: line.width.map(round4),
                dash: line.dash.filter(|d| *d != Dash::Solid),
                alpha: paint.alpha,
                extra: slides_core::Extra::new(),
            });
        }
        out.start_arrow = line.head.filter(|a| *a != Arrow::None);
        out.end_arrow = line.tail.filter(|a| *a != Arrow::None);
    }

    let effects = sp_pr.and_then(|p| p.child("a:effectLst"));
    out.shadow = match effects {
        Some(list) => shadow_of(cx, list, None),
        None => match reference(cx, style, "a:effectRef") {
            Some((idx, ph)) if idx >= 1 => {
                let node = cx.env.theme.format.effects.get((idx - 1) as usize).cloned();
                node.and_then(|n| n.child("a:effectLst").cloned())
                    .and_then(|list| shadow_of(cx, &list, ph.as_ref()))
            }
            _ => None,
        },
    };
    out.radius = geometry.and_then(|g| radius_of(g, frame));
    out
}

#[cfg(test)]
mod tests;
