//! `kasten verify`: parses every file and
//! checks ids, links, boards, decks, git objects and the remote. It reports and
//! never fixes.

use std::collections::{HashMap, HashSet};
use std::fs;

use serde::Serialize;

use super::Kasten;
use crate::error::Result;
use crate::extract::extract;
use crate::frontmatter::{check_yaml, split};
use crate::links::{Directory, Place, Resolution};
use crate::note::{NoteMeta, meta_for};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// `unreadable`, `frontmatter`, `duplicate-id`, `unresolved-link`,
    /// `board`, `board-node`, `deck`, `deck-image`, `diagram`, `diagram-picture`, `git`, `remote`,
    /// `synced` (the vault is in a folder a sync app copies), `name` (a name another computer
    /// can't hold), `case-twin` (two names that differ only in case), and the problems of the
    /// 1.2 sidecars and files: `comments-orphan` / `highlights-orphan` (a sidecar whose page is
    /// gone), `comments` / `highlights` (one that cannot be read), `collection`,
    /// `collection-reference`, `unresolved-link` (also a `kasten:` link to no note),
    /// `bibliography` (a file or entry that cannot be read) and `bibliography-duplicate` (a
    /// key used twice).
    pub kind: String,
    pub path: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub notes: usize,
    pub boards: usize,
    pub decks: usize,
    pub diagrams: usize,
    pub git_objects: usize,
    pub problems: Vec<Problem>,
}

fn problem(kind: &str, path: Option<&str>, detail: impl Into<String>) -> Problem {
    Problem {
        kind: kind.to_owned(),
        path: path.map(str::to_owned),
        detail: detail.into(),
    }
}

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

