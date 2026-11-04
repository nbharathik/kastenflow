//! Writing a plan, inside the engine's lock. Nothing is replaced: files are
//! created new, and a journal day already here gets the imported day added
//! under a heading. The paths written go into the import's one commit; an
//! import that fails part way is put back, so it can be tried again.

use std::fs;

use super::plan::Plan;
use crate::error::{Error, Result};
use crate::frontmatter::{set_key, set_key_raw, split, yaml_list};
use crate::rollback::Rollback;
use crate::sources::{Sidecar, sidecar_of};
use crate::time::Instant;
use crate::vault::Vault;

fn stale() -> Error {
    Error::Invalid("The vault changed while the import was being prepared; import again".to_owned())
}

/// The file for any vault path the plan holds, checked as note paths are.
fn file_of(vault: &Vault, path: &str) -> Result<std::path::PathBuf> {
    let ext = path.rsplit_once('.').map_or("", |(_, e)| e);
    vault.file_of(path, &[&format!(".{ext}"), ""])
}

pub(crate) fn write(vault: &Vault, plan: &Plan, now: Instant) -> Result<Vec<String>> {
    let root = vault.root();
    let new = plan
        .notes
        .iter()
        .chain(&plan.boards)
        .map(|w| w.path.as_str())
        .chain(plan.copies.iter().map(|c| c.path.as_str()))
        .chain(
            plan.pdfs
                .iter()
                .filter(|p| !p.reuse)
                .map(|p| p.path.as_str()),
        );
    if root.join(&plan.folder).exists() {
        return Err(stale());
    }
    for path in new {
        if root.join(path).exists() {
            return Err(stale());
        }
    }
    let mut done = Rollback::default();
    let written = write_all(vault, plan, now, &mut done);
    if written.is_err() {
        done.put_back();
    }
    written
}

fn write_all(vault: &Vault, plan: &Plan, now: Instant, done: &mut Rollback) -> Result<Vec<String>> {
    let mut paths = Vec::new();
    for w in plan.notes.iter().chain(&plan.boards) {
        done.create(&file_of(vault, &w.path)?, w.text.as_bytes())?;
        paths.push(w.path.clone());
    }
    for w in &plan.tags {
        let file = file_of(vault, &w.path)?;
        if !file.exists() {
            done.create(&file, w.text.as_bytes())?;
            paths.push(w.path.clone());
        }
    }
    for c in &plan.copies {
        done.create(&file_of(vault, &c.path)?, &fs::read(&c.from)?)?;
        paths.push(c.path.clone());
    }
    for pdf in plan.pdfs.iter().filter(|p| !p.reuse) {
        done.create(&file_of(vault, &pdf.path)?, &fs::read(&pdf.from)?)?;
        let car = sidecar_of(&pdf.path)?;
        done.create(
            &file_of(vault, &car)?,
            Sidecar::new(&pdf.title).to_text().as_bytes(),
        )?;
        paths.extend([pdf.path.clone(), car]);
    }
    for day in &plan.days {
        let path = crate::journal_path::journal_path(None, &day.date)?;
        let file = vault.path_of(&path)?;
        if day.exists {
            let before = fs::read(&file)?;
            let current = vault.read(&path)?;
            let text = added(&current.text, &current.meta.tags, day, &plan.project, now);
            done.write(&file, text.as_bytes(), Some(before))?;
        } else {
            done.create(&file, day.text.as_bytes())
                .map_err(|err| match err.kind() {
                    std::io::ErrorKind::AlreadyExists => stale(),
                    _ => err.into(),
                })?;
        }
        paths.push(path);
    }
    Ok(paths)
}

/// A day already here, with the imported day's text added under a heading
/// and its tags joined to the day's.
fn added(
    text: &str,
    tags: &[String],
    day: &super::plan::Day,
    project: &str,
    now: Instant,
) -> String {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let parts = split(text);
    let mut prefix = parts.prefix.to_owned();
    let mut all: Vec<String> = tags.to_vec();
    for tag in &day.tags {
        if !all.iter().any(|t| t.to_lowercase() == tag.to_lowercase()) {
            all.push(tag.clone());
        }
    }
    if all.len() > tags.len() {
        prefix = set_key_raw(&prefix, "tags", Some(&yaml_list(&all)), eol);
    }
    prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    let mut body = parts.body.to_owned();
    if !body.is_empty() && !body.ends_with('\n') {
        body.push_str(eol);
    }
    if !body.trim().is_empty() {
        body.push_str(eol);
    }
    body.push_str(&format!("## From {project}{eol}{eol}"));
    body.push_str(&day.text.replace("\r\n", "\n").replace('\n', eol));
    format!("{prefix}{body}")
}
