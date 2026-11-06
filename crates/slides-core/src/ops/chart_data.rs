//! Giving a chart its numbers and saying how it looks, in one step: the table (as CSV text, as rows or as series), the
//! kind, the titles of the axes, the way numbers are written, the labels and the legend. Every mistake names the field.
//!
//! This is the work of the `set_chart_data` tool, not an operation of its own: it works out the chart a call asks for
//! from the chart there is (`ChartInput::apply`), and the changes it makes are `patch_elements` operations
//! (`operations`), so they are undone, marked and kept like any other change to an element.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::chart_table::{self, Table};
use crate::error::{Error, Result};
use crate::model::{ChartEl, ChartMark, ChartShape, ChartSpec, NumberFormat};

/// The tool's name, for the messages.
const NAME: &str = "set_chart_data";

/// The fields a call may have, with what each is: `text`, `list`, `flag` or `number`. `slide`, `id` and `deck` say which
/// chart, and are read by the tool.
const FIELDS: [(&str, &str); 14] = [
    ("kind", "text"),
    ("title", "text"),
    ("csv", "text"),
    ("rows", "list"),
    ("categories", "list"),
    ("series", "list"),
    ("lines", "list"),
    ("xTitle", "text"),
    ("yTitle", "text"),
    ("format", "text"),
    ("labels", "flag"),
    ("legend", "flag"),
    ("legendPosition", "text"),
    ("innerRadius", "number"),
];

/// What a call to `set_chart_data` asks for, checked. Anything left out stays as it is.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartInput {
    pub kind: Option<String>,
    pub title: Option<String>,
    pub csv: Option<String>,
    pub rows: Option<Vec<Vec<Value>>>,
    pub categories: Option<Vec<String>>,
    pub series: Option<Vec<Value>>,
    pub lines: Option<Vec<String>>,
    pub x_title: Option<String>,
    pub y_title: Option<String>,
    pub format: Option<String>,
    pub labels: Option<bool>,
    pub legend: Option<bool>,
    pub legend_position: Option<String>,
    pub inner_radius: Option<f64>,
}

/// What a chart came to.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartDataSet {
    pub id: String,
    /// What the chart is drawn as now.
    pub kind: String,
    pub categories: u32,
    pub series: Vec<String>,
    /// What the chart will not show as given, such as a pie drawing the first series only.
    pub notes: Vec<String>,
}

fn bad(why: impl std::fmt::Display) -> Error {
    Error::bad_input(NAME, why)
}

/// Sets (or, with none, takes away) the value at `path` of a JSON object, making the objects on the way.
fn put(root: &mut Value, path: &[&str], value: Option<Value>) {
    let Some((last, parents)) = path.split_last() else {
        return;
    };
    let mut at = root;
    for key in parents {
        if !at.is_object() {
            *at = json!({});
        }
        at = &mut at[*key];
    }
    if !at.is_object() {
        *at = json!({});
    }
    match value {
        Some(value) => at[*last] = value,
        None => {
            if let Some(map) = at.as_object_mut() {
                map.remove(*last);
            }
        }
    }
}

/// Words that are set, or none for empty words.
fn words(text: &str) -> Option<Value> {
    let text = text.trim();
    (!text.is_empty()).then(|| json!(text))
}

/// The `patch_elements` operations that turn the chart `id` of `slide` into `changed`. The spec is taken off first, since
/// a merge patch would only add to it.
pub(crate) fn operations(slide: &str, id: &str, changed: &ChartEl) -> Vec<(String, Value)> {
    let whole = serde_json::to_value(changed).unwrap_or(Value::Null);
    let mut patch = json!({});
    for key in [
        "kind",
        "title",
        "categories",
        "series",
        "labels",
        "legend",
        "spec",
    ] {
        patch[key] = whole.get(key).cloned().unwrap_or(Value::Null);
    }
    let patching = |patch: Value| {
        (
            "patch_elements".to_owned(),
            json!({ "slide": slide, "patches": [{ "id": id, "patch": patch }] }),
        )
    };
    vec![patching(json!({ "spec": null })), patching(patch)]
}

impl ChartInput {
    /// Reads the arguments of a call: a field this does not know, or one of the wrong kind, is named.
    pub fn read(args: &Value) -> Result<ChartInput> {
        let Some(map) = args.as_object() else {
            return Err(bad("the input must be an object of named values"));
        };
        for (key, value) in map {
            if matches!(key.as_str(), "deck" | "slide" | "id") || value.is_null() {
                continue;
            }
            let Some((_, kind)) = FIELDS.iter().find(|(name, _)| *name == key.as_str()) else {
                let names: Vec<&str> = FIELDS.iter().map(|(name, _)| *name).collect();
                return Err(bad(format!(
                    "`{key}` is not a field. The fields are: slide, id, {}",
                    names.join(", ")
                )));
            };
            let (fits, wanted) = match *kind {
                "text" => (value.is_string(), "text"),
                "list" => (value.is_array(), "a list"),
                "flag" => (value.is_boolean(), "true or false"),
                _ => (value.is_number(), "a number"),
            };
            if !fits {
                return Err(bad(format!("`{key}` must be {wanted}")));
            }
        }
        serde_json::from_value(args.clone()).map_err(bad)
    }

