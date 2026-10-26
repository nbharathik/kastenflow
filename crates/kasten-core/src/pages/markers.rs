//! The HTML lines that make toggles and columns: `<details>` with its
//! `<summary>`, and the comments `<!-- columns 40/60 -->`, `<!-- column -->`,
//! `<!-- /columns -->`. Matched on a whole HTML block, as the editor does,
//! so a marker with anything else on its line is just HTML.

fn strip_prefix_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    text.get(..prefix.len())
        .filter(|head| head.eq_ignore_ascii_case(prefix))
        .map(|_| &text[prefix.len()..])
}

fn strip_suffix_ci<'a>(text: &'a str, suffix: &str) -> Option<&'a str> {
    let cut = text.len().checked_sub(suffix.len())?;
    text.get(cut..)
        .filter(|tail| tail.eq_ignore_ascii_case(suffix))
        .map(|_| &text[..cut])
}

/// What a toggle's opening line says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ToggleOpener {
    pub open: bool,
    /// The summary, when this line holds it.
    pub summary: Option<String>,
}

/// `<details>`, `<details open>`, with the `<summary>` after it or not.
pub(crate) fn toggle_open(value: &str) -> Option<ToggleOpener> {
    let mut rest = strip_prefix_ci(value, "<details")?;
    let mut open = false;
    let spaced = rest.trim_start();
    if spaced.len() < rest.len()
        && let Some(after) = strip_prefix_ci(spaced, "open")
        && after.trim_start().starts_with('>')
    {
        open = true;
        rest = after;
    }
    let rest = rest.trim_start().strip_prefix('>')?.trim_start();
    if rest.is_empty() {
        return Some(ToggleOpener {
            open,
            summary: None,
        });
    }
    summary_of(rest).map(|summary| ToggleOpener {
        open,
        summary: Some(summary),
    })
}

/// The text of a line that is only `<summary>…</summary>`.
pub(crate) fn summary_of(value: &str) -> Option<String> {
    let inner = strip_prefix_ci(value, "<summary>")?;
    strip_suffix_ci(inner, "</summary>").map(str::to_owned)
}

pub(crate) fn toggle_close(value: &str) -> bool {
    value.eq_ignore_ascii_case("</details>")
}

fn comment_inner(value: &str) -> Option<&str> {
    value.strip_prefix("<!--")?.strip_suffix("-->")
}

/// A columns opener: the numbers after `columns` (`40/60`), or "" for none.
pub(crate) fn columns_open(value: &str) -> Option<String> {
    let rest = strip_prefix_ci(comment_inner(value)?.trim_start(), "columns")?;
    let ratio = rest.trim();
    if ratio.is_empty() {
        return Some(String::new());
    }
    let numbers = ratio
        .split('/')
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    (numbers && rest.starts_with(char::is_whitespace)).then(|| ratio.to_owned())
}

/// `<!-- column -->`.
pub(crate) fn column_separator(value: &str) -> bool {
    comment_inner(value)
        .map(str::trim)
        .is_some_and(|inner| inner.eq_ignore_ascii_case("column"))
}

/// `<!-- /columns -->`.
pub(crate) fn columns_close(value: &str) -> bool {
    comment_inner(value)
        .map(str::trim)
        .is_some_and(|inner| inner.eq_ignore_ascii_case("/columns"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_lines() {
        let plain = toggle_open("<details>").unwrap();
        assert!(!plain.open && plain.summary.is_none());
        let both = toggle_open("<DETAILS open >\n<summary>Why</summary>").unwrap();
        assert!(both.open);
        assert_eq!(both.summary.as_deref(), Some("Why"));
        assert!(toggle_open("<details foo>").is_none());
        assert!(toggle_open("<detailsx>").is_none());
        assert!(toggle_open("<details>\nstray text").is_none());
        assert_eq!(summary_of("<summary>S</summary>").as_deref(), Some("S"));
        assert!(toggle_close("</Details>"));
        assert!(!toggle_close("</details> x"));
    }

    #[test]
    fn column_markers() {
        assert_eq!(columns_open("<!-- columns -->").as_deref(), Some(""));
        assert_eq!(
            columns_open("<!--columns 30/70-->").as_deref(),
            Some("30/70")
        );
        assert_eq!(
            columns_open("<!--   COLUMNS   1/2/1   -->").as_deref(),
            Some("1/2/1")
        );
        assert!(columns_open("<!-- columns40 -->").is_none());
        assert!(columns_open("<!-- columns 40 / 60 -->").is_none());
        assert!(columns_open("<!-- columns 0.4 -->").is_none());
        assert!(columns_open("<!-- column -->").is_none());
        assert!(column_separator("<!--   column   -->"));
        assert!(!column_separator("<!-- columns -->"));
        assert!(columns_close("<!-- /columns -->"));
        assert!(!columns_close("<!-- /column -->"));
    }
}
