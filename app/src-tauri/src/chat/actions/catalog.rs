//! The actions on offer: the ones shipped with the app (compiled in), then
//! the vault's own in `templates/ai/`. A vault file named like a built-in
//! (its file name, in lower case, with dashes: `Compare sources.md` is
//! `compare-sources`) replaces it, in its place; any other is added after
//! them, by title. A file that does not read is left out and reported, and
//! a built-in it would have replaced stays.

use kasten_core::{Kasten, NoteFile, slugify};
use serde::Serialize;

use super::parse::{Action, parse};

/// The shipped actions, in the order they are offered.
const BUILT_IN: [(&str, &str); 9] = [
    ("explain", include_str!("builtin/explain.md")),
    (
        "compare-sources",
        include_str!("builtin/compare-sources.md"),
    ),
    ("outline", include_str!("builtin/outline.md")),
    (
        "extract-action-items",
        include_str!("builtin/extract-action-items.md"),
    ),
    (
        "draft-project-update",
        include_str!("builtin/draft-project-update.md"),
    ),
    ("draw-diagram", include_str!("builtin/draw-diagram.md")),
    (
        "explain-diagram",
        include_str!("builtin/explain-diagram.md"),
    ),
    ("tidy-diagram", include_str!("builtin/tidy-diagram.md")),
    ("check-diagram", include_str!("builtin/check-diagram.md")),
];

/// A vault file that could not be used, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub slug: String,
    pub path: String,
    pub message: String,
}

/// What `ai_actions` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub actions: Vec<Action>,
    pub problems: Vec<Problem>,
}

impl Catalog {
    pub fn find(&self, slug: &str) -> Option<&Action> {
        self.actions.iter().find(|action| action.slug == slug)
    }
}

/// The shipped actions.
pub fn built_in() -> Vec<Action> {
    BUILT_IN
        .iter()
        .filter_map(|(slug, text)| {
            // A shipped file that does not read is a bug the tests catch.
            parse(slug, text).ok().map(|action| Action {
                built_in: true,
                ..action
            })
        })
        .collect()
}

/// The file's name without its folder or `.md`, as a slug.
fn slug_of(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    slugify(name.strip_suffix(".md").unwrap_or(name))
}

/// The shipped actions with the vault's `files` laid over them.
pub fn merge(files: &[NoteFile]) -> Catalog {
    let mut actions = built_in();
    let mut added: Vec<Action> = Vec::new();
    let mut problems = Vec::new();
    // The slug of each file looked at, with the file it came from.
    let mut seen: Vec<(String, &str)> = Vec::new();
    for file in files {
        let path = &file.meta.path;
        let slug = slug_of(path);
        if let Some((_, first)) = seen.iter().find(|(s, _)| *s == slug) {
            problems.push(Problem {
                slug: slug.clone(),
                path: path.clone(),
                message: format!("{first} has the same name, so this file is left out"),
            });
            continue;
        }
        seen.push((slug.clone(), path));
        match parse(&slug, &file.text) {
            Ok(action) => {
                let action = Action {
                    path: Some(path.clone()),
                    ..action
                };
                match actions.iter().position(|a| a.slug == slug) {
                    Some(at) => actions[at] = action,
                    None => added.push(action),
                }
            }
            Err(message) => problems.push(Problem {
                slug,
                path: path.clone(),
                message,
            }),
        }
    }
    added.sort_by_key(|action| action.title.to_lowercase());
    actions.extend(added);
    Catalog { actions, problems }
}

/// The actions on offer in the vault.
pub fn load(kasten: &Kasten) -> Result<Catalog, String> {
    let files = kasten.ai_actions().map_err(|e| e.to_string())?;
    Ok(merge(&files))
}
