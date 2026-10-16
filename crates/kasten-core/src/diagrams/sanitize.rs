//! SVG a person or an agent hands over is cleaned by an allow-list before it
//! is kept: only the drawing elements and presentation attributes, links only
//! to places inside the picture, pictures only when they are held in it. A
//! script, an event handler, an HTML island (`foreignObject`), an outside
//! address, an `@import`, a style sheet: out, each said. `dangers` is the
//! small part of this that a picture of the editor's own is also held to
//! (nothing there ever needs it), so it can refuse instead of rewrite.

use std::collections::BTreeMap;

use super::model::esc_attr;
use super::model::scan::{self, Node, Tree};
use super::xml;
use crate::error::{Error, Result};

/// The elements of a drawing.
const ELEMENTS: &[&str] = &[
    "svg",
    "g",
    "defs",
    "title",
    "desc",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "path",
    "text",
    "tspan",
    "image",
    "use",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "marker",
    "symbol",
    "switch",
    "textPath",
    "pattern",
    "mask",
];

/// Elements that hold nothing a picture needs but whose children may be kept.
const UNWRAPPED: &[&str] = &["a"];

/// The attributes of a drawing: geometry, painting and type.
const ATTRIBUTES: &[&str] = &[
    "x",
    "y",
    "width",
    "height",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "x1",
    "y1",
    "x2",
    "y2",
    "points",
    "d",
    "transform",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linejoin",
    "stroke-linecap",
    "stroke-miterlimit",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "fill-rule",
    "clip-rule",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "text-decoration",
    "dominant-baseline",
    "letter-spacing",
    "word-spacing",
    "viewBox",
    "preserveAspectRatio",
    "version",
    "id",
    "class",
    "clip-path",
    "mask",
    "marker-start",
    "marker-mid",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "orient",
    "markerUnits",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "patternUnits",
    "clipPathUnits",
    "maskUnits",
    "spreadMethod",
    "fx",
    "fy",
    "pointer-events",
    "visibility",
    "display",
    "dx",
    "dy",
    "rotate",
    "textLength",
    "lengthAdjust",
    "xml:space",
    "shape-rendering",
    "text-rendering",
];

/// The properties a `style` attribute may set.
const PROPERTIES: &[&str] = &[
    "background",
    "background-color",
    "color-scheme",
    "color",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linejoin",
    "stroke-linecap",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "text-decoration",
    "display",
    "visibility",
    "pointer-events",
];

const NAMESPACES: &[&str] = &["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"];

/// A picture, cleaned, and what was taken out of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sanitised {
    pub svg: String,
    pub removed: Vec<String>,
}

#[derive(Default)]
struct Report {
    counts: BTreeMap<String, usize>,
}

impl Report {
    fn note(&mut self, what: impl Into<String>) {
        *self.counts.entry(what.into()).or_default() += 1;
    }

    fn lines(self) -> Vec<String> {
        self.counts
            .into_iter()
            .map(|(what, n)| {
                if n == 1 {
                    what
                } else {
                    format!("{what} (×{n})")
                }
            })
            .collect()
    }
}

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// A reference to something in the picture: `url(#id)` or `#id`.
fn inner_reference(value: &str) -> bool {
    let v = value.trim();
    match v.strip_prefix("url(").and_then(|r| r.strip_suffix(')')) {
        Some(inner) => inner.trim().trim_matches(['"', '\'']).starts_with('#'),
        None => false,
    }
}

/// A picture held in the value: a raster one, plainly encoded.
fn held_picture(value: &str) -> bool {
    let Some(rest) = value.trim().strip_prefix("data:image/") else {
        return false;
    };
    let Some((kind, data)) = rest.split_once(";base64,") else {
        return false;
    };
    matches!(kind, "png" | "jpeg" | "jpg" | "gif" | "webp")
        && data.len() <= 4_000_000
        && data.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'\n' | b'\r' | b' ')
        })
}

/// `style` with only the properties a drawing needs, without any address.
fn clean_style(value: &str, report: &mut Report) -> Option<String> {
    let mut kept = Vec::new();
    for declaration in value.split(';').map(str::trim).filter(|d| !d.is_empty()) {
        let Some((property, setting)) = declaration.split_once(':') else {
            report.note("a style declaration that is not one");
            continue;
        };
        let (property, setting) = (property.trim().to_ascii_lowercase(), setting.trim());
        let lower = setting.to_ascii_lowercase();
        let hostile = lower.contains("url(")
            || lower.contains("expression")
            || lower.contains("javascript")
            || lower.contains('@')
            || lower.contains('\\')
            || lower.contains("<");
        if !PROPERTIES.contains(&property.as_str()) || hostile {
            report.note(format!("the style property {property}"));
            continue;
        }
        kept.push(format!("{property}: {setting};"));
    }
    (!kept.is_empty()).then(|| kept.join(" "))
}