    /// The table the call gives, if it gives one.
    fn table(&self, chart: &ChartEl, scatter: bool) -> Result<Option<Table>> {
        let given = [
            self.csv.is_some(),
            self.rows.is_some(),
            self.series.is_some(),
        ];
        if given.iter().filter(|g| **g).count() > 1 {
            return Err(bad(
                "give the numbers once: `csv`, `rows` or `series`, not more than one of them",
            ));
        }
        if self.categories.is_some() && self.series.is_none() {
            return Err(bad(
                "`categories` goes with `series`; `csv` and `rows` carry their own",
            ));
        }
        let table = if let Some(text) = &self.csv {
            Some(chart_table::from_csv(text, scatter))
        } else if let Some(rows) = &self.rows {
            Some(chart_table::from_rows(rows, scatter))
        } else {
            self.series.as_ref().map(|list| {
                chart_table::from_series(self.categories.as_deref(), list, &chart.categories)
            })
        };
        table.transpose().map_err(bad)
    }

    /// The spec the chart will have: the kind's marks, the titles, the format and the legend, on top of what it had.
    fn spec(&self, chart: &ChartEl, shape: ChartShape, wanted: bool) -> Result<Option<ChartSpec>> {
        let mut spec = match &chart.spec {
            Some(spec) => serde_json::to_value(spec).map_err(bad)?,
            None => json!({}),
        };
        let ring = shape == ChartShape::Doughnut;
        if wanted {
            let (_, mark, stacked, _) = shape.fields();
            put(&mut spec, &["mark"], mark.map(|m| json!(m)));
            put(&mut spec, &["innerRadius"], None);
            put(
                &mut spec,
                &["encoding", "y", "stack"],
                stacked.then(|| json!(true)),
            );
        }
        if let Some(radius) = self.inner_radius {
            if !ring {
                return Err(bad(
                    "`innerRadius` is for a doughnut: set `kind` to doughnut",
                ));
            }
            if !(0.1..=0.9).contains(&radius) {
                return Err(bad("`innerRadius` is between 0.1 and 0.9"));
            }
        }
        if ring && (wanted || self.inner_radius.is_some()) {
            put(
                &mut spec,
                &["innerRadius"],
                Some(json!(self.inner_radius.unwrap_or(0.5))),
            );
        }
        if let Some(title) = &self.x_title {
            put(&mut spec, &["encoding", "x", "title"], words(title));
        }
        if let Some(title) = &self.y_title {
            put(&mut spec, &["encoding", "y", "title"], words(title));
        }
        if let Some(format) = &self.format {
            let format = format.trim();
            if !format.is_empty() {
                NumberFormat::parse(format).map_err(|why| bad(format!("`format` {why}")))?;
            }
            put(&mut spec, &["encoding", "y", "format"], words(format));
        }
        if let Some(place) = &self.legend_position {
            let place = place.trim().to_lowercase();
            let value = match place.as_str() {
                "" | "default" | "auto" => None,
                "top" | "bottom" | "left" | "right" => Some(json!(place)),
                _ => return Err(bad("`legendPosition` is top, bottom, left or right")),
            };
            put(&mut spec, &["encoding", "color", "legend", "orient"], value);
        }
        let spec: ChartSpec =
            serde_json::from_value(spec).map_err(|e| bad(format!("the chart's spec: {e}")))?;
        Ok(spec.pruned())
    }

    /// Marks the series of a combination: the ones `lines` names as lines, else what they were or what the table says, else
    /// the first as columns and the rest as lines.
    fn mark_combo(
        &self,
        chart: &mut ChartEl,
        before: &[(String, Option<ChartMark>)],
    ) -> Result<()> {
        if chart.series.len() < 2 {
            return Err(bad(
                "a combo chart needs at least two series: some drawn as columns and some as a line",
            ));
        }
        let key = |name: &str| name.trim().to_lowercase();
        let lines: Option<Vec<String>> = self
            .lines
            .as_ref()
            .map(|names| names.iter().map(|n| key(n)).collect());
        if let Some(wanted) = &lines {
            for name in wanted {
                if !chart.series.iter().any(|s| key(&s.name) == *name) {
                    let names: Vec<&str> = chart.series.iter().map(|s| s.name.as_str()).collect();
                    return Err(bad(format!(
                        "`lines` names `{name}`, which is not a series. The series are: {}",
                        names.join(", ")
                    )));
                }
            }
        }
        for (i, series) in chart.series.iter_mut().enumerate() {
            let name = key(&series.name);
            series.mark = Some(match (&lines, series.mark.clone()) {
                (Some(wanted), _) if wanted.contains(&name) => ChartMark::Line,
                (Some(_), _) => ChartMark::Bar,
                (None, Some(mark)) => mark,
                (None, None) => before
                    .iter()
                    .find(|(was, _)| *was == name)
                    .and_then(|(_, mark)| mark.clone())
                    .unwrap_or(if i == 0 {
                        ChartMark::Bar
                    } else {
                        ChartMark::Line
                    }),
            });
        }
        let bars = chart
            .series
            .iter()
            .filter(|s| s.mark == Some(ChartMark::Bar))
            .count();
        if bars == 0 || bars == chart.series.len() {
            return Err(bad(
                "a combo chart needs at least one series drawn as columns and at least one drawn as a line (`lines` names the ones drawn as lines)",
            ));
        }
        Ok(())
    }

