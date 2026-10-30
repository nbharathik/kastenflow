//! A short map of a whole LaTeX document for an assistant: which files the
//! root pulls in, which labels and citation keys exist, and which `\ref` or
//! `\cite` points at nothing. It lets the assistant work on a paper of many
//! files without reading each one. The scan is a plain, tolerant reading of
//! the text (comments skipped); it does not run TeX, so a label made by a
//! macro is not seen.

use std::collections::{BTreeMap, BTreeSet};

/// What the files of a document hold, by name.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DocumentMap {
    /// File, and the files it `\input`s or `\include`s, in order.
    pub includes: Vec<(String, Vec<String>)>,
    /// Label, and the file that defines it.
    pub labels: BTreeMap<String, String>,
    /// Keys defined by a `.bib` file or a `\bibitem`.
    pub bib_keys: BTreeSet<String>,
    /// Keys cited, with the first file that cites each.
    pub cited: BTreeMap<String, String>,
    /// Labels referred to, with the first file that refers to each.
    pub referred: BTreeMap<String, String>,
    /// There is a bibliography to check citations against.
    pub has_bibliography: bool,
}

impl DocumentMap {
    /// Cited keys that no bibliography defines (empty without a bibliography).
    pub fn missing_citations(&self) -> Vec<(&str, &str)> {
        if !self.has_bibliography {
            return Vec::new();
        }
        self.cited
            .iter()
            .filter(|(key, _)| !self.bib_keys.contains(*key))
            .map(|(k, f)| (k.as_str(), f.as_str()))
            .collect()
    }

    /// Labels referred to that nothing defines.
    pub fn missing_labels(&self) -> Vec<(&str, &str)> {
        self.referred
            .iter()
            .filter(|(label, _)| !self.labels.contains_key(*label))
            .map(|(k, f)| (k.as_str(), f.as_str()))
            .collect()
    }
}

/// The text of a line without its comment (a `%` not written `\%`).
fn uncommented(line: &str) -> &str {
    let mut escaped = false;
    for (i, c) in line.char_indices() {
        if escaped {
            escaped = false; // the character after a backslash is plain text
            continue;
        }
        match c {
            '\\' => escaped = true,
            '%' => return &line[..i],
            _ => {}
        }
    }
    line
}

/// Each `\name[..]*{arg}` in `line` as (name, braced argument).
fn commands(line: &str) -> Vec<(&str, &str)> {
    let mut found = Vec::new();
    let mut rest = line;
    while let Some(at) = rest.find('\\') {
        rest = &rest[at + 1..];
        let end = rest
            .find(|c: char| !c.is_ascii_alphabetic())
            .unwrap_or(rest.len());
        let name = &rest[..end];
        if name.is_empty() {
            // `\%`, `\\`, `\{`: not a command; go on after the character.
            let skip = rest.chars().next().map_or(0, char::len_utf8);
            rest = &rest[skip..];
            continue;
        }
        let mut after = rest[end..].trim_start_matches('*');
        // Up to two optional arguments: \citep[see][p. 3]{key}.
        for _ in 0..2 {
            let trimmed = after.trim_start();
            match trimmed.strip_prefix('[').and_then(|r| r.split_once(']')) {
                Some((_, tail)) => after = tail,
                None => break,
            }
        }
        if let Some(arg) = after
            .trim_start()
            .strip_prefix('{')
            .and_then(|r| r.split_once('}'))
        {
            found.push((name, arg.0));
        }
        rest = &rest[end..];
    }
    found
}

fn is_cite(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("cite") || lower.ends_with("cite") || lower.ends_with("cites")
}

fn is_ref(name: &str) -> bool {
    matches!(
        name,
        "ref" | "eqref" | "autoref" | "cref" | "Cref" | "vref" | "pageref" | "nameref" | "subref"
    )
}

fn tex_name(name: &str) -> String {
    let name = name.trim().trim_start_matches("./");
    if name
        .rsplit('/')
        .next()
        .is_some_and(|last| last.contains('.'))
    {
        name.to_owned()
    } else {
        format!("{name}.tex")
    }
}

