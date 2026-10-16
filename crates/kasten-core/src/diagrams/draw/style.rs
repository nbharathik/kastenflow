//! What a cell's style says about how it looks, read for the draft picture.
//! Nothing is copied raw into the picture: a colour must be a hex colour, a
//! number must parse and stay in range, a word must be one of the words the
//! drawing knows. What does not pass is left to the default.

use crate::diagrams::model::Style;

/// `#rrggbb` from `#rgb` or `#rrggbb`; none for anything else.
pub fn hex(text: &str) -> Option<String> {
    let h = text.trim().strip_prefix('#')?;
    if !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    match h.len() {
        6 => Some(format!("#{}", h.to_ascii_lowercase())),
        3 => Some(format!(
            "#{}",
            h.chars()
                .flat_map(|c| [c, c])
                .collect::<String>()
                .to_ascii_lowercase()
        )),
        _ => None,
    }
}

/// A number, finite and within `lo..=hi`.
pub fn number(text: Option<&str>, lo: f64, hi: f64) -> Option<f64> {
    let v: f64 = text?.trim().parse().ok()?;
    (v.is_finite() && (lo..=hi).contains(&v)).then_some(v)
}

/// A number for an attribute of the picture: whole when it is, else to two places.
pub fn n(v: f64) -> String {
    crate::diagrams::model::fmt_num(v)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VAlign {
    Top,
    Middle,
    Bottom,
}

/// The look of a cell.
#[derive(Debug, Clone)]
pub struct Look {
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub width: f64,
    pub dashed: bool,
    pub dash: String,
    pub opacity: f64,
    pub rounded: bool,
    /// The corner radius as a share of the shorter side (0 to 1), or in pixels when `absolute_arc`.
    pub arc: f64,
    pub absolute_arc: bool,
    pub font_size: f64,
    pub font_color: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub align: Align,
    pub valign: VAlign,
    /// The label sits outside the shape: below, above, to the left or to the right.
    pub label_below: bool,
    pub label_above: bool,
    pub label_left: bool,
    pub label_right: bool,
    pub wrap: bool,
    pub spacing: f64,
}

fn colour(style: &Style, key: &str, default: Option<&str>) -> Option<String> {
    match style.get(key) {
        Some("none") => None,
        Some(other) => hex(other).or_else(|| default.map(str::to_owned)),
        None => default.map(str::to_owned),
    }
}

impl Look {
    /// The look of a box; an edge's fill is always none.
    pub fn of(style: &Style, edge: bool, text_shape: bool) -> Look {
        let font_style = number(style.get("fontStyle"), 0.0, 15.0).unwrap_or(0.0) as u32;
        let align = match style.get("align") {
            Some("left") => Align::Left,
            Some("right") => Align::Right,
            _ => Align::Center,
        };
        let valign = match style.get("verticalAlign") {
            Some("top") => VAlign::Top,
            Some("bottom") => VAlign::Bottom,
            _ => VAlign::Middle,
        };
        let dash = style
            .get("dashPattern")
            .map(|p| {
                p.split_whitespace()
                    .filter_map(|v| number(Some(v), 0.0, 100.0))
                    .map(n)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "3 3".to_owned());
        let arc = match number(style.get("arcSize"), 0.0, 100.0) {
            Some(v) if style.flag("absoluteArcSize") => v,
            Some(v) => v / 100.0,
            None => 0.15,
        };
        Look {
            fill: if edge {
                None
            } else {
                colour(
                    style,
                    "fillColor",
                    if text_shape { None } else { Some("#ffffff") },
                )
            },
            stroke: colour(
                style,
                "strokeColor",
                if text_shape { None } else { Some("#000000") },
            ),
            width: number(style.get("strokeWidth"), 0.0, 20.0).unwrap_or(1.0),
            dashed: style.flag("dashed"),
            dash,
            opacity: number(style.get("opacity"), 0.0, 100.0).unwrap_or(100.0) / 100.0,
            rounded: style.flag("rounded"),
            arc,
            absolute_arc: style.flag("absoluteArcSize"),
            font_size: number(style.get("fontSize"), 4.0, 96.0).unwrap_or(if edge {
                11.0
            } else {
                12.0
            }),
            font_color: colour(style, "fontColor", Some("#000000"))
                .unwrap_or_else(|| "#000000".to_owned()),
            bold: font_style & 1 != 0,
            italic: font_style & 2 != 0,
            underline: font_style & 4 != 0,
            align,
            valign,
            label_below: style.get("verticalLabelPosition") == Some("bottom"),
            label_above: style.get("verticalLabelPosition") == Some("top"),
            label_left: style.get("labelPosition") == Some("left"),
            label_right: style.get("labelPosition") == Some("right"),
            wrap: style.get("whiteSpace") == Some("wrap"),
            spacing: number(style.get("spacing"), 0.0, 100.0).unwrap_or(2.0),
        }
    }

    /// The corner radius for a box of `w` by `h`.
    pub fn radius(&self, w: f64, h: f64) -> f64 {
        let r = if self.absolute_arc {
            self.arc
        } else {
            w.min(h) * self.arc
        };
        r.min(w.min(h) / 2.0).max(0.0)
    }

    /// The attributes that paint a closed shape.
    pub fn paint(&self) -> String {
        let mut out = format!(
            " fill=\"{}\" stroke=\"{}\" stroke-width=\"{}\"",
            self.fill.as_deref().unwrap_or("none"),
            self.stroke.as_deref().unwrap_or("none"),
            n(self.width)
        );
        if self.dashed {
            out.push_str(&format!(" stroke-dasharray=\"{}\"", self.dash));
        }
        if self.opacity < 1.0 {
            out.push_str(&format!(
                " opacity=\"{}\"",
                n((self.opacity * 100.0).round() / 100.0)
            ));
        }
        out
    }

    /// The attributes that paint an open line.
    pub fn line(&self) -> String {
        let mut out = format!(
            " fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" stroke-linejoin=\"round\"",
            self.stroke.as_deref().unwrap_or("#000000"),
            n(self.width)
        );
        if self.dashed {
            out.push_str(&format!(" stroke-dasharray=\"{}\"", self.dash));
        }
        if self.opacity < 1.0 {
            out.push_str(&format!(
                " opacity=\"{}\"",
                n((self.opacity * 100.0).round() / 100.0)
            ));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_colours_and_numbers_that_parse_get_into_the_picture() {
        assert_eq!(hex("#DAE8FC").as_deref(), Some("#dae8fc"));
        assert_eq!(hex("#f0a").as_deref(), Some("#ff00aa"));
        for bad in [
            "red",
            "#12",
            "#gggggg",
            "url(#x)",
            "#ffffff\" onload=\"x",
            "light-dark(#fff,#000)",
            "#fff;stroke:red",
        ] {
            assert_eq!(hex(bad), None, "{bad}");
        }
        assert_eq!(number(Some("3.5"), 0.0, 10.0), Some(3.5));
        for bad in ["NaN", "inf", "99999", "-1", "1e400", "x"] {
            assert_eq!(number(Some(bad), 0.0, 100.0), None, "{bad}");
        }
        let look = Look::of(
            &Style::parse(
                "fillColor=red;strokeColor=#abc;strokeWidth=999;fontSize=2;dashed=1;dashPattern=8 8 x",
            ),
            false,
            false,
        );
        assert_eq!(
            (look.fill.as_deref(), look.stroke.as_deref()),
            (Some("#ffffff"), Some("#aabbcc"))
        );
        assert_eq!(
            (look.width, look.font_size, look.dash.as_str()),
            (1.0, 12.0, "8 8")
        );
    }

    #[test]
    fn the_defaults_are_the_editors_and_none_means_none() {
        let look = Look::of(
            &Style::parse(
                "fillColor=none;strokeColor=none;fontStyle=5;align=left;verticalAlign=top",
            ),
            false,
            false,
        );
        assert_eq!((look.fill, look.stroke), (None, None));
        assert!(look.bold && look.underline && !look.italic);
        assert_eq!((look.align, look.valign), (Align::Left, VAlign::Top));
        let edge = Look::of(&Style::parse("html=1;"), true, false);
        assert_eq!(
            (edge.fill, edge.stroke.as_deref(), edge.font_size),
            (None, Some("#000000"), 11.0)
        );
        let rounded = Look::of(&Style::parse("rounded=1;arcSize=12"), false, false);
        assert!((rounded.radius(120.0, 60.0) - 7.2).abs() < 1e-9);
        assert_eq!(
            Look::of(
                &Style::parse("rounded=1;arcSize=50;absoluteArcSize=1"),
                false,
                false
            )
            .radius(100.0, 20.0),
            10.0
        );
    }
}