    /// The chart a call asks for, made from `chart` (which is left as it is), and what is to be told of it.
    pub fn apply(&self, chart: &ChartEl) -> Result<(ChartEl, ChartDataSet)> {
        let wanted = match self.kind.as_deref() {
            Some(name) => Some(ChartShape::parse(name).ok_or_else(|| {
                bad(format!(
                    "`kind` is one of {}, not `{name}`",
                    ChartShape::NAMES.join(", ")
                ))
            })?),
            None => None,
        };
        let before: Vec<(String, Option<ChartMark>)> = chart
            .series
            .iter()
            .map(|s| (s.name.trim().to_lowercase(), s.mark.clone()))
            .collect();
        let was = chart.shape();
        let scatter = wanted.unwrap_or(was) == ChartShape::Scatter;
        let counted = self.table(chart, scatter)?;
        let mut notes = Vec::new();
        let given = counted.is_some();
        let mut next = chart.clone();
        if let Some(table) = counted {
            let shape = wanted.unwrap_or(was);
            if table.categories.len() > shape.most_categories() {
                return Err(bad(format!(
                    "the table has {} categories but a chart draws at most {}: leave some out",
                    table.categories.len(),
                    shape.most_categories()
                )));
            }
            if table.series.len() > ChartShape::MOST_SERIES {
                return Err(bad(format!(
                    "the table has {} series but a chart draws at most {}: leave some out",
                    table.series.len(),
                    ChartShape::MOST_SERIES
                )));
            }
            if table.blanks > 0 {
                notes.push(format!("{} empty cells were taken as 0.", table.blanks));
            }
            next.categories = table.categories;
            next.series = table.series;
        }
        // A combination stays one when only its numbers change.
        let shape = wanted.unwrap_or_else(|| {
            if was == ChartShape::Combo {
                ChartShape::Combo
            } else {
                next.shape()
            }
        });
        if shape == ChartShape::Combo {
            self.mark_combo(&mut next, &before)?;
        } else {
            if self.lines.is_some() {
                return Err(bad("`lines` is for a combo chart: set `kind` to combo"));
            }
            if wanted.is_some() || given {
                next.series.iter_mut().for_each(|s| s.mark = None);
            }
        }
        if let Some((kind, ..)) = wanted.map(ChartShape::fields) {
            next.kind = kind;
        }
        next.spec = self.spec(&next, shape, wanted.is_some())?;
        if let Some(title) = &self.title {
            next.title = (!title.trim().is_empty()).then(|| title.trim().to_owned());
        }
        if let Some(labels) = self.labels {
            next.labels = labels;
        }
        if let Some(legend) = self.legend {
            next.legend = Some(legend);
        }
        if next.shape() != shape {
            return Err(bad(
                "the chart would not come out as asked: check `kind` and the marks of the series",
            ));
        }
        if next.categories.len() > shape.most_categories() {
            notes.push(format!(
                "Only the first {} categories are drawn.",
                shape.most_categories()
            ));
        }
        if shape.is_round() && next.series.len() > 1 {
            notes.push("A pie or a doughnut draws the first series only.".to_owned());
        }
        if matches!(shape, ChartShape::Areas | ChartShape::StackedAreas)
            && next
                .series
                .iter()
                .any(|s| s.values.iter().any(|v| *v < 0.0))
        {
            notes.push(
                "An area is drawn down from zero, so numbers below zero are drawn as zero."
                    .to_owned(),
            );
        }
        if self.legend_position.is_some() && shape.is_round() {
            notes.push("A pie or a doughnut keeps its legend at its side.".to_owned());
        }
        let out = ChartDataSet {
            id: next.base.id.clone(),
            kind: shape.name().to_owned(),
            categories: u32::try_from(next.categories.len()).unwrap_or(u32::MAX),
            series: next.series.iter().map(|s| s.name.clone()).collect(),
            notes,
        };
        Ok((next, out))
    }
}
