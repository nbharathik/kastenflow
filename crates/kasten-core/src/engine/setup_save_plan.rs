//! Working out the setup to save from a project, with every check, writing
//! nothing: the name and file name, the project, each page named (a page of
//! this project that can be read and is small enough), the skeleton of each,
//! the schemas of the project's tags and the manifest that lists them. The
//! save and the dialog's checklist are in setup_save.rs.

use std::collections::{BTreeSet, HashMap};
use std::fs;

use serde_json::{Map, Value};

use super::Kasten;
use super::setup_save_manifest::{icon_of, manifest_text, summary_of};
use super::setup_saved::{
    MAX_FILE_BYTES, MAX_NAME_CHARS, MAX_PAGES, MAX_TOTAL_BYTES, PROJECT_PAGE, folder_path, page_ok,
    plain, tag_ok, yaml_path,
};
use super::setup_skeleton::skeleton;
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::note::NoteMeta;
use crate::props::props_of;
use crate::slug::slugify;
use crate::vault::{Vault, in_templates};

/// The properties of a project page that say how far along it is: a new
/// project starts without them.
const STATE_KEYS: [&str; 5] = [
    "status",
    "health",
    "next_action",
    "last_review",
    "review_after",
];
/// A setup worked out, nothing written yet.
pub(super) struct SavePlan {
    pub slug: String,
    pub title: String,
    /// The page's `projects/…` paths that are kept.
    pub pages: Vec<String>,
    /// Each file by its vault path with its text.
    pub files: Vec<(String, String)>,
}

/// A setup's name: one line of text.
pub(super) fn check_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > MAX_NAME_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(Error::Invalid(format!(
            "A setup's name is some text on one line, up to {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name.to_owned())
}

/// The file name a setup is saved under: the one asked for, which must be a
/// plain name, or one made of the title.
fn base_slug(slug: &str, title: &str) -> Result<String> {
    if slug.is_empty() {
        return Ok(slugify(title));
    }
    if !plain(slug) {
        return Err(Error::Invalid(
            "A setup's file name is letters, digits and dashes only".to_owned(),
        ));
    }
    Ok(slug.to_owned())
}

/// `base` followed by `-n`, kept short enough to read back as itself.
fn numbered(base: &str, n: u32) -> String {
    let suffix = format!("-{n}");
    let mut stem = base.to_owned();
    loop {
        let candidate = format!("{stem}{suffix}");
        if plain(&candidate) || stem.is_empty() {
            return candidate;
        }
        stem.pop();
        while stem.ends_with('-') {
            stem.pop();
        }
    }
}

fn taken(vault: &Vault, slug: &str) -> bool {
    let at = |rel: String| {
        vault
            .file_of(&rel, &[""])
            .is_ok_and(|file| fs::symlink_metadata(file).is_ok())
    };
    at(yaml_path(slug)) || at(folder_path(slug))
}

fn free_slug(vault: &Vault, base: &str) -> String {
    let mut slug = base.to_owned();
    let mut n = 2;
    while taken(vault, &slug) {
        slug = numbered(base, n);
        n += 1;
    }
    slug
}

/// The project named by a folder, a title-less spelling of its folder or the
/// path of its page: its folder as it is on disk, and its page.
pub(super) fn project_in<'a>(notes: &'a [NoteMeta], input: &str) -> Result<(String, &'a NoteMeta)> {
    let given = input.trim();
    let folder = given
        .strip_prefix("projects/")
        .and_then(|rest| rest.strip_suffix(&format!("/{PROJECT_PAGE}")))
        .unwrap_or(given);
    let wanted = format!("projects/{folder}/{PROJECT_PAGE}");
    if folder.is_empty()
        || folder.contains(['/', '\\', ':', '\0'])
        || folder == "."
        || folder == ".."
    {
        return Err(Error::Invalid(format!(
            "There is no project called “{given}”"
        )));
    }
    notes
        .iter()
        .find(|n| n.kind == "project" && n.path.eq_ignore_ascii_case(&wanted))
        .map(|page| {
            let real = page
                .path
                .split('/')
                .nth(1)
                .map_or_else(|| folder.to_owned(), str::to_owned);
            (real, page)
        })
        .ok_or_else(|| Error::Invalid(format!("There is no project called “{given}”")))
}

/// The pages of the project that a setup can keep, by path.
pub(super) fn pages_of<'a>(notes: &'a [NoteMeta], folder: &str) -> Vec<&'a NoteMeta> {
    let prefix = format!("projects/{folder}/");
    let mut pages: Vec<&NoteMeta> = notes
        .iter()
        .filter(|n| {
            n.kind == "page"
                && n.path.starts_with(&prefix)
                && n.path.ends_with(".md")
                && !in_templates(&n.path)
        })
        .collect();
    pages.sort_by(|a, b| a.path.cmp(&b.path));
    pages
}

