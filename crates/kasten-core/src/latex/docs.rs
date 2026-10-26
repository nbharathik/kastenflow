//! Finding LaTeX documents: a folder holds one when it has a root `.tex`
//! (a file with `\documentclass`, or one that another file names in a
//! `% !TEX root = …` comment), or a `kasten-latex.yaml` naming its `main`.

use std::collections::{BTreeMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use super::config::LatexConfig;

/// How much of a file is read to tell whether it is a root: the preamble
/// and the first comments are all that is looked at.
const HEAD_BYTES: u64 = 16 * 1024;

/// What a `.tex` file says about itself in its first lines.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LatexFacts {
    /// It starts a document (`\documentclass`).
    pub documentclass: bool,
    /// The root it names in a `% !TEX root = …` comment, as written.
    pub tex_root: Option<String>,
}

/// What `text` (the start of a `.tex` file) says about the file.
pub(crate) fn facts_of(text: &str) -> LatexFacts {
    let mut facts = LatexFacts::default();
    for line in text.lines() {
        let line = line.trim_start();
        if line.starts_with("\\documentclass") {
            facts.documentclass = true;
        } else if facts.tex_root.is_none()
            && let Some(comment) = line.strip_prefix('%')
        {
            let comment = comment.trim_start();
            if comment.len() > 4 && comment[..4].eq_ignore_ascii_case("!tex") {
                let rest = comment[4..].trim_start();
                if rest.len() > 4
                    && rest[..4].eq_ignore_ascii_case("root")
                    && let Some(value) = rest[4..].trim_start().strip_prefix('=')
                {
                    let value = value.trim();
                    if !value.is_empty() {
                        facts.tex_root = Some(value.to_owned());
                    }
                }
            }
        }
    }
    facts
}

/// The facts of the file at `path`; none for one that cannot be read.
pub(crate) fn read_facts(path: &Path) -> LatexFacts {
    let Ok(file) = File::open(path) else {
        return LatexFacts::default();
    };
    let mut head = Vec::new();
    if file.take(HEAD_BYTES).read_to_end(&mut head).is_err() {
        return LatexFacts::default();
    }
    facts_of(&String::from_utf8_lossy(&head))
}

