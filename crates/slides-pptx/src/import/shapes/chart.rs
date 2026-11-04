//! A bar, line or pie chart of a PowerPoint file as a chart of the deck, when its options are ones a deck's chart has: vertical
//! clustered bars, lines, or one pie, with up to 12 series and 40 categories. Anything else stays the object it was (`raw`).

use slides_core::{ChartEl, ChartKind, ChartSeries, Element, Extra, Style};

use super::base::{Nv, base_of};
use super::frame::Frame;
use crate::import::color::ColorCx;
use crate::import::cx::Cx;
use crate::import::dom::{self, Node};

const MOST_CATEGORIES: usize = 40;
const MOST_SERIES: usize = 12;
const PALETTE: [&str; 6] = [
    "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
];

/// What a chart part says, in the terms of a deck's chart.
#[derive(Debug, PartialEq)]
pub struct Read {
    pub kind: ChartKind,
    pub title: Option<String>,
    pub categories: Vec<String>,
    /// Name, colour (None for the one the deck would give it), and numbers.
    pub series: Vec<(String, Option<String>, Vec<f64>)>,
    pub labels: bool,
    pub legend: Option<bool>,
}

/// The cache of a reference or literal inside `holder` (`c:cat`, `c:val`, `c:tx`).
fn cache(holder: &Node) -> Option<&Node> {
    for reference in ["c:strRef", "c:numRef"] {
        if let Some(r) = holder.child(reference) {
            return r.child("c:strCache").or_else(|| r.child("c:numCache"));
        }
    }
    holder
        .child("c:strLit")
        .or_else(|| holder.child("c:numLit"))
}

/// The points of a cache by their index; a gap is empty text.
fn points(cache: &Node, most: usize) -> Vec<String> {
    let count = cache
        .child("c:ptCount")
        .and_then(|c| c.int("val"))
        .map_or(0, |n| usize::try_from(n).unwrap_or(0))
        .min(most);
    let mut out = vec![String::new(); count];
    for pt in cache.children_named("c:pt") {
        let at = pt.int("idx").and_then(|i| usize::try_from(i).ok());
        if let (Some(at), Some(v)) = (at, pt.child("c:v"))
            && at < out.len()
        {
            out[at] = v.text();
        }
    }
    out
}

fn words(node: &Node, out: &mut String) {
    if node.name == "a:t" {
        out.push_str(&node.text());
    }
    for child in node.elements() {
        words(child, out);
    }
}

fn grouping(node: &Node) -> Option<&str> {
    node.child("c:grouping").and_then(|g| g.attr("val"))
}

/// Reads a `c:chartSpace`. None when the chart is not one a deck's chart can be.
pub fn parse(root: &Node, colors: &ColorCx<'_>) -> Option<Read> {
    let chart = root.child("c:chart")?;
    let plot = chart.child("c:plotArea")?;
    let kinds: Vec<&Node> = plot
        .elements()
        .filter(|n| n.name.ends_with("Chart"))
        .collect();
    let [node] = kinds.as_slice() else {
        return None;
    };
    let kind = match node.name.as_str() {
        "c:barChart" => {
            if node.child("c:barDir")?.attr("val") != Some("col")
                || !matches!(grouping(node), None | Some("clustered"))
            {
                return None;
            }
            ChartKind::Bar
        }
        "c:lineChart" if matches!(grouping(node), None | Some("standard")) => ChartKind::Line,
        "c:pieChart" => ChartKind::Pie,
        _ => return None,
    };
    let sers: Vec<&Node> = node.children_named("c:ser").collect();
    let wanted = if kind == ChartKind::Pie {
        1
    } else {
        sers.len()
    };
    if sers.is_empty() || sers.len() > MOST_SERIES {
        return None;
    }
    let categories = points(cache(sers[0].child("c:cat")?)?, MOST_CATEGORIES + 1);
    if categories.is_empty() || categories.len() > MOST_CATEGORIES {
        return None;
    }
    let mut series = Vec::new();
    for (n, ser) in sers.iter().take(wanted).enumerate() {
        let name = ser
            .child("c:tx")
            .and_then(cache)
            .and_then(|c| points(c, 1).into_iter().next())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| format!("Series {}", n + 1));
        let values = points(cache(ser.child("c:val")?)?, MOST_CATEGORIES)
            .iter()
            .map(|v| {
                v.trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|v| v.is_finite())
                    .unwrap_or(0.0)
            })
            .chain(std::iter::repeat(0.0))
            .take(categories.len())
            .collect();
        let fill = if kind == ChartKind::Line {
            ser.at(&["c:spPr", "a:ln", "a:solidFill"])
        } else {
            ser.at(&["c:spPr", "a:solidFill"])
        };
        let color = fill
            .and_then(|f| colors.first(f, None))
            .map(|p| p.value)
            .filter(|c| kind != ChartKind::Pie && c != PALETTE[n % PALETTE.len()]);
        series.push((name, color, values));
    }
    let shows = |holder: &Node| {
        ["c:showVal", "c:showPercent"].iter().any(|flag| {
            holder
                .at(&["c:dLbls", flag])
                .and_then(|f| f.flag("val"))
                .unwrap_or(false)
        })
    };
    let labels = shows(node) || sers.iter().any(|s| shows(s));
    let default = series.len() > 1 || kind == ChartKind::Pie;
    let has = chart.child("c:legend").is_some();
    let mut title = String::new();
    if let Some(t) = chart.child("c:title") {
        words(t, &mut title);
    }
    Some(Read {
        kind,
        title: Some(title.trim().to_owned()).filter(|t| !t.is_empty()),
        categories,
        series,
        labels,
        legend: (has != default).then_some(has),
    })
}