fn bib_keys(text: &str, into: &mut BTreeSet<String>) {
    for line in text.lines() {
        let line = line.trim_start();
        let Some(rest) = line.strip_prefix('@') else {
            continue;
        };
        let Some((kind, tail)) = rest.split_once(['{', '(']) else {
            continue;
        };
        let kind = kind.trim().to_ascii_lowercase();
        if matches!(kind.as_str(), "comment" | "string" | "preamble") {
            continue;
        }
        if let Some((key, _)) = tail.split_once(',') {
            let key = key.trim();
            if !key.is_empty() && !key.contains(char::is_whitespace) {
                into.insert(key.to_owned());
            }
        }
    }
}

/// The map of the document whose files are `files` (name relative to the
/// document's folder, and text); `main` is the root file.
pub fn document_map(files: &[(String, String)], main: &str) -> DocumentMap {
    let mut map = DocumentMap::default();
    let mut ordered: Vec<&(String, String)> = files.iter().collect();
    ordered.sort_by_key(|(name, _)| (name != main, name.clone()));
    for (name, text) in ordered {
        if name.ends_with(".bib") {
            map.has_bibliography = true;
            bib_keys(text, &mut map.bib_keys);
            continue;
        }
        if !name.ends_with(".tex") {
            continue;
        }
        let mut included = Vec::new();
        for line in text.lines().map(uncommented) {
            for (command, arg) in commands(line) {
                match command {
                    "input" | "include" | "subfile" | "InputIfFileExists" => {
                        included.push(tex_name(arg));
                    }
                    "label" => {
                        map.labels
                            .entry(arg.trim().to_owned())
                            .or_insert_with(|| name.clone());
                    }
                    "bibitem" => {
                        map.has_bibliography = true;
                        map.bib_keys.insert(arg.trim().to_owned());
                    }
                    "bibliography" | "addbibresource" => map.has_bibliography = true,
                    c if is_ref(c) => {
                        for label in arg.split(',').map(str::trim).filter(|l| !l.is_empty()) {
                            map.referred
                                .entry(label.to_owned())
                                .or_insert_with(|| name.clone());
                        }
                    }
                    c if is_cite(c) => {
                        for key in arg
                            .split(',')
                            .map(str::trim)
                            .filter(|k| !k.is_empty() && *k != "*")
                        {
                            map.cited
                                .entry(key.to_owned())
                                .or_insert_with(|| name.clone());
                        }
                    }
                    _ => {}
                }
            }
        }
        if !included.is_empty() {
            map.includes.push((name.clone(), included));
        }
    }
    map
}

fn list<I: Iterator<Item = String>>(items: I, most: usize) -> String {
    let all: Vec<String> = items.collect();
    let shown = all
        .iter()
        .take(most)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if all.len() > most {
        format!("{shown}, … and {} more", all.len() - most)
    } else {
        shown
    }
}

