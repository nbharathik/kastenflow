//! Smart pages kept as templates of a person's own: `templates/smart/<slug>/`
//! holds the page's code folder as it was, and the page's text as `page.txt`
//! (not `.md`, so no file of a template reads as a note). The list, one
//! template read back, and keeping a page as one. Everything a template folder
//! holds is checked when it is read, since a vault can come from anywhere:
//! only files a smart page's folder may hold are used, and a name that is not
//! one plain name is refused.

use std::fs;

use serde::Serialize;

use super::smart::person_only;
use super::{Change, Kasten};
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::history::Actor;
use crate::rollback::Rollback;
use crate::slug::{slugify, windows_device};
use crate::smart::ops::check_new;
use crate::smart::{
    INDEX_FILE, MANIFEST_FILE, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, SmartFile, check_path,
};
use crate::time::Instant;
use crate::vault::Vault;

/// Where a person's smart templates live.
pub const TEMPLATE_DIR: &str = "templates/smart";
/// The page's text inside a template.
pub const BODY_FILE: &str = "page.txt";

/// A template as the new-page picker lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartTemplateInfo {
    pub slug: String,
    /// Its manifest's title, or its folder name.
    pub name: String,
}

/// A template read back: the page's text and the files of the folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmartTemplate {
    pub slug: String,
    pub name: String,
    pub body: Option<String>,
    pub files: Vec<(String, Vec<u8>)>,
}

impl SmartTemplate {
    /// The template's `index.html`, the file a page made from it says it was
    /// copied from (the commit's `Kasten-Copy-Of`).
    pub fn source(&self) -> String {
        format!("{}/{INDEX_FILE}", dir_of(&self.slug))
    }
}

/// A page that was just kept as a template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSmartTemplate {
    pub slug: String,
    pub name: String,
    pub written: Vec<String>,
}

/// A name that is one plain name: what `slugify` makes of itself.
fn plain(name: &str) -> bool {
    !name.is_empty() && slugify(name) == name && !windows_device(name)
}

fn dir_of(slug: &str) -> String {
    format!("{TEMPLATE_DIR}/{slug}")
}

/// The title a template's manifest gives, if it reads.
fn name_in(vault: &Vault, slug: &str) -> Option<String> {
    let file = vault
        .tracked_file(&format!("{}/{MANIFEST_FILE}", dir_of(slug)))
        .ok()?;
    if fs::metadata(&file).ok()?.len() > MAX_FILE_BYTES {
        return None;
    }
    let text = fs::read_to_string(file).ok()?;
    let title = crate::smart::parse_manifest(&text).ok()?.title;
    (!title.trim().is_empty()).then(|| title.trim().to_owned())
}

/// What a file manager leaves in a folder; never used, and no fault of the template.
fn junk(path: &str) -> bool {
    matches!(
        path.to_ascii_lowercase().as_str(),
        ".ds_store" | "thumbs.db" | "desktop.ini"
    )
}

/// Whether a template folder is fit to use as a whole: every file in it is one
/// a smart page's folder may hold (a program, a hidden file or a `..` anywhere
/// makes the whole template wrong, it is not used in part), and the files are
/// within the sizes and the count a folder is held to. Nothing is read.
fn fit(slug: &str, listed: &[SmartFile]) -> Result<()> {
    if let Some(bad) = listed.iter().find(|f| !f.allowed && !junk(&f.path)) {
        return Err(Error::Invalid(format!(
            "The template “{slug}” holds {}, which a smart page may not have, so it is not used",
            bad.path.escape_debug()
        )));
    }
    let used: Vec<&SmartFile> = listed.iter().filter(|f| f.allowed).collect();
    for file in &used {
        if file.size > MAX_FILE_BYTES {
            return Err(Error::Invalid(format!(
                "{} in the template “{slug}” is too large to use",
                file.path
            )));
        }
        check_path(&file.path)?;
    }
    let body = used.iter().filter(|f| f.path == BODY_FILE).count();
    if used.len() - body > MAX_FILES {
        return Err(Error::Invalid(format!(
            "The template “{slug}” holds more files than a smart page may"
        )));
    }
    if used.iter().map(|f| f.size).sum::<u64>() > MAX_TOTAL_BYTES + MAX_FILE_BYTES {
        return Err(Error::Invalid(format!(
            "The template “{slug}” is larger than a smart page may be"
        )));
    }
    Ok(())
}

