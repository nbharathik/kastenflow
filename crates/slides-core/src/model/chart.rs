//! Charts: a small table of numbers and what is said about them. The numbers (`categories`,
//! `series`) and the three plain kinds (`kind`: bar, line, pie) are what every build reads; the rest
//! is a `spec` in the shape of a Vega-Lite spec (`mark`, `encoding.x.title`, `encoding.y.format`,
//! `encoding.color.legend.orient` ...), so a chart stays a portable description that models write
//! well. A build that does not know the `spec` draws the plain kind from the numbers, and keeps the
//! spec as it was. The chart is drawn by `crate::composites`, from shapes, lines and words.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::{Base, Extra, NumberFormat, is_false};

model! {
    #[serde(rename_all = "camelCase")]
    pub enum ChartKind {
        /// Vertical bars (columns), grouped by category.
        Bar,
        /// A line through the points of each series.
        Line,
        /// The first series as slices of a circle.
        Pie,
    }

    /// How marks are drawn, named as Vega-Lite names them.
    #[serde(rename_all = "camelCase")]
    pub enum ChartMark {
        /// Vertical bars.
        Bar,
        Line,
        /// A line with the area under it filled.
        Area,
        /// Slices of a circle; with `innerRadius` a doughnut.
        Arc,
        /// Points on two number axes (a scatter chart).
        Point,
    }

    /// One row of a chart's table: a name and a number for each category.
    #[serde(rename_all = "camelCase")]
    pub struct ChartSeries {
        pub name: String,
        pub values: Vec<f64>,
        /// A theme colour or #rrggbb; the theme's accent colours in turn when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        /// For a combo chart: `bar` or `line`, how this series is drawn.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub mark: Option<ChartMark>,
        /// For a scatter chart: where each point is along the horizontal axis (`values` is how high it is).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub x: Vec<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// Where the legend goes.
    #[serde(rename_all = "camelCase")]
    pub enum LegendOrient {
        Top,
        Bottom,
        Left,
        Right,
    }

    #[serde(rename_all = "camelCase")]
    pub struct ChartLegend {
        /// Under the chart (`bottom`) when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub orient: Option<LegendOrient>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// What colours the marks: the series, so this is where their legend is set.
    #[serde(rename_all = "camelCase")]
    pub struct ChartColor {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub legend: Option<ChartLegend>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// An axis: its title, and how the numbers on it (and on the marks) are written.
    #[serde(rename_all = "camelCase")]
    pub struct ChartAxis {
        /// Words set under the horizontal axis, or at the top of the vertical one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        /// A number pattern such as `#,##0`, `0.0`, `$#,##0.00` or `0%`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub format: Option<String>,
        /// On the vertical axis: stack the series instead of putting them side by side.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub stack: Option<bool>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    #[serde(rename_all = "camelCase")]
    pub struct ChartEncoding {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub x: Option<ChartAxis>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub y: Option<ChartAxis>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<ChartColor>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// What a chart says beyond its numbers, in the shape of a Vega-Lite spec.
    #[serde(rename_all = "camelCase")]
    pub struct ChartSpec {
        /// How the marks are drawn when `kind` is not enough (area, point, arc ...).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub mark: Option<ChartMark>,
        /// For an arc: the share of the radius left empty in the middle, 0 to 0.9 (a doughnut).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub inner_radius: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub encoding: Option<ChartEncoding>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A chart of a small table of numbers (columns, stacked columns, lines, areas, pies, doughnuts,
    /// scatter, or columns with lines), drawn from shapes, lines and text.
    #[serde(rename_all = "camelCase")]
    pub struct ChartEl {
        #[serde(flatten)]
        pub base: Base,
        pub kind: ChartKind,
        /// What the chart is about, set above it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        /// The name of each bar group, point on the line or slice.
        #[serde(default)]
        pub categories: Vec<String>,
        pub series: Vec<ChartSeries>,
        /// The number written on each bar, point and slice.
        #[serde(default, skip_serializing_if = "is_false")]
        pub labels: bool,
        /// Whether the legend is drawn; it is for more than one series, and for a pie, when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub legend: Option<bool>,
        /// The rest of what the chart says: its kind of marks, axis titles, number format, legend place.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub spec: Option<ChartSpec>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

/// What a chart is drawn as, worked out from its `kind` and its `spec`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChartShape {
    Columns,
    StackedColumns,
    Lines,
    Areas,
    StackedAreas,
    Pie,
    Doughnut,
    Scatter,
    Combo,
}

impl ChartShape {
    /// The most series that are drawn: more would only be a smudge.
    pub const MOST_SERIES: usize = 12;
    /// The most categories (bar groups, points of a line, slices) that are drawn.
    pub const MOST_CATEGORIES: usize = 40;
    /// The most points of a scatter chart.
    pub const MOST_POINTS: usize = 400;

    /// The most categories a chart of this shape draws.
    pub fn most_categories(self) -> usize {
        if self == ChartShape::Scatter {
            ChartShape::MOST_POINTS
        } else {
            ChartShape::MOST_CATEGORIES
        }
    }

    /// The names a person or an agent may use, as `set_chart_data` lists them.
    pub const NAMES: [&'static str; 9] = [
        "column",
        "stackedColumn",
        "line",
        "area",
        "stackedArea",
        "pie",
        "doughnut",
        "scatter",
        "combo",
    ];

    /// A shape by name, forgiving of case, dashes and the other word for it (`bar`, `donut`).
    pub fn parse(text: &str) -> Option<ChartShape> {
        let key: String = text
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .map(|c| c.to_ascii_lowercase())
            .collect();
        Some(match key.as_str() {
            "column" | "columns" | "bar" | "bars" => ChartShape::Columns,
            "stackedcolumn" | "stackedbar" | "stacked" => ChartShape::StackedColumns,
            "line" | "lines" => ChartShape::Lines,
            "area" => ChartShape::Areas,
            "stackedarea" => ChartShape::StackedAreas,
            "pie" => ChartShape::Pie,
            "doughnut" | "donut" => ChartShape::Doughnut,
            "scatter" | "point" | "xy" => ChartShape::Scatter,
            "combo" | "barline" => ChartShape::Combo,
            _ => return None,
        })
    }

    /// The name `parse` reads back.
    pub fn name(self) -> &'static str {
        match self {
            ChartShape::Columns => "column",
            ChartShape::StackedColumns => "stackedColumn",
            ChartShape::Lines => "line",
            ChartShape::Areas => "area",
            ChartShape::StackedAreas => "stackedArea",
            ChartShape::Pie => "pie",
            ChartShape::Doughnut => "doughnut",
            ChartShape::Scatter => "scatter",
            ChartShape::Combo => "combo",
        }
    }

    /// The words for a person who cannot see the chart.
    pub fn label(self) -> &'static str {
        match self {
            ChartShape::Columns => "Bar chart",
            ChartShape::StackedColumns => "Stacked bar chart",
            ChartShape::Lines => "Line chart",
            ChartShape::Areas => "Area chart",
            ChartShape::StackedAreas => "Stacked area chart",
            ChartShape::Pie => "Pie chart",
            ChartShape::Doughnut => "Doughnut chart",
            ChartShape::Scatter => "Scatter chart",
            ChartShape::Combo => "Combination chart",
        }
    }

    /// What a chart of this shape says in its fields: the plain `kind` an older build draws it as,
    /// the mark when `kind` is not enough, whether the series are stacked, and whether it has a hole.
    pub fn fields(self) -> (ChartKind, Option<ChartMark>, bool, bool) {
        match self {
            ChartShape::Columns | ChartShape::Combo => (ChartKind::Bar, None, false, false),
            ChartShape::StackedColumns => (ChartKind::Bar, Some(ChartMark::Bar), true, false),
            ChartShape::Lines => (ChartKind::Line, None, false, false),
            ChartShape::Areas => (ChartKind::Line, Some(ChartMark::Area), false, false),
            ChartShape::StackedAreas => (ChartKind::Line, Some(ChartMark::Area), true, false),
            ChartShape::Pie => (ChartKind::Pie, None, false, false),
            ChartShape::Doughnut => (ChartKind::Pie, Some(ChartMark::Arc), false, true),
            ChartShape::Scatter => (ChartKind::Line, Some(ChartMark::Point), false, false),
        }
    }

    /// Drawn on two number axes with the bars or marks of each category.
    pub fn is_round(self) -> bool {
        matches!(self, ChartShape::Pie | ChartShape::Doughnut)
    }
}

impl ChartSpec {
    /// The spec without the empty parts a change leaves behind (`encoding: {}`); none when nothing is left.
    pub fn pruned(&self) -> Option<ChartSpec> {
        fn prune(value: &mut Value) {
            if let Value::Object(map) = value {
                map.values_mut().for_each(prune);
                map.retain(|_, v| !v.as_object().is_some_and(serde_json::Map::is_empty));
            }
        }
        let mut value = serde_json::to_value(self).ok()?;
        prune(&mut value);
        if value.as_object().is_some_and(serde_json::Map::is_empty) {
            None
        } else {
            serde_json::from_value(value).ok()
        }
    }
}

impl ChartEl {
    fn encoding(&self) -> Option<&ChartEncoding> {
        self.spec.as_ref()?.encoding.as_ref()
    }

    /// What the chart is drawn as.
    pub fn shape(&self) -> ChartShape {
        let marks: Vec<&ChartMark> = self.series.iter().filter_map(|s| s.mark.as_ref()).collect();
        let bars = marks.iter().any(|m| matches!(m, ChartMark::Bar));
        let lines = marks.iter().any(|m| matches!(m, ChartMark::Line));
        if bars && lines {
            return ChartShape::Combo;
        }
        let stacked = self
            .encoding()
            .and_then(|e| e.y.as_ref())
            .and_then(|y| y.stack)
            == Some(true);
        let ring = self
            .spec
            .as_ref()
            .and_then(|s| s.inner_radius)
            .is_some_and(|r| r > 0.0);
        let base = match self.spec.as_ref().and_then(|s| s.mark.clone()) {
            Some(mark) => mark,
            None => match self.kind {
                ChartKind::Bar => ChartMark::Bar,
                ChartKind::Line => ChartMark::Line,
                ChartKind::Pie => ChartMark::Arc,
            },
        };
        match base {
            ChartMark::Point => ChartShape::Scatter,
            ChartMark::Arc if ring => ChartShape::Doughnut,
            ChartMark::Arc => ChartShape::Pie,
            ChartMark::Area if stacked => ChartShape::StackedAreas,
            ChartMark::Area => ChartShape::Areas,
            ChartMark::Bar if stacked => ChartShape::StackedColumns,
            ChartMark::Bar => ChartShape::Columns,
            ChartMark::Line => ChartShape::Lines,
        }
    }

    fn title_of(axis: Option<&ChartAxis>) -> Option<&str> {
        axis?
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
    }

    /// The words under the horizontal axis.
    pub fn x_title(&self) -> Option<&str> {
        Self::title_of(self.encoding()?.x.as_ref())
    }

    /// The words at the top of the vertical axis.
    pub fn y_title(&self) -> Option<&str> {
        Self::title_of(self.encoding()?.y.as_ref())
    }

    /// How the numbers are written, when the chart says (and says it in a pattern that reads).
    pub fn number_format(&self) -> Option<NumberFormat> {
        let text = self.encoding()?.y.as_ref()?.format.as_deref()?;
        NumberFormat::parse(text).ok()
    }

    /// Where the legend is, when the chart says.
    pub fn legend_orient(&self) -> Option<&LegendOrient> {
        self.encoding()?
            .color
            .as_ref()?
            .legend
            .as_ref()?
            .orient
            .as_ref()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn chart(value: Value) -> ChartEl {
        let mut base = json!({ "id": "c-1", "x": 0, "y": 0, "w": 400, "h": 300, "categories": ["A"], "series": [{ "name": "S", "values": [1] }] });
        if let (Value::Object(target), Value::Object(more)) = (&mut base, value) {
            target.extend(more);
        }
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn an_old_chart_reads_as_it_always_did_and_writes_back_the_same_fields() {
        let el = chart(json!({ "kind": "bar", "title": "Sales", "labels": true }));
        assert_eq!(el.shape(), ChartShape::Columns);
        assert!(el.spec.is_none() && el.x_title().is_none() && el.number_format().is_none());
        let back = serde_json::to_value(&el).unwrap();
        assert!(back.get("spec").is_none(), "{back}");
        assert!(back["series"][0].get("mark").is_none() && back["series"][0].get("x").is_none());
        for (kind, shape) in [("line", ChartShape::Lines), ("pie", ChartShape::Pie)] {
            assert_eq!(chart(json!({ "kind": kind })).shape(), shape);
        }
    }

    #[test]
    fn a_spec_says_how_the_marks_are_drawn_and_what_is_written_on_the_axes() {
        let el = chart(json!({ "kind": "line", "spec": {
            "mark": "area",
            "encoding": { "x": { "title": "Quarter" }, "y": { "title": "Revenue", "format": "$#,##0", "stack": true },
                "color": { "legend": { "orient": "right" } } }
        } }));
        assert_eq!(el.shape(), ChartShape::StackedAreas);
        assert_eq!(el.x_title(), Some("Quarter"));
        assert_eq!(el.y_title(), Some("Revenue"));
        assert_eq!(el.number_format().unwrap().apply(1500.0), "$1,500");
        assert_eq!(el.legend_orient(), Some(&LegendOrient::Right));
        let ring = chart(json!({ "kind": "pie", "spec": { "mark": "arc", "innerRadius": 0.5 } }));
        assert_eq!(ring.shape(), ChartShape::Doughnut);
        let dots = chart(json!({ "kind": "line", "spec": { "mark": "point" } }));
        assert_eq!(dots.shape(), ChartShape::Scatter);
    }

    #[test]
    fn a_series_with_a_bar_and_one_with_a_line_make_a_combination() {
        let el = chart(json!({ "kind": "bar", "series": [
            { "name": "Sales", "values": [1], "mark": "bar" }, { "name": "Margin", "values": [2], "mark": "line" }
        ] }));
        assert_eq!(el.shape(), ChartShape::Combo);
        let only_bars = chart(
            json!({ "kind": "bar", "series": [{ "name": "A", "values": [1], "mark": "bar" }] }),
        );
        assert_eq!(only_bars.shape(), ChartShape::Columns);
    }

    #[test]
    fn what_a_newer_build_wrote_in_a_spec_survives() {
        let text = json!({ "kind": "bar", "spec": { "mark": "bar", "future": { "kept": 1 },
            "encoding": { "y": { "title": "T", "scale": "log" } } } });
        let el = chart(text);
        let back = serde_json::to_value(&el).unwrap();
        assert_eq!(back["spec"]["future"]["kept"], 1);
        assert_eq!(back["spec"]["encoding"]["y"]["scale"], "log");
    }

    #[test]
    fn every_shape_name_reads_back_and_its_fields_say_the_same_shape() {
        for name in ChartShape::NAMES {
            let shape = ChartShape::parse(name).unwrap_or_else(|| panic!("{name}"));
            assert_eq!(shape.name(), name);
            let (kind, mark, stacked, ring) = shape.fields();
            if shape == ChartShape::Combo {
                continue;
            }
            let spec = json!({ "mark": mark, "innerRadius": ring.then_some(0.5), "encoding": { "y": { "stack": stacked.then_some(true) } } });
            let el = chart(json!({ "kind": kind, "spec": spec }));
            assert_eq!(el.shape(), shape, "{name}");
        }
        assert_eq!(
            ChartShape::parse("Stacked-Bar"),
            Some(ChartShape::StackedColumns)
        );
        assert_eq!(ChartShape::parse("donut"), Some(ChartShape::Doughnut));
        assert_eq!(ChartShape::parse("waterfall"), None);
    }

    #[test]
    fn a_pruned_spec_drops_what_is_empty_and_is_none_when_nothing_is_left() {
        let el = chart(
            json!({ "kind": "bar", "spec": { "encoding": { "x": {}, "y": { "title": "T" } } } }),
        );
        let pruned = el.spec.unwrap().pruned().unwrap();
        let value = serde_json::to_value(&pruned).unwrap();
        assert_eq!(value, json!({ "encoding": { "y": { "title": "T" } } }));
        let empty = chart(json!({ "kind": "bar", "spec": { "encoding": { "x": {} } } }));
        assert!(empty.spec.unwrap().pruned().is_none());
    }
}