/// Whether `path` is directly under the project's `pages/` folder.
pub(super) fn direct(path: &str, folder: &str) -> bool {
    path.strip_prefix(&format!("projects/{folder}/pages/"))
        .is_some_and(|rest| !rest.contains('/'))
}

/// The project page's properties a new project starts with.
pub(super) fn kept_props(page_text: &str) -> Map<String, Value> {
    props_of(split(page_text).prefix)
        .into_iter()
        .filter(|(key, value)| {
            !value.is_null()
                && !STATE_KEYS
                    .iter()
                    .any(|s| s.eq_ignore_ascii_case(key.trim()))
        })
        .collect()
}

impl Kasten {
    /// The file stems of the tag schemas the project's notes use.
    pub(super) fn schema_stems(&self, notes: &[NoteMeta], folder: &str) -> Result<Vec<String>> {
        let schemas = self.tag_schemas()?;
        let mut stems = BTreeSet::new();
        for note in notes
            .iter()
            .filter(|n| n.project.as_deref() == Some(folder) && n.kind != "template")
        {
            for tag in &note.tags {
                let tag = tag.trim().trim_start_matches('#');
                let stem = schemas
                    .iter()
                    .find(|s| s.name.eq_ignore_ascii_case(tag))
                    .and_then(|s| s.path.strip_prefix("tags/")?.strip_suffix(".yaml"));
                if let Some(stem) = stem.filter(|s| tag_ok(s)) {
                    stems.insert(stem.to_owned());
                }
            }
        }
        Ok(stems.into_iter().collect())
    }