/// The slugs of the template folders that are there with an `index.html`.
fn slugs(vault: &Vault) -> Result<Vec<String>> {
    let dir = vault.tracked_file(TEMPLATE_DIR)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // A link is not followed.
        if entry.file_type()?.is_dir()
            && plain(&name)
            && vault
                .tracked_file(&format!("{}/{INDEX_FILE}", dir_of(&name)))
                .is_ok_and(|index| fs::symlink_metadata(index).is_ok_and(|m| m.is_file()))
        {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

impl Kasten {
    /// The smart templates the vault holds, by name. A template folder that is
    /// not fit to use as a whole (a program or hidden file in it, files over
    /// the limits) is not offered.
    pub fn smart_templates(&self) -> Result<Vec<SmartTemplateInfo>> {
        let mut out: Vec<SmartTemplateInfo> = slugs(&self.vault)?
            .into_iter()
            .filter(|slug| {
                crate::smart::list_files(&self.vault, &dir_of(slug))
                    .and_then(|listed| fit(slug, &listed))
                    .is_ok()
            })
            .map(|slug| SmartTemplateInfo {
                name: name_in(&self.vault, &slug).unwrap_or_else(|| slug.clone()),
                slug,
            })
            .collect();
        out.sort_by_cached_key(|t| (t.name.to_lowercase(), t.slug.clone()));
        Ok(out)
    }

    /// The template `slug`, ready to make a page from. A folder with anything
    /// in it a smart page may not have, or over the limits, is refused as a
    /// whole; the files have to pass the same checks as any new folder.
    pub fn smart_template(&self, slug: &str) -> Result<SmartTemplate> {
        if !plain(slug) {
            return Err(Error::Invalid(format!("There is no template “{slug}”")));
        }
        let dir = dir_of(slug);
        let listed = crate::smart::list_files(&self.vault, &dir)?;
        fit(slug, &listed)?;
        let mut files = Vec::new();
        let mut body = None;
        for file in listed.iter().filter(|f| f.allowed) {
            let path = self.vault.tracked_file(&format!("{dir}/{}", file.path))?;
            let bytes = fs::read(path)?;
            if file.path == BODY_FILE {
                body = String::from_utf8(bytes).ok();
            } else {
                files.push((file.path.clone(), bytes));
            }
        }
        let pairs: Vec<(&str, &[u8])> = files
            .iter()
            .map(|(p, b)| (p.as_str(), b.as_slice()))
            .collect();
        check_new(&pairs)?;
        Ok(SmartTemplate {
            name: name_in(&self.vault, slug).unwrap_or_else(|| slug.to_owned()),
            slug: slug.to_owned(),
            body,
            files,
        })
    }

    /// Keeps the smart page at `page` as a template called `name` (blank takes
    /// the page's title): its code folder and its text, copied to
    /// `templates/smart/<slug>/` in one commit. A name that is taken gets
    /// `-2`, `-3`… and nothing there is touched; a name with no letter or digit
    /// in it, or that a computer reads as a device, is refused.
    pub fn smart_save_template(
        &self,
        actor: &Actor,
        page: &str,
        name: &str,
        now: Instant,
    ) -> Result<SavedSmartTemplate> {
        person_only(actor)?;
        let kept = crate::smart::listing(&self.vault, page)?;
        if !kept.files.iter().any(|f| f.path == INDEX_FILE) {
            return Err(Error::Invalid(
                "This page has no smart view to keep: it needs an index.html".to_owned(),
            ));
        }
        if kept.files.iter().any(|f| f.path == BODY_FILE) {
            return Err(Error::Invalid(format!(
                "A template keeps the page's text in a file called {BODY_FILE}; give the one in this page's folder another name first"
            )));
        }
        let title = self.vault.read(page)?.meta.title;
        let name = if name.trim().is_empty() {
            title.trim()
        } else {
            name.trim()
        };
        let wanted = slugify(name);
        if wanted.is_empty() || windows_device(&wanted) {
            return Err(Error::Invalid(
                "Give the template a name with letters or digits in it".to_owned(),
            ));
        }
        // The commit says which page it keeps, so a page made from the template
        // is still told as made by whoever made that page (`first_commit`).
        let copied = [(crate::history::COPY_OF, page.to_owned())];
        self.apply_with(
            actor,
            "smart_save_template",
            false,
            now.millis,
            &copied,
            |vault| {
                let mut files: Vec<(String, Vec<u8>)> = Vec::new();
                for file in kept.files.iter().filter(|f| f.allowed) {
                    let read = crate::smart::read_file(vault, page, &file.path)?;
                    files.push((file.path.clone(), read.bytes));
                }
                let note = vault.read(page)?;
                let body = split(&note.text).body;
                if !body.trim().is_empty() {
                    files.push((BODY_FILE.to_owned(), body.as_bytes().to_vec()));
                }
                let pairs: Vec<(&str, &[u8])> = files
                    .iter()
                    .map(|(p, b)| (p.as_str(), b.as_slice()))
                    .collect();
                check_new(&pairs)?;
                let slug = free_slug(vault, &wanted)?;
                let dir = dir_of(&slug);
                let mut done = Rollback::default();
                let mut written = Vec::new();
                for (rel, bytes) in &files {
                    let path = format!("{dir}/{rel}");
                    let made = vault
                        .tracked_file(&path)
                        .and_then(|file| Ok(done.create(&file, bytes)?));
                    if let Err(err) = made {
                        done.put_back();
                        return Err(err);
                    }
                    written.push(path);
                }
                Ok(Change {
                    message: format!("template: save {name}"),
                    paths: written.clone(),
                    value: SavedSmartTemplate {
                        slug,
                        name: name.to_owned(),
                        written,
                    },
                })
            },
        )
    }
}

/// `wanted`, or `wanted-2`, `wanted-3`… whichever has no folder yet.
fn free_slug(vault: &Vault, wanted: &str) -> Result<String> {
    for n in 1..=99 {
        let slug = if n == 1 {
            wanted.to_owned()
        } else {
            format!("{wanted}-{n}")
        };
        let taken = vault
            .tracked_file(&dir_of(&slug))
            .is_ok_and(|dir| fs::symlink_metadata(dir).is_ok());
        if !taken {
            return Ok(slug);
        }
    }
    Err(Error::Invalid(
        "There are too many templates with that name".to_owned(),
    ))
}