/// The folder part of a vault path (empty for a file at the top).
pub(crate) fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// `rel` taken from `dir`, with `.` and `..` worked out; none when it leaves the vault.
pub(crate) fn resolve(dir: &str, rel: &str) -> Option<String> {
    if rel.starts_with('/') || rel.contains(['\\', ':', '\0']) {
        return None;
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// A LaTeX document in the vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexDoc {
    /// The folder, the unit the build, the settings and the export work on.
    pub folder: String,
    /// The root file, relative to the folder.
    pub main: String,
    /// The root file's vault path.
    pub main_path: String,
    /// The folder's name.
    pub title: String,
    /// One of `config::ENGINES`.
    pub engine: String,
    /// `vault` or `local`.
    pub bibliography: String,
    /// Read-only for agents.
    pub locked: bool,
    /// The folder has a `kasten-latex.yaml`.
    pub has_config: bool,
}

fn name_of(folder: &str) -> &str {
    folder.rsplit('/').next().unwrap_or(folder)
}

fn doc(folder: &str, main_path: &str, config: Option<&LatexConfig>) -> LatexDoc {
    let default = LatexConfig::default();
    let settings = config.unwrap_or(&default);
    LatexDoc {
        folder: folder.to_owned(),
        main: main_path
            .strip_prefix(folder)
            .map_or(main_path, |m| m.trim_start_matches('/'))
            .to_owned(),
        main_path: main_path.to_owned(),
        title: name_of(folder).to_owned(),
        engine: settings.engine_name().to_owned(),
        bibliography: settings.bibliography_name().to_owned(),
        locked: settings.locked,
        has_config: config.is_some(),
    }
}

/// The documents among the `.tex` files `texs` (path and facts), given the
/// settings files by folder. A folder with several roots has one document:
/// the settings' `main`, else `main.tex`, else the first by name. The vault's
/// top folder holds none.
pub(crate) fn find_docs(
    texs: &[(String, LatexFacts)],
    configs: &BTreeMap<String, LatexConfig>,
) -> Vec<LatexDoc> {
    let known: HashSet<&str> = texs.iter().map(|(p, _)| p.as_str()).collect();
    let mut docs: BTreeMap<String, LatexDoc> = BTreeMap::new();
    let mut claimed: HashSet<String> = HashSet::new();
    // A settings file makes a document where its `main` is a file.
    for (folder, config) in configs {
        if folder.is_empty() {
            continue;
        }
        let main = config
            .main
            .as_deref()
            .and_then(|m| resolve(folder, m))
            .filter(|m| known.contains(m.as_str()) && m.starts_with(&format!("{folder}/")));
        if let Some(main) = main {
            claimed.insert(main.clone());
            docs.insert(folder.clone(), doc(folder, &main, Some(config)));
        }
    }
    // Roots by their own `\documentclass` or by another file's comment.
    let mut roots: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (path, facts) in texs {
        if facts.documentclass {
            roots
                .entry(dir_of(path).to_owned())
                .or_default()
                .push(path.clone());
        }
        if let Some(root) = facts
            .tex_root
            .as_deref()
            .and_then(|r| resolve(dir_of(path), r))
            .filter(|r| known.contains(r.as_str()))
        {
            roots
                .entry(dir_of(&root).to_owned())
                .or_default()
                .push(root);
        }
    }
    for (folder, mut found) in roots {
        if folder.is_empty() || docs.contains_key(&folder) {
            continue;
        }
        found.retain(|p| !claimed.contains(p));
        found.sort();
        found.dedup();
        let preferred = format!("{folder}/main.tex");
        let main = if found.contains(&preferred) {
            Some(preferred)
        } else {
            found.into_iter().next()
        };
        if let Some(main) = main {
            let config = configs.get(&folder);
            docs.insert(folder.clone(), doc(&folder, &main, config));
        }
    }
    docs.into_values().collect()
}

/// The document whose folder holds `path`, the innermost if several do.
pub fn doc_containing<'a>(docs: &'a [LatexDoc], path: &str) -> Option<&'a LatexDoc> {
    docs.iter()
        .filter(|d| {
            path.strip_prefix(d.folder.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
        })
        .max_by_key(|d| d.folder.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tex(path: &str, text: &str) -> (String, LatexFacts) {
        (path.to_owned(), facts_of(text))
    }

    #[test]
    fn reads_the_class_and_the_root_comment() {
        let facts = facts_of("% !TEX root = ../main.tex\n\\section{A}\n");
        assert_eq!(facts.tex_root.as_deref(), Some("../main.tex"));
        assert!(!facts.documentclass);
        assert!(facts_of("  \\documentclass[11pt]{article}\n").documentclass);
        // A class named only in a comment starts nothing.
        assert!(!facts_of("% \\documentclass{article}\n").documentclass);
        assert_eq!(
            facts_of("%!tex root=main.tex").tex_root.as_deref(),
            Some("main.tex")
        );
        assert_eq!(facts_of("% !TEX program = xelatex\n").tex_root, None);
    }

    #[test]
    fn works_out_relative_roots() {
        assert_eq!(
            resolve("a/sections", "../main.tex").as_deref(),
            Some("a/main.tex")
        );
        assert_eq!(resolve("a", "./b/c.tex").as_deref(), Some("a/b/c.tex"));
        assert_eq!(resolve("a", "../../x.tex"), None);
        assert_eq!(resolve("a", "/x.tex"), None);
    }

    #[test]
    fn one_document_per_folder_by_class_or_comment() {
        let texs = vec![
            tex("p/one/main.tex", "\\documentclass{article}"),
            tex("p/one/sections/a.tex", "% !TEX root = ../main.tex\n"),
            tex("p/two/book.tex", "no preamble here"),
            tex("p/two/ch/c.tex", "% !TEX root = ../book.tex"),
            tex("p/three/z.tex", "\\documentclass{article}"),
            tex("p/three/a.tex", "\\documentclass{article}"),
            tex("top.tex", "\\documentclass{article}"),
            tex("p/notes.tex", "just words"),
        ];
        let docs = find_docs(&texs, &BTreeMap::new());
        let found: Vec<(&str, &str)> = docs
            .iter()
            .map(|d| (d.folder.as_str(), d.main.as_str()))
            .collect();
        assert_eq!(
            found,
            [
                ("p/one", "main.tex"),
                ("p/three", "a.tex"),
                ("p/two", "book.tex")
            ]
        );
        let two = doc_containing(&docs, "p/two/ch/c.tex").unwrap();
        assert_eq!(two.folder, "p/two");
        assert!(doc_containing(&docs, "p/notes.tex").is_none());
        assert!(doc_containing(&docs, "p/one").is_none());
    }

    #[test]
    fn a_settings_file_names_the_main_file() {
        let texs = vec![
            tex("d/src/paper.tex", "\\documentclass{article}"),
            tex("d/other.tex", "\\documentclass{article}"),
        ];
        let mut configs = BTreeMap::new();
        configs.insert(
            "d".to_owned(),
            LatexConfig::parse("main: src/paper.tex\nengine: latexmk-lua\nlocked: true\n"),
        );
        let docs = find_docs(&texs, &configs);
        // The paper in `src` belongs to the document in `d`, not a document of its own.
        assert_eq!(docs.len(), 1);
        let d = &docs[0];
        assert_eq!(
            (d.folder.as_str(), d.main.as_str(), d.main_path.as_str()),
            ("d", "src/paper.tex", "d/src/paper.tex")
        );
        assert_eq!(
            (d.engine.as_str(), d.locked, d.has_config),
            ("latexmk-lua", true, true)
        );
    }
}