/// An attribute of `element`, as it may stay, or none (said in the report).
fn attribute(element: &str, name: &str, value: &str, report: &mut Report) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("on") {
        report.note(format!("the event handler {lower}"));
        return None;
    }
    match name {
        "href" | "xlink:href" => {
            if value.trim().starts_with('#') || (element == "image" && held_picture(value)) {
                return Some(value.to_owned());
            }
            report.note("a link or picture from outside the drawing");
            None
        }
        "style" => clean_style(value, report),
        "content" if element == "svg" => Some(value.to_owned()),
        "xmlns" | "xmlns:xlink" => NAMESPACES.contains(&value).then(|| value.to_owned()),
        "fill" | "stroke" | "filter" | "clip-path" | "mask" | "marker-start" | "marker-mid"
        | "marker-end" => {
            if value.to_ascii_lowercase().contains("url(") && !inner_reference(value) {
                report.note("a paint or reference to an outside address");
                return None;
            }
            Some(value.to_owned())
        }
        other if ATTRIBUTES.contains(&other) => {
            if value.to_ascii_lowercase().contains("javascript:") {
                report.note("a script address");
                return None;
            }
            Some(value.to_owned())
        }
        other => {
            report.note(format!("the attribute {other}"));
            None
        }
    }
}

/// Text between tags with comments and instructions taken out and CDATA written as plain text.
fn clean_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(at) = rest.find("<") {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        if let Some(inner) = tail.strip_prefix("<![CDATA[") {
            let end = inner.find("]]>").unwrap_or(inner.len());
            out.push_str(
                &inner[..end]
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;"),
            );
            rest = inner.get(end + 3..).unwrap_or("");
        } else if let Some(inner) = tail.strip_prefix("<!--") {
            rest = inner
                .find("-->")
                .and_then(|n| inner.get(n + 3..))
                .unwrap_or("");
        } else if let Some(inner) = tail.strip_prefix("<?") {
            rest = inner
                .find("?>")
                .and_then(|n| inner.get(n + 2..))
                .unwrap_or("");
        } else {
            rest = &tail[1..];
        }
    }
    out.push_str(rest);
    out
}

struct Walk<'a> {
    tree: &'a Tree,
    text: &'a str,
    out: String,
    report: Report,
}

impl Walk<'_> {
    fn children(&mut self, node: &Node) {
        let mut at = node.open.end;
        for &c in &node.children {
            let child = &self.tree.nodes[c];
            self.out
                .push_str(&clean_text(&self.text[at..child.open.start]));
            self.element(c);
            at = child.span().end;
        }
        if let Some(close) = &node.close {
            self.out.push_str(&clean_text(&self.text[at..close.start]));
        }
    }

    fn element(&mut self, at: usize) {
        let node = &self.tree.nodes[at];
        let name = node.name.as_str();
        if UNWRAPPED.contains(&name) {
            self.report.note("a link element (its content is kept)");
            self.children(node);
            return;
        }
        if !ELEMENTS.contains(&name) {
            self.report.note(match name {
                "script" => "a script element".to_owned(),
                "foreignObject" => "an HTML island (foreignObject)".to_owned(),
                "style" => "a style sheet".to_owned(),
                other if other.contains(':') => "an element from another namespace".to_owned(),
                other => format!("the element {other}"),
            });
            return;
        }
        let mut open = format!("<{name}");
        for a in &node.attrs {
            if let Some(value) = attribute(name, &a.name, &a.value, &mut self.report) {
                open.push_str(&format!(" {}=\"{}\"", a.name, esc_attr(&value)));
            }
        }
        if node.close.is_none() {
            self.out.push_str(&open);
            self.out.push_str("/>");
            return;
        }
        self.out.push_str(&open);
        self.out.push('>');
        self.children(node);
        self.out.push_str(&format!("</{name}>"));
    }
}