impl Kasten {
    pub fn verify(&self) -> Result<Report> {
        let mut report = Report::default();
        let root = self.vault.root();
        if let Some(app) = crate::synced_by(root, crate::home_folder().as_deref()) {
            report
                .problems
                .push(problem("synced", None, crate::synced_warning(app)));
        }
        let mut titles = HashSet::new();
        let mut ids: HashMap<String, String> = HashMap::new();
        let mut metas: Vec<NoteMeta> = Vec::new();
        let mut links: Vec<(usize, String)> = Vec::new();
        for file in self.vault.files(".md")? {
            report.notes += 1;
            let Ok(text) = fs::read_to_string(root.join(&file.path)) else {
                report.problems.push(problem(
                    "unreadable",
                    Some(&file.path),
                    "Not readable as UTF-8 text",
                ));
                continue;
            };
            let parts = split(&text);
            if let Err(why) = check_yaml(parts.prefix) {
                report
                    .problems
                    .push(problem("frontmatter", Some(&file.path), why));
            }
            let meta = meta_for(&file.path, &text, file.modified);
            titles.insert(meta.title.trim().to_lowercase());
            let loose = meta.kind == "template" || meta.kind == crate::note::AI_ACTION;
            if let Some(id) = meta.id.clone().filter(|_| !loose) {
                if let Some(first) = ids.get(&id) {
                    report.problems.push(problem(
                        "duplicate-id",
                        Some(&file.path),
                        format!("Same id {id} as {first}"),
                    ));
                } else {
                    ids.insert(id, file.path.clone());
                }
            }
            if !loose {
                let at = metas.len();
                links.extend(
                    extract(parts.body)
                        .links
                        .into_iter()
                        .map(|l| (at, l.target)),
                );
            }
            metas.push(meta);
        }
        let directory = Directory::new(&metas);
        // A diagram shown in a page is a file, named by its path or just its
        // file name, as pages' links to files are.
        let diagram_paths: Vec<String> = self
            .vault
            .files(crate::diagrams::EXT)?
            .into_iter()
            .map(|f| f.path.to_lowercase())
            .collect();
        for (at, target) in links {
            if is_day(&target) {
                continue;
            }
            let from = &metas[at];
            let wanted = target.trim().to_lowercase();
            if wanted.ends_with(crate::diagrams::EXT) {
                let there = diagram_paths
                    .iter()
                    .any(|p| *p == wanted || p.ends_with(&format!("/{wanted}")));
                if !there {
                    report.problems.push(problem(
                        "unresolved-link",
                        Some(&from.path),
                        format!("[[{target}]] points to no file"),
                    ));
                }
                continue;
            }
            // A whiteboard or a tag's database shown in the page is a file.
            if target.ends_with(".canvas") || target.ends_with(".yaml") {
                let there = self
                    .vault
                    .file_of(target.trim(), &[".canvas", ".yaml"])
                    .is_ok_and(|p| p.is_file());
                if !there {
                    report.problems.push(problem(
                        "unresolved-link",
                        Some(&from.path),
                        format!("[[{target}]] points to no file"),
                    ));
                }
                continue;
            }
            match directory.resolve(&target, Place::of(from)) {
                Resolution::Note(_) => {}
                // A template's title still names something.
                Resolution::Missing if titles.contains(&target.trim().to_lowercase()) => {}
                Resolution::Missing => report.problems.push(problem(
                    "unresolved-link",
                    Some(&from.path),
                    format!("[[{target}]] points to no note"),
                )),
                Resolution::Ambiguous(among) => report.problems.push(problem(
                    "ambiguous-link",
                    Some(&from.path),
                    format!(
                        "[[{target}]] could be any of {}; name one by path",
                        among
                            .iter()
                            .map(|n| n.path.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                )),
            }
        }
        let every: Vec<String> = self.vault.files("")?.into_iter().map(|f| f.path).collect();
        for path in &every {
            if let Some(why) = super::verify_names::name_problem(path) {
                report.problems.push(problem("name", Some(path), why));
            }
        }
        for (path, twin) in super::verify_names::case_twins(&every) {
            report.problems.push(problem(
                "case-twin",
                Some(&path),
                format!("Differs from {twin} only in case: a Mac or Windows computer keeps just one of them"),
            ));
        }
        for board in self.vault.files(".canvas")? {
            report.boards += 1;
            let parsed = fs::read_to_string(root.join(&board.path))
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
            let Some(canvas) = parsed else {
                report
                    .problems
                    .push(problem("board", Some(&board.path), "Not valid JSON Canvas"));
                continue;
            };
            let nodes = canvas
                .get("nodes")
                .and_then(|n| n.as_array())
                .cloned()
                .unwrap_or_default();
            for node in nodes
                .iter()
                .filter(|n| n.get("type").and_then(|t| t.as_str()) == Some("file"))
            {
                let file = node.get("file").and_then(|f| f.as_str()).unwrap_or("");
                if file.is_empty() || !root.join(file).exists() {
                    report.problems.push(problem(
                        "board-node",
                        Some(&board.path),
                        format!("Card points to a missing note: {file}"),
                    ));
                }
            }
        }
        for deck in self.vault.files(".deck")? {
            report.decks += 1;
            let read = crate::deck::read_deck(&self.vault, &deck.path).and_then(|file| {
                crate::deck::head_of(&file.text)?;
                Ok(file)
            });
            let file = match read {
                Ok(file) => file,
                Err(err) => {
                    report
                        .problems
                        .push(problem("deck", Some(&deck.path), err.to_string()));
                    continue;
                }
            };
            for image in crate::deck::images_of(&file.text) {
                let there = self
                    .vault
                    .tracked_file(&image)
                    .is_ok_and(|path| path.is_file());
                if !there {
                    report.problems.push(problem(
                        "deck-image",
                        Some(&deck.path),
                        format!("Image is missing: {image}"),
                    ));
                }
            }
        }
        for diagram in self.vault.files(crate::diagrams::EXT)? {
            report.diagrams += 1;
            let read = crate::diagrams::read_diagram(&self.vault, &diagram.path)
                .and_then(|file| crate::diagrams::check_xml(&file.xml));
            if let Err(err) = read {
                report
                    .problems
                    .push(problem("diagram", Some(&diagram.path), err.to_string()));
            }
            // The picture is only ever shown, so it must be a picture; one
            // that is out of date is not a problem, it is drawn again.
            if let Ok(Some(svg)) = crate::diagrams::read_preview(&self.vault, &diagram.path)
                && let Err(err) = crate::diagrams::check_svg(&svg)
            {
                let picture = crate::diagrams::sidecar_of(&diagram.path);
                report
                    .problems
                    .push(problem("diagram-picture", Some(&picture), err.to_string()));
            }
        }
        if let Some(history) = self.history.get() {
            let (count, broken) = history.check_objects()?;
            report.git_objects = count;
            report
                .problems
                .extend(broken.into_iter().map(|why| problem("git", None, why)));
            // Only the remote confirmed on this computer: one the vault's
            // config alone names could be any server.
            let token = self.git_token();
            if let Some(url) = self.confirmed_remote()
                && let Err(err) = history.reach_as(&url, token.as_ref())
            {
                // A remote the check refuses may hold a password: not shown.
                let err = crate::history::redact(&err.to_string(), token.as_ref());
                let detail = match crate::history::check_remote(&url) {
                    Ok(()) => format!("{url}: {err}"),
                    Err(_) => err,
                };
                report.problems.push(problem("remote", None, detail));
            }
        }
        // What the 1.2 features keep beside the notes: comment and highlight sidecars, saved
        // collections, `kasten:` links and the bibliography.
        for found in [
            self.comment_problems(),
            self.collection_problems(),
            self.kasten_link_problems(),
            self.bibliography_problems(),
        ] {
            report.problems.extend(found?);
        }
        // The numbers are kept for the health report; the problems are not.
        self.remember_check(&report);
        Ok(report)
    }
}
