//! Names another computer could not hold, for `verify`: a vault restored on
//! Windows cannot write `aux.md`, `plan?.md` or a name ending in a dot, and
//! a Mac or Windows computer keeps only one of `Plan.md` and `plan.md`.
//! Very long paths trip Windows apps that still stop at 260 characters.

use std::collections::HashMap;

/// Paths longer than this, from the vault's folder, are reported: with the
/// vault's own folder in front they near Windows' old limit.
const LONG_PATH: usize = 200;

/// What is wrong with `rel` on some computer, if anything.
pub(super) fn name_problem(rel: &str) -> Option<String> {
    for part in rel.split('/') {
        if crate::slug::windows_device(part) {
            return Some(format!(
                "“{part}” names a device on Windows, which can't hold the file"
            ));
        }
        if part.ends_with(['.', ' ']) {
            return Some(format!(
                "“{part}” ends in a dot or space, which Windows drops"
            ));
        }
        if let Some(c) = part
            .chars()
            .find(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\') || c.is_control())
        {
            return Some(format!(
                "“{part}” holds {c:?}, which Windows can't hold in a name"
            ));
        }
    }
    let chars = rel.chars().count();
    (chars > LONG_PATH).then(|| {
        format!("{chars} characters long: with the vault's folder in front, some Windows apps can't open it")
    })
}

/// Pairs of paths that differ only in case, each later path with the first
/// of its kind.
pub(super) fn case_twins(paths: &[String]) -> Vec<(String, String)> {
    let mut first: HashMap<String, &String> = HashMap::new();
    let mut twins = Vec::new();
    for path in paths {
        match first.get(&path.to_lowercase()) {
            Some(earlier) => twins.push((path.clone(), (*earlier).clone())),
            None => {
                first.insert(path.to_lowercase(), path);
            }
        }
    }
    twins
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_windows_cannot_hold() {
        assert!(name_problem("inbox/aux.md").unwrap().contains("device"));
        assert!(
            name_problem("projects/com1/plan.md")
                .unwrap()
                .contains("device")
        );
        assert!(name_problem("inbox/plan?.md").unwrap().contains("'?'"));
        assert!(name_problem("inbox/a:b.md").is_some());
        assert!(
            name_problem("inbox/notes./plan.md")
                .unwrap()
                .contains("dot")
        );
        assert!(
            name_problem(&format!("library/{}.md", "a".repeat(220)))
                .unwrap()
                .contains("characters")
        );
        assert_eq!(name_problem("library/zettelkasten-method.md"), None);
        assert_eq!(name_problem("inbox/auxiliary.md"), None);
        assert_eq!(name_problem("journal/2026/2026-09-28.md"), None);
        assert_eq!(
            name_problem("projects/photo-organiser/journal/2026/2026-09-28.md"),
            None
        );
    }

    #[test]
    fn names_that_differ_only_in_case() {
        let paths = [
            "inbox/Plan.md",
            "inbox/plan.md",
            "inbox/other.md",
            "Inbox/plan.md",
        ]
        .map(String::from);
        assert_eq!(
            case_twins(&paths),
            [
                ("inbox/plan.md".to_owned(), "inbox/Plan.md".to_owned()),
                ("Inbox/plan.md".to_owned(), "inbox/Plan.md".to_owned()),
            ]
        );
    }
}