/// Cleans `svg`; a picture that is not an SVG at all is refused.
pub fn sanitize(svg: &str) -> Result<Sanitised> {
    if svg.len() > super::MAX_BYTES {
        return Err(invalid("This picture is too large"));
    }
    xml::scan(svg, "").map_err(|why| invalid(format!("Not a well-formed picture. {why}")))?;
    let tree = scan::parse(svg).map_err(|why| invalid(format!("Not a readable picture: {why}")))?;
    let root = &tree.nodes[tree.root];
    if root.name != "svg" {
        return Err(invalid(format!(
            "This is not an SVG picture: its root element is <{}>",
            root.name
        )));
    }
    let mut walk = Walk {
        tree: &tree,
        text: svg,
        out: String::with_capacity(svg.len()),
        report: Report::default(),
    };
    walk.element(tree.root);
    walk.out.push('\n');
    Ok(Sanitised {
        svg: walk.out,
        removed: walk.report.lines(),
    })
}

/// What in `svg` no picture needs and any could do harm with: a script, an
/// event handler, a script address in a link, or an element that embeds
/// another page. The editor's pictures never have them, so they are refused.
pub fn dangers(svg: &str) -> Option<String> {
    let tree = scan::parse(svg).ok()?;
    for node in &tree.nodes {
        let local = node.name.rsplit(':').next().unwrap_or("");
        if matches!(
            local.to_ascii_lowercase().as_str(),
            "script"
                | "iframe"
                | "object"
                | "embed"
                | "applet"
                | "animate"
                | "set"
                | "animatetransform"
                | "animatemotion"
        ) {
            return Some(format!("the element {local}"));
        }
        for a in &node.attrs {
            let name = a.name.to_ascii_lowercase();
            if name.starts_with("on")
                && name.len() > 2
                && name[2..].bytes().all(|b| b.is_ascii_lowercase())
            {
                return Some(format!("the event handler {name}"));
            }
            let value = a
                .value
                .trim()
                .to_ascii_lowercase()
                .replace(['\t', '\n', '\r', ' '], "");
            if matches!(
                name.as_str(),
                "href" | "xlink:href" | "src" | "action" | "formaction"
            ) && (value.starts_with("javascript:")
                || value.starts_with("vbscript:")
                || value.starts_with("data:text")
                || value.starts_with("data:application"))
            {
                return Some("a script address".to_owned());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const EDITOR: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" version=\"1.1\" width=\"81px\" height=\"41px\" viewBox=\"-0.5 -0.5 81 41\" content=\"&lt;mxfile&gt;&lt;/mxfile&gt;\" style=\"background: #ffffff; color-scheme: light dark;\"><defs/><g><rect x=\"0\" y=\"0\" width=\"80\" height=\"40\" fill=\"#dae8fc\" stroke=\"#6c8ebf\" pointer-events=\"all\"/><g transform=\"translate(0.5,0.5)\"><text x=\"40\" y=\"24\" fill=\"#000000\" font-family=\"Helvetica\" font-size=\"12px\" text-anchor=\"middle\">A &amp; B</text></g></g></svg>\n";

    fn clean(svg: &str) -> Sanitised {
        sanitize(svg).unwrap()
    }

    #[test]
    fn a_plain_drawing_comes_through_as_it_is() {
        let out = clean(EDITOR);
        assert!(out.removed.is_empty(), "{:?}", out.removed);
        assert_eq!(out.svg, EDITOR);
        // And the draft the program draws.
        let draft = crate::diagrams::draw::draft(&crate::diagrams::blank_xml().replace("<mxCell id=\"1\" parent=\"0\" />", "<mxCell id=\"1\" parent=\"0\" /><mxCell id=\"a\" value=\"A\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"1\" y=\"1\" width=\"50\" height=\"30\" as=\"geometry\"/></mxCell>"), None).unwrap();
        let out = clean(&draft.svg);
        assert!(out.removed.is_empty(), "{:?}", out.removed);
    }

    #[test]
    fn scripts_handlers_html_islands_and_style_sheets_are_taken_out_and_said() {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"><script>alert(2)</script><style>@import url(https://evil.example/x.css);</style><foreignObject><div xmlns=\"http://www.w3.org/1999/xhtml\">hi</div></foreignObject><rect width=\"5\" height=\"5\" onclick=\"x()\" fill=\"url(https://evil.example/p)\"/><text>kept</text></svg>";
        let out = clean(svg);
        for gone in [
            "script",
            "alert",
            "onload",
            "onclick",
            "@import",
            "foreignObject",
            "evil.example",
            "div",
        ] {
            assert!(!out.svg.contains(gone), "{gone}: {}", out.svg);
        }
        assert!(
            out.svg.contains("<rect width=\"5\" height=\"5\"/>")
                && out.svg.contains("<text>kept</text>"),
            "{}",
            out.svg
        );
        let said = out.removed.join(" | ");
        for want in [
            "a script element",
            "a style sheet",
            "an HTML island",
            "the event handler onload",
            "the event handler onclick",
            "outside address",
        ] {
            assert!(said.contains(want), "{want} in {said}");
        }
    }

    #[test]
    fn links_and_pictures_stay_only_when_they_point_inside_or_are_held() {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><defs><linearGradient id=\"g\"><stop offset=\"0\" stop-color=\"#fff\"/></linearGradient></defs>\
<rect width=\"5\" height=\"5\" fill=\"url(#g)\"/><use xlink:href=\"#g\"/><use href=\"https://evil.example/s.svg#a\"/>\
<image width=\"5\" height=\"5\" xlink:href=\"data:image/png;base64,AAAA\"/><image width=\"5\" height=\"5\" xlink:href=\"https://tracker.example/p.png\"/>\
<image width=\"5\" height=\"5\" xlink:href=\"data:image/svg+xml;base64,AAAA\"/><a xlink:href=\"https://example.com\"><text>go</text></a><a xlink:href=\"javascript:alert(1)\"><text>no</text></a></svg>";
        let out = clean(svg);
        assert!(
            out.svg.contains("fill=\"url(#g)\"")
                && out.svg.contains("<use xlink:href=\"#g\"/>")
                && out.svg.contains("data:image/png;base64,AAAA"),
            "{}",
            out.svg
        );
        for gone in [
            "evil.example",
            "tracker.example",
            "svg+xml",
            "javascript",
            "https://example.com",
        ] {
            assert!(!out.svg.contains(gone), "{gone}: {}", out.svg);
        }
        assert!(
            out.svg.contains("<text>go</text>") && out.svg.contains("<text>no</text>"),
            "a link element is unwrapped, its words stay: {}",
            out.svg
        );
    }

    #[test]
    fn a_style_attribute_keeps_what_a_drawing_sets_and_loses_addresses() {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" style=\"background: #fff; color-scheme: light; behavior: url(x.htc); background-image: url(https://x/y.png); position: fixed\"><rect width=\"1\" height=\"1\" style=\"fill: red; width: expression(alert(1))\"/></svg>";
        let out = clean(svg);
        assert!(
            out.svg
                .contains("style=\"background: #fff; color-scheme: light;\"")
                && out.svg.contains("style=\"fill: red;\""),
            "{}",
            out.svg
        );
        assert!(
            !out.svg.contains("url(")
                && !out.svg.contains("expression")
                && !out.svg.contains("fixed")
        );
    }

    #[test]
    fn words_keep_their_characters_and_cdata_and_comments_are_made_plain() {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><!-- note --><text>a &lt; b &amp; <![CDATA[<c> & d]]></text><?php echo 1 ?></svg>";
        let out = clean(svg);
        assert!(
            out.svg
                .contains("<text>a &lt; b &amp; &lt;c&gt; &amp; d</text>")
                && !out.svg.contains("note")
                && !out.svg.contains("php"),
            "{}",
            out.svg
        );
        xml::scan(&out.svg, "").unwrap();
    }

    #[test]
    fn what_is_not_a_picture_or_not_well_formed_is_refused_and_a_namespace_trick_does_not_pass() {
        for bad in [
            "<html/>",
            "<svg><g></svg>",
            "<!DOCTYPE svg><svg/>",
            "<svg xmlns=\"x\"",
            "plain text",
        ] {
            assert!(sanitize(bad).is_err(), "{bad}");
        }
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:x=\"http://evil\"><x:script>alert(1)</x:script><svg:g xmlns:svg=\"http://www.w3.org/2000/svg\"><rect width=\"1\" height=\"1\"/></svg:g></svg>";
        let out = clean(svg);
        assert!(
            !out.svg.contains("script") && !out.svg.contains("evil") && !out.svg.contains("<rect"),
            "{}",
            out.svg
        );
        assert!(out.removed.iter().any(|r| r.contains("another namespace")));
    }

    #[test]
    fn a_corpus_of_known_svg_tricks_comes_out_inert_or_is_refused() {
        let ns =
            "xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"";
        let corpus = [
            format!("<svg {ns}><image href=\"x\" onerror=\"alert(1)\"/></svg>"),
            format!(
                "<svg {ns}><a xlink:href=\"javascript:alert(1)\"><rect width=\"9\" height=\"9\"/></a></svg>"
            ),
            format!("<svg {ns}><set attributeName=\"onmouseover\" to=\"alert(1)\"/></svg>"),
            format!(
                "<svg {ns}><animate attributeName=\"href\" values=\"javascript:alert(1)\"/></svg>"
            ),
            format!("<svg {ns}><script type=\"text/ecmascript\">alert(1)</script></svg>"),
            format!(
                "<svg {ns}><foreignObject><iframe src=\"javascript:alert(1)\"/></foreignObject></svg>"
            ),
            format!("<svg {ns}><use href=\"data:image/svg+xml;base64,PHN2Zz4=\"/></svg>"),
            format!("<svg {ns}><style>*{{background:url(javascript:alert(1))}}</style></svg>"),
            format!(
                "<svg {ns}><rect style=\"background:url('https://evil.example/t.gif')\" width=\"1\" height=\"1\"/></svg>"
            ),
            format!("<svg {ns}><g onfocus=\"alert(1)\" tabindex=\"0\"/></svg>"),
            format!(
                "<svg {ns}><rect fill=\"url(javascript:alert(1))\" width=\"1\" height=\"1\"/></svg>"
            ),
            format!(
                "<svg {ns}><image xlink:href=\"https://evil.example/pixel.png\" width=\"1\" height=\"1\"/></svg>"
            ),
            format!(
                "<svg {ns}><svg:script xmlns:svg=\"http://www.w3.org/2000/svg\">alert(1)</svg:script></svg>"
            ),
            format!("<svg {ns}><![CDATA[<script>alert(1)</script>]]></svg>"),
            format!("<svg {ns}><text>&lt;script&gt;alert(1)&lt;/script&gt;</text></svg>"),
            format!(
                "<svg {ns}><rect width=\"1\" height=\"1\" ONCLICK=\"alert(1)\" xlink:href=\"JaVaScRiPt:alert(1)\"/></svg>"
            ),
            format!(
                "<svg {ns}><switch><foreignObject><body onload=\"alert(1)\"/></foreignObject><text>fallback</text></switch></svg>"
            ),
        ];
        for svg in &corpus {
            let out = sanitize(svg).unwrap_or_else(|e| panic!("{svg}: {e}"));
            xml::scan(&out.svg, "").unwrap_or_else(|e| panic!("{svg} -> {}: {e}", out.svg));
            assert_eq!(dangers(&out.svg), None, "{svg} -> {}", out.svg);
            let lower = out.svg.to_lowercase();
            for hazard in [
                "<script",
                "javascript:",
                "onerror",
                "onclick",
                "onfocus",
                "evil.example",
                "<iframe",
                "<style",
                "foreignobject",
                "<set",
                "<animate",
            ] {
                assert!(
                    !lower.contains(hazard),
                    "{hazard} in {} (from {svg})",
                    out.svg
                );
            }
        }
        for broken in [
            "<svg onload=alert(1)>",
            "<!DOCTYPE svg [<!ENTITY a \"b\">]><svg/>",
            "<svg><g></svg>",
        ] {
            assert!(sanitize(broken).is_err(), "{broken}");
        }
    }

    #[test]
    fn the_pictures_the_editor_makes_are_held_to_the_few_things_nothing_needs() {
        assert_eq!(dangers(EDITOR), None);
        for (svg, want) in [
            (
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><script/></svg>",
                "script",
            ),
            (
                "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"x()\"/>",
                "onload",
            ),
            (
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><a href=\" JavaScript:alert(1)\"><text/></a></svg>",
                "script address",
            ),
            (
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><a href=\"data:text/html,x\"/></svg>",
                "script address",
            ),
            (
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><animate attributeName=\"href\" values=\"javascript:x\"/></svg>",
                "animate",
            ),
            (
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><iframe src=\"x\"/></svg>",
                "iframe",
            ),
        ] {
            assert!(
                dangers(svg).is_some_and(|d| d.contains(want)),
                "{svg}: {:?}",
                dangers(svg)
            );
        }
        // Not harm: an HTML label island, a web font, a link to the web, a handler-looking word that is a real attribute.
        let fine = "<svg xmlns=\"http://www.w3.org/2000/svg\"><defs><style>@import url(https://fonts.example/a.css);</style></defs><switch><foreignObject><div>x</div></foreignObject><text>x</text></switch><a href=\"https://example.com\"><text>y</text></a><rect width=\"1\" height=\"1\" opacity=\"1\"/></svg>";
        assert_eq!(dangers(fine), None);
    }
}
