//! The table of numbers `set_chart_data` is given, as CSV text, as rows or as a list of series, read into the
//! categories and series of a chart. A mistake names the field and the place in it.

use serde_json::Value;

use crate::model::{ChartMark, ChartSeries, Extra, is_color};

/// What a table came to.
pub(super) struct Table {
    pub categories: Vec<String>,
    pub series: Vec<ChartSeries>,
    /// How many empty cells were taken as zero.
    pub blanks: usize,
}

/// The longest piece of a cell that an error quotes.
const QUOTED: usize = 30;

fn quote(cell: &str) -> String {
    let short: String = cell.chars().take(QUOTED).collect();
    if short.len() < cell.len() {
        format!("{short}\u{2026}")
    } else {
        short
    }
}

/// A number as a person writes it in a cell: thousands marks, a currency sign or a percent sign are left out
/// (12% is 12).
pub(super) fn parse_number(text: &str) -> Option<f64> {
    let cleaned: String = text
        .trim()
        .chars()
        .filter(|c| !matches!(c, ',' | '$' | '\u{20ac}' | '\u{a3}' | '%' | ' ' | '_'))
        .collect();
    cleaned.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// The cells of CSV text. The separator is a comma, else a semicolon or a tab, whichever the first line uses; a cell in
/// double quotes may hold the separator, a line break and a doubled quote. Empty lines are left out.
pub(super) fn csv_grid(text: &str) -> Vec<Vec<String>> {
    let text = text.trim_start_matches('\u{feff}');
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let separator = if first.contains('\t') {
        '\t'
    } else if !first.contains(',') && first.contains(';') {
        ';'
    } else {
        ','
    };
    fn end_row(row: &mut Vec<String>, rows: &mut Vec<Vec<String>>) {
        if row.iter().any(|c| !c.trim().is_empty()) {
            rows.push(std::mem::take(row));
        } else {
            row.clear();
        }
    }
    let mut rows: Vec<Vec<String>> = Vec::new();
    let (mut row, mut cell, mut quoted) = (Vec::new(), String::new(), false);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted => {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cell.push('"');
                } else {
                    quoted = false;
                }
            }
            '"' if cell.is_empty() => quoted = true,
            c if c == separator && !quoted => row.push(std::mem::take(&mut cell)),
            '\n' | '\r' if !quoted => {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut cell));
                end_row(&mut row, &mut rows);
            }
            c => cell.push(c),
        }
    }
    row.push(cell);
    end_row(&mut row, &mut rows);
    rows
}

fn plain_series(name: String, values: Vec<f64>, x: Vec<f64>) -> ChartSeries {
    ChartSeries {
        name,
        values,
        color: None,
        mark: None,
        x,
        extra: Extra::new(),
    }
}

/// A table of cells: the first row names the series, the first column the categories (for a scatter chart, the
/// numbers along the horizontal axis), and every other cell is a number.
fn from_grid(grid: &[Vec<String>], label: &str, scatter: bool) -> Result<Table, String> {
    let header = grid
        .first()
        .filter(|_| grid.len() >= 2)
        .filter(|h| h.len() >= 2);
    let Some(header) = header else {
        return Err(format!(
            "`{label}` needs a header row and at least one row after it, with a column of categories and a column of numbers for each series"
        ));
    };
    let names: Vec<String> = header[1..]
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let n = n.trim();
            if n.is_empty() {
                format!("Series {}", i + 1)
            } else {
                n.to_owned()
            }
        })
        .collect();
    let mut categories = Vec::new();
    let mut xs = Vec::new();
    let mut columns: Vec<Vec<f64>> = vec![Vec::new(); names.len()];
    let mut blanks = 0;
    for (r, row) in grid.iter().enumerate().skip(1) {
        let line = r + 1;
        if row.len() > header.len() {
            return Err(format!(
                "`{label}` row {line} has {} cells but the header has {}",
                row.len(),
                header.len()
            ));
        }
        let first = row.first().map_or("", |c| c.trim());
        if scatter {
            xs.push(parse_number(first).ok_or_else(|| {
                format!(
                    "`{label}` row {line}, first column: \u{201c}{}\u{201d} is not a number (a scatter chart needs the horizontal number first)",
                    quote(first)
                )
            })?);
        }
        categories.push(first.to_owned());
        for (c, column) in columns.iter_mut().enumerate() {
            let cell = row.get(c + 1).map_or("", |v| v.trim());
            if cell.is_empty() {
                blanks += 1;
                column.push(0.0);
                continue;
            }
            column.push(parse_number(cell).ok_or_else(|| {
                format!(
                    "`{label}` row {line}, column \u{201c}{}\u{201d}: \u{201c}{}\u{201d} is not a number",
                    quote(&names[c]),
                    quote(cell)
                )
            })?);
        }
    }
    let series = names
        .into_iter()
        .zip(columns)
        .map(|(name, values)| plain_series(name, values, xs.clone()))
        .collect();
    Ok(Table {
        categories,
        series,
        blanks,
    })
}

