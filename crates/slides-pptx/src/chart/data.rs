//! The numbers of a chart as a table: a row of category names, and a column of numbers for each series.

use slides_core::{ChartEl, is_color};

/// The most categories and series a chart holds (the editor draws no more).
pub const MOST_CATEGORIES: usize = 40;
pub const MOST_SERIES: usize = 12;

/// The colours series take in turn when they name none.
const PALETTE: [&str; 6] = [
    "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
];

pub struct Series {
    pub name: String,
    pub color: String,
    pub values: Vec<f64>,
}

pub struct Table {
    pub categories: Vec<String>,
    pub series: Vec<Series>,
}

impl Table {
    /// The table a chart draws. None when it has nothing to draw.
    pub fn of(chart: &ChartEl) -> Option<Table> {
        let widest = chart
            .series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0);
        let count = chart.categories.len().max(widest).min(MOST_CATEGORIES);
        if count == 0 || chart.series.is_empty() {
            return None;
        }
        let categories = (0..count)
            .map(|i| {
                chart
                    .categories
                    .get(i)
                    .map_or_else(|| (i + 1).to_string(), |c| c.chars().take(120).collect())
            })
            .collect();
        let series = chart
            .series
            .iter()
            .take(MOST_SERIES)
            .enumerate()
            .map(|(i, s)| Series {
                name: s.name.chars().take(120).collect(),
                color: s
                    .color
                    .as_deref()
                    .filter(|c| is_color(c))
                    .map_or_else(|| PALETTE[i % PALETTE.len()].to_owned(), str::to_owned),
                values: (0..count)
                    .map(|c| {
                        let v = s.values.get(c).copied().unwrap_or(0.0);
                        if v.is_finite() { v } else { 0.0 }
                    })
                    .collect(),
            })
            .collect();
        Some(Table { categories, series })
    }

    /// The colour of slice `n` of a pie.
    pub fn slice_color(n: usize) -> &'static str {
        PALETTE[n % PALETTE.len()]
    }
}

/// `text` with the characters XML cannot hold in text or an attribute written as entities.
pub fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if c.is_control() && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

/// The spreadsheet name of a column, from 0: A, B ... Z, AA ...
pub fn column(mut n: usize) -> String {
    let mut out = String::new();
    loop {
        out.insert(0, char::from(b'A' + (n % 26) as u8));
        if n < 26 {
            return out;
        }
        n = n / 26 - 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns_count_like_a_spreadsheet() {
        assert_eq!(column(0), "A");
        assert_eq!(column(25), "Z");
        assert_eq!(column(26), "AA");
        assert_eq!(column(27), "AB");
    }

    #[test]
    fn text_is_made_safe_for_xml() {
        assert_eq!(esc("a<b & \"c\"\u{1}"), "a&lt;b &amp; &quot;c&quot;");
    }
}