/// Reads the chart of a graphic frame as a chart of the deck. False when the import is not asked to, or the chart is not one.
pub fn element(
    cx: &mut Cx,
    gf: &Node,
    nv: &Nv,
    frame: Option<&Frame>,
    out: &mut Vec<Element>,
) -> bool {
    if !cx.imp.native_charts {
        return false;
    }
    let Some(id) = gf
        .at(&["a:graphic", "a:graphicData", "c:chart"])
        .and_then(|c| c.attr("r:id"))
    else {
        return false;
    };
    let Some(rel) = cx.part.rels.get(id).cloned() else {
        return false;
    };
    let Some(name) = cx.imp.pkg.target(&cx.part.name, &rel) else {
        return false;
    };
    let Ok(bytes) = cx.imp.pkg.read(&name) else {
        return false;
    };
    let Ok(doc) = dom::parse(&bytes) else {
        return false;
    };
    let Some(read) = parse(&doc.root, &cx.colors()) else {
        return false;
    };
    let base = base_of(cx, nv, frame, None, Style::default());
    cx.warn_slide(
        "a PowerPoint chart was read as a chart of the deck: its numbers, names and series colours are kept, its other styling is not",
    );
    out.push(Element::Chart(ChartEl {
        base,
        kind: read.kind,
        title: read.title,
        categories: read.categories,
        series: read
            .series
            .into_iter()
            .map(|(name, color, values)| ChartSeries {
                name,
                values,
                color,
                mark: None,
                x: Vec::new(),
                extra: Extra::new(),
            })
            .collect(),
        labels: read.labels,
        legend: read.legend,
        spec: None,
        extra: Extra::new(),
    }));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::testing::{with_parts, xml};
    use crate::import::themefile::FormatScheme;

    fn format() -> FormatScheme {
        FormatScheme {
            fills: vec![],
            lines: vec![],
            effects: vec![],
            backgrounds: vec![],
        }
    }

    const BAR: &str = r#"<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
        <c:ser><c:idx val="0"/><c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>North</c:v></c:pt></c:strCache></c:strRef></c:tx>
        <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
        <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1.5</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
        <c:dLbls><c:showVal val="1"/></c:dLbls></c:barChart></c:plotArea></c:chart></c:chartSpace>"#;

    fn read(text: &str) -> Option<Read> {
        let node = xml(text);
        with_parts(&[], format(), |cx| {
            (parse(&node, &cx.colors()), Vec::<()>::new())
        })
        .0
    }

    #[test]
    fn a_clustered_column_chart_is_read_with_its_names_numbers_and_labels() {
        let r = read(BAR).unwrap_or_else(|| panic!("a chart"));
        assert_eq!(r.kind, ChartKind::Bar);
        assert_eq!(r.title.as_deref(), Some("Sales"));
        assert_eq!(r.categories, ["Q1", "Q2"]);
        assert_eq!(r.series[0].0, "North");
        assert_eq!(r.series[0].2, [1.5, 2.0]);
        assert!(r.series[0].1.is_some(), "a colour of its own is kept");
        assert!(r.labels);
        assert_eq!(r.legend, None, "one series, no legend: the deck's own way");
    }

    #[test]
    fn a_chart_a_deck_cannot_be_is_left_to_be_kept_as_it_was() {
        assert_eq!(
            read(&BAR.replace(r#"val="col""#, r#"val="bar""#)),
            None,
            "horizontal bars"
        );
        assert_eq!(read(&BAR.replace("clustered", "stacked")), None);
        assert_eq!(read(&BAR.replace("c:barChart", "c:areaChart")), None);
    }
}