pub(super) fn from_csv(text: &str, scatter: bool) -> Result<Table, String> {
    from_grid(&csv_grid(text), "csv", scatter)
}

pub(super) fn from_rows(rows: &[Vec<Value>], scatter: bool) -> Result<Table, String> {
    let grid: Vec<Vec<String>> = rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| match cell {
                    Value::String(s) => s.clone(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                })
                .collect()
        })
        .collect();
    from_grid(&grid, "rows", scatter)
}

fn number_of(value: &Value, at: &str) -> Result<f64, String> {
    let parsed = match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => parse_number(s),
        _ => None,
    };
    parsed
        .filter(|v| v.is_finite())
        .ok_or_else(|| format!("`{at}` is not a number"))
}

fn numbers(value: Option<&Value>, at: &str) -> Result<Option<Vec<f64>>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => items
            .iter()
            .enumerate()
            .map(|(j, v)| number_of(v, &format!("{at}[{j}]")))
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(format!("`{at}` must be a list of numbers")),
    }
}

/// A list of series, each `{name, values, color?, x?, mark?}`. The categories are `given`, else the chart's
/// `existing` ones when they fit, else the numbers 1, 2, 3 ....
pub(super) fn from_series(
    given: Option<&[String]>,
    list: &[Value],
    existing: &[String],
) -> Result<Table, String> {
    if list.is_empty() {
        return Err("`series` is empty: give at least one, {name, values}".to_owned());
    }
    let mut series = Vec::new();
    for (i, item) in list.iter().enumerate() {
        let at = format!("series[{i}]");
        let object = item
            .as_object()
            .ok_or_else(|| format!("`{at}` must be an object {{name, values}}"))?;
        let name = object
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .ok_or_else(|| format!("`{at}.name` is missing: name the series"))?;
        let values = numbers(object.get("values"), &format!("{at}.values"))?
            .ok_or_else(|| format!("`{at}.values` is missing: give a number for each category"))?;
        let x = numbers(object.get("x"), &format!("{at}.x"))?.unwrap_or_default();
        let color = match object.get("color") {
            None | Some(Value::Null) => None,
            Some(Value::String(c)) if is_color(c) => Some(c.clone()),
            Some(_) => {
                return Err(format!(
                    "`{at}.color` must be a theme colour (accent1 to accent6, text1, text2, bg1, bg2) or #rrggbb"
                ));
            }
        };
        let mark = match object.get("mark") {
            None | Some(Value::Null) => None,
            Some(Value::String(m)) if m == "bar" => Some(ChartMark::Bar),
            Some(Value::String(m)) if m == "line" => Some(ChartMark::Line),
            Some(_) => return Err(format!("`{at}.mark` is `bar` or `line`")),
        };
        let mut one = plain_series(name.to_owned(), values, x);
        one.color = color;
        one.mark = mark;
        series.push(one);
    }
    let widest = series.iter().map(|s| s.values.len()).max().unwrap_or(0);
    let categories: Vec<String> = match given {
        Some(names) => names.to_vec(),
        None if existing.len() == widest => existing.to_vec(),
        None => (1..=widest).map(|n| n.to_string()).collect(),
    };
    for (i, s) in series.iter().enumerate() {
        if s.values.len() != categories.len() {
            return Err(format!(
                "`series[{i}].values` has {} numbers but there are {} categories: give one number for each",
                s.values.len(),
                categories.len()
            ));
        }
        if !s.x.is_empty() && s.x.len() != s.values.len() {
            return Err(format!(
                "`series[{i}].x` has {} numbers but `values` has {}",
                s.x.len(),
                s.values.len()
            ));
        }
    }
    Ok(Table {
        categories,
        series,
        blanks: 0,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn csv_is_read_with_quotes_other_separators_and_empty_lines() {
        let grid = csv_grid(
            "\u{feff}Quarter,\"Sales, EU\",Margin\r\nQ1,\"1,200\",3\n\nQ2,\"he said \"\"hi\"\"\",4\n",
        );
        assert_eq!(grid.len(), 3);
        assert_eq!(grid[0], ["Quarter", "Sales, EU", "Margin"]);
        assert_eq!(grid[1][1], "1,200");
        assert_eq!(grid[2][1], "he said \"hi\"");
        assert_eq!(csv_grid("a;b\n1;2")[1], ["1", "2"]);
        assert_eq!(csv_grid("a\tb\n1\t2")[1], ["1", "2"]);
    }

    #[test]
    fn a_csv_table_gives_categories_and_a_series_for_each_other_column() {
        let t = from_csv(
            "Quarter,2025,2026\nQ1,10,\"1,200\"\nQ2,20,30%\nQ3,,5",
            false,
        )
        .unwrap();
        assert_eq!(t.categories, ["Q1", "Q2", "Q3"]);
        assert_eq!(t.series.len(), 2);
        assert_eq!(t.series[0].name, "2025");
        assert_eq!(t.series[0].values, [10.0, 20.0, 0.0]);
        assert_eq!(t.series[1].values, [1200.0, 30.0, 5.0]);
        assert_eq!(t.blanks, 1, "one empty cell was taken as zero");
    }

    #[test]
    fn a_scatter_table_has_its_horizontal_numbers_first() {
        let t = from_csv("Height,Weight\n150,50\n160,58\n180,80", true).unwrap();
        assert_eq!(t.series[0].x, [150.0, 160.0, 180.0]);
        assert_eq!(t.series[0].values, [50.0, 58.0, 80.0]);
        let error = from_csv("Group,Weight\nA,50", true).err().unwrap();
        assert!(
            error.contains("`csv` row 2, first column") && error.contains("\u{201c}A\u{201d}"),
            "{error}"
        );
    }

    #[test]
    fn a_mistake_in_a_table_names_the_field_the_row_and_the_column() {
        let error = from_csv("Q,Sales\nQ1,ten", false).err().unwrap();
        assert!(
            error.contains("`csv` row 2, column \u{201c}Sales\u{201d}")
                && error.contains("\u{201c}ten\u{201d} is not a number"),
            "{error}"
        );
        assert!(
            from_csv("Q,Sales", false)
                .err()
                .unwrap()
                .contains("`csv` needs a header row")
        );
        assert!(
            from_csv("Q,Sales\nQ1,1,2", false)
                .err()
                .unwrap()
                .contains("row 2 has 3 cells but the header has 2")
        );
        let rows = vec![
            vec![json!("Q"), json!("Sales")],
            vec![json!("Q1"), json!(true)],
        ];
        assert!(
            from_rows(&rows, false)
                .err()
                .unwrap()
                .contains("`rows` row 2, column")
        );
        let good = vec![
            vec![json!(""), json!("Sales")],
            vec![json!("Q1"), json!(4.5)],
            vec![json!("Q2"), json!("7")],
        ];
        assert_eq!(
            from_rows(&good, false).unwrap().series[0].values,
            [4.5, 7.0]
        );
    }

    #[test]
    fn series_are_checked_field_by_field() {
        let ok = from_series(
            Some(&["A".to_owned(), "B".to_owned()]),
            &[json!({ "name": "S", "values": [1, "2"], "color": "accent3", "mark": "line" })],
            &[],
        )
        .unwrap();
        assert_eq!(ok.series[0].values, [1.0, 2.0]);
        assert_eq!(ok.series[0].color.as_deref(), Some("accent3"));
        assert_eq!(ok.series[0].mark, Some(ChartMark::Line));
        let cats = ["A".to_owned(), "B".to_owned()];
        for (list, why) in [
            (json!([]), "`series` is empty"),
            (json!([5]), "`series[0]` must be an object"),
            (json!([{ "values": [1, 2] }]), "`series[0].name` is missing"),
            (json!([{ "name": "S" }]), "`series[0].values` is missing"),
            (
                json!([{ "name": "S", "values": [1, "x"] }]),
                "`series[0].values[1]` is not a number",
            ),
            (
                json!([{ "name": "S", "values": [1, 2], "color": "pink" }]),
                "`series[0].color`",
            ),
            (
                json!([{ "name": "S", "values": [1, 2], "mark": "dots" }]),
                "`series[0].mark`",
            ),
            (
                json!([{ "name": "S", "values": [1, 2, 3] }]),
                "`series[0].values` has 3 numbers but there are 2 categories",
            ),
            (
                json!([{ "name": "S", "values": [1, 2], "x": [1] }]),
                "`series[0].x` has 1 numbers but `values` has 2",
            ),
        ] {
            let list = list.as_array().unwrap().clone();
            let error = from_series(Some(&cats), &list, &[]).err().unwrap();
            assert!(error.contains(why), "{why}: {error}");
        }
    }

    #[test]
    fn without_categories_the_charts_own_are_kept_when_they_fit_else_numbers() {
        let list = [json!({ "name": "S", "values": [1, 2, 3] })];
        let same = from_series(
            None,
            &list,
            &["x".to_owned(), "y".to_owned(), "z".to_owned()],
        )
        .unwrap();
        assert_eq!(same.categories, ["x", "y", "z"]);
        let numbered = from_series(None, &list, &["x".to_owned()]).unwrap();
        assert_eq!(numbered.categories, ["1", "2", "3"]);
    }
}