/// The map as a few plain lines, at most about `budget` characters.
pub fn render(map: &DocumentMap, budget: usize) -> String {
    let mut lines = vec!["Document map (a plain scan of the files, not TeX's own):".to_owned()];
    for (file, included) in &map.includes {
        lines.push(format!(
            "- {file} pulls in {}",
            list(included.iter().cloned(), 12)
        ));
    }
    if !map.labels.is_empty() {
        lines.push(format!(
            "- Labels ({}): {}",
            map.labels.len(),
            list(map.labels.iter().map(|(l, f)| format!("{l} [{f}]")), 40)
        ));
    }
    if map.has_bibliography {
        lines.push(format!(
            "- Bibliography keys ({}): {}",
            map.bib_keys.len(),
            list(map.bib_keys.iter().cloned(), 40)
        ));
    }
    let missing_cites = map.missing_citations();
    if !missing_cites.is_empty() {
        lines.push(format!(
            "- Cited but defined nowhere: {}",
            list(missing_cites.iter().map(|(k, f)| format!("{k} [{f}]")), 20)
        ));
    }
    let missing_refs = map.missing_labels();
    if !missing_refs.is_empty() {
        lines.push(format!(
            "- Referred to but no \\label: {}",
            list(missing_refs.iter().map(|(k, f)| format!("{k} [{f}]")), 20)
        ));
    }
    let mut text = lines.join("\n");
    if let Some((end, _)) = text.char_indices().nth(budget) {
        text.truncate(end);
        text.push('…');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files() -> Vec<(String, String)> {
        let f = |n: &str, t: &str| (n.to_owned(), t.to_owned());
        vec![
            f(
                "main.tex",
                "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n% \\input{old}\n\\include{sections/method.tex}\n\\bibliography{refs}\n\\end{document}\n",
            ),
            f(
                "sections/intro.tex",
                "Intro \\label{sec:intro} see \\ref{sec:method} and \\cite{smith2020, nobody}. 50\\% \\label{sec:late}\n",
            ),
            f(
                "sections/method.tex",
                "\\section{M}\\label{sec:method} \\citep[see][p.~3]{smith2020} \\eqref{eq:gone}, \\cref{sec:intro,fig:gone}\n",
            ),
            f(
                "refs.bib",
                "@article{smith2020,\n  title={X}\n}\n@comment{hidden,}\n@book{lee2019,\n}\n",
            ),
        ]
    }

    #[test]
    fn the_includes_are_followed_in_order_and_comments_are_skipped() {
        let map = document_map(&files(), "main.tex");
        assert_eq!(
            map.includes,
            [(
                "main.tex".to_owned(),
                vec![
                    "sections/intro.tex".to_owned(),
                    "sections/method.tex".to_owned()
                ]
            )]
        );
    }

    #[test]
    fn labels_keys_and_pairs_are_found_across_files() {
        let map = document_map(&files(), "main.tex");
        assert_eq!(
            map.labels.get("sec:intro").map(String::as_str),
            Some("sections/intro.tex")
        );
        assert_eq!(map.labels.len(), 3, "{:?}", map.labels);
        assert!(map.has_bibliography);
        assert_eq!(
            map.bib_keys.iter().map(String::as_str).collect::<Vec<_>>(),
            ["lee2019", "smith2020"]
        );
        assert_eq!(map.missing_citations(), [("nobody", "sections/intro.tex")]);
        assert_eq!(
            map.missing_labels(),
            [
                ("eq:gone", "sections/method.tex"),
                ("fig:gone", "sections/method.tex")
            ]
        );
    }

    #[test]
    fn without_a_bibliography_nothing_is_called_missing() {
        let one = vec![(
            "main.tex".to_owned(),
            "\\cite{a} \\ref{x}\\label{x}".to_owned(),
        )];
        let map = document_map(&one, "main.tex");
        assert!(map.missing_citations().is_empty());
        assert!(map.missing_labels().is_empty());
    }

    #[test]
    fn a_bibitem_is_a_key_and_an_escaped_percent_is_not_a_comment() {
        let one = vec![(
            "main.tex".to_owned(),
            "100\\% \\cite{k} \\bibitem{k} Someone. % \\cite{hidden}\n".to_owned(),
        )];
        let map = document_map(&one, "main.tex");
        assert!(map.bib_keys.contains("k") && map.cited.contains_key("k"));
        assert!(!map.cited.contains_key("hidden"));
    }

    #[test]
    fn it_reads_as_a_few_plain_lines_within_its_budget() {
        let text = render(&document_map(&files(), "main.tex"), 3_000);
        assert!(
            text.contains("main.tex pulls in sections/intro.tex, sections/method.tex"),
            "{text}"
        );
        assert!(
            text.contains("Cited but defined nowhere: nobody [sections/intro.tex]"),
            "{text}"
        );
        assert!(
            text.contains("Referred to but no \\label: eq:gone"),
            "{text}"
        );
        assert!(
            render(&document_map(&files(), "main.tex"), 60)
                .chars()
                .count()
                <= 61
        );
        assert!(render(&DocumentMap::default(), 500).starts_with("Document map"));
    }
}