    /// Works out the setup to save, writing nothing, with every check: the
    /// name and file name, the project, each page named (it is a page of this
    /// project, it can be read and is small enough) and, for an agent, that
    /// the project page and each page are not locked. `pages` None keeps the
    /// pages directly under the project's `pages/`.
    pub(super) fn plan_save(
        &self,
        project: &str,
        slug: &str,
        title: &str,
        pages: Option<&[String]>,
        agent: bool,
    ) -> Result<SavePlan> {
        let title = check_name(title)?;
        let base = base_slug(slug, &title)?;
        let notes = self.index().notes()?;
        let (folder, project_page) = project_in(&notes, project)?;
        let project_note = self.vault.read(&project_page.path)?;
        if agent {
            self.writable(&project_page.path)?;
        }
        let mut wanted: Vec<String> = match pages {
            Some(list) => list.to_vec(),
            None => pages_of(&notes, &folder)
                .into_iter()
                .filter(|n| direct(&n.path, &folder))
                .map(|n| n.path.clone())
                .collect(),
        };
        wanted.sort();
        wanted.dedup();
        if wanted.len() > MAX_PAGES {
            return Err(Error::Invalid(format!(
                "A setup keeps at most {MAX_PAGES} pages"
            )));
        }
        let prefix = format!("projects/{folder}/");
        let mut sources = Vec::with_capacity(wanted.len());
        for path in &wanted {
            if !path.starts_with(&prefix) || path.contains("..") {
                return Err(Error::Invalid(format!(
                    "“{path}” is not a page of this project"
                )));
            }
            let note = self.vault.read(path).map_err(|err| match err {
                Error::NotFound(_) => Error::Invalid(format!("“{path}” is no longer there")),
                other => other,
            })?;
            if note.meta.kind != "page" {
                return Err(Error::Invalid(format!(
                    "“{}” is a {}, and only pages are kept in a setup",
                    note.meta.title, note.meta.kind
                )));
            }
            if agent {
                self.writable(path)?;
            }
            if note.text.len() > MAX_FILE_BYTES {
                return Err(Error::Invalid(format!(
                    "“{}” is too large to keep in a setup (at most {} KB)",
                    note.meta.title,
                    MAX_FILE_BYTES / 1024
                )));
            }
            sources.push(note);
        }
        // Names inside the setup: `pN` for the ids, a file name for each page.
        let slug = free_slug(&self.vault, &base);
        let by_id: HashMap<&str, String> = sources
            .iter()
            .enumerate()
            .filter_map(|(n, s)| Some((s.meta.id.as_deref()?, format!("p{}", n + 1))))
            .collect();
        let mut names: BTreeSet<String> = BTreeSet::new();
        let mut files: Vec<(String, String)> = Vec::new();
        let mut rels: Vec<String> = Vec::new();
        for (n, note) in sources.iter().enumerate() {
            let base_name = note.meta.path.rsplit('/').next().unwrap_or_default();
            let mut name = base_name.to_owned();
            let mut k = 2;
            while names.contains(&name.to_lowercase()) {
                name = format!("{}-{k}.md", base_name.trim_end_matches(".md"));
                k += 1;
            }
            let rel = format!("pages/{name}");
            if !page_ok(&rel) {
                return Err(Error::Invalid(format!(
                    "“{}” has a file name a setup cannot keep",
                    note.meta.title
                )));
            }
            names.insert(name.to_lowercase());
            let parent = note
                .meta
                .parent
                .as_deref()
                .and_then(|id| by_id.get(id))
                .map(String::as_str);
            let text = skeleton(
                &note.text,
                &note.meta.title,
                &format!("p{}", n + 1),
                parent,
                &project_page.title,
            )?;
            files.push((format!("{}/{rel}", folder_path(&slug)), text));
            rels.push(rel);
        }
        let stems = self.schema_stems(&notes, &folder)?;
        for stem in &stems {
            let path = format!("tags/{stem}.yaml");
            let file = self.vault.file_of(&path, &[".yaml"])?;
            let meta = fs::symlink_metadata(&file)?;
            if meta.len() as usize > MAX_FILE_BYTES {
                return Err(Error::Invalid(format!(
                    "The schema of #{stem} is too large to keep in a setup"
                )));
            }
            let text = fs::read_to_string(&file)
                .map_err(|_| Error::Invalid(format!("The schema of #{stem} is not text")))?;
            files.push((format!("{}/vault/{path}", folder_path(&slug)), text));
        }
        let home = rels.first().map_or(PROJECT_PAGE, String::as_str);
        let props = kept_props(&project_note.text);
        let manifest = manifest_text(
            &title,
            &icon_of(project_page),
            &summary_of(rels.len(), stems.len()),
            home,
            &props,
            &rels,
            &stems,
        )?;
        files.push((yaml_path(&slug), manifest));
        let total: usize = files.iter().map(|(_, text)| text.len()).sum();
        if total > MAX_TOTAL_BYTES {
            return Err(Error::Invalid(
                "That is too large to keep as a setup".to_owned(),
            ));
        }
        Ok(SavePlan {
            slug,
            title,
            pages: wanted,
            files,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_numbered_name_still_reads_as_itself() {
        let long = "a".repeat(80);
        let n = numbered(&long, 2);
        assert!(plain(&n) && n.ends_with("-2"), "{n}");
        let wide = "語".repeat(40);
        assert!(plain(&numbered(&wide, 12)));
        assert_eq!(numbered("study-kit", 3), "study-kit-3");
    }

    #[test]
    fn names_are_one_line_and_not_too_long() {
        assert_eq!(check_name("  Kit  ").unwrap(), "Kit");
        for bad in ["", "  ", "a\nb", "a\tb", &"x".repeat(101)] {
            assert!(check_name(bad).is_err(), "{bad:?}");
        }
    }
}
