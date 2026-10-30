//! The setups a person keeps: all of them listed (the built-in ones first), a
//! saved one renamed (only the `name:` line of its file changes, so a key or
//! comment they added stays) and deleted (it goes to the trash, with its
//! folder, in one commit that undo takes back; nothing is removed for good).
//! Only a person does either.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::setup_save_plan::check_name;
use super::setup_saved::{folder_path, info, no_such, saved_infos, slug_of, yaml_path};
use super::setups::{SetupInfo, setups};
use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::frontmatter::set_key;
use crate::history::Actor;
use crate::ops::eol_of;
use crate::rollback::Rollback;
use crate::time::Instant;

/// A saved setup that was moved to the trash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupGone {
    pub id: String,
    /// Where its file is now, `.trash/<time>/templates/setups/<slug>.yaml`.
    pub trashed: String,
    /// The commit, for Undo; none in a vault without history.
    pub commit: Option<String>,
}

fn people_only(actor: &Actor) -> Result<()> {
    if actor.is_agent() {
        return Err(Error::Invalid(
            "A person renames and deletes setups; an agent may save one".to_owned(),
        ));
    }
    Ok(())
}

/// `text` with its `name:` line set to `name` (added at the end when it has
/// none), every other byte as it was.
fn rename_text(text: &str, name: &str) -> Result<String> {
    if text.starts_with("---") || text.starts_with('\u{feff}') {
        return Err(Error::Invalid(
            "This setup's file starts with a document mark, so it cannot be renamed here"
                .to_owned(),
        ));
    }
    let eol = eol_of(text);
    let closed = text.ends_with('\n');
    let fence = format!("---{eol}");
    let end = if closed { "" } else { eol };
    let wrapped = format!("{fence}{text}{end}{fence}");
    let out = set_key(&wrapped, "name", Some(name), eol);
    let inner = out
        .strip_prefix(&fence)
        .and_then(|rest| rest.strip_suffix(&fence))
        .ok_or_else(|| Error::Invalid("This setup's file could not be renamed".to_owned()))?;
    Ok(if closed {
        inner.to_owned()
    } else {
        inner.strip_suffix(eol).unwrap_or(inner).to_owned()
    })
}

/// Every file under `rel`, as paths relative to the vault; a link is refused.
fn files_under(root: &Path, rel: &str, out: &mut Vec<String>) -> Result<()> {
    for entry in fs::read_dir(root.join(rel))? {
        let entry = entry?;
        let path = format!("{rel}/{}", entry.file_name().to_string_lossy());
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(Error::InvalidPath(path));
        }
        if kind.is_dir() {
            files_under(root, &path, out)?;
        } else {
            out.push(path);
        }
    }
    Ok(())
}

impl Kasten {
    /// Every setup on offer: the built-in ones, then the ones the person saved, by name.
    pub fn list_setups(&self) -> Result<Vec<SetupInfo>> {
        let mut all = setups();
        all.extend(saved_infos(&self.vault)?);
        Ok(all)
    }

    /// Gives the saved setup `id` another name: its `name:` line changes and
    /// nothing else in the file; its file name stays. One commit.
    pub fn rename_setup(
        &self,
        actor: &Actor,
        id: &str,
        name: &str,
        now: Instant,
    ) -> Result<SetupInfo> {
        people_only(actor)?;
        let name = check_name(name)?;
        let slug = slug_of(id).ok_or_else(|| no_such(id))?.to_owned();
        let trailers = [("Kasten-Setup", id.to_owned())];
        self.apply_with(
            actor,
            "rename_setup",
            false,
            now.millis,
            &trailers,
            |vault| {
                let path = yaml_path(&slug);
                let file = vault.file_of(&path, &[".yaml"])?;
                let text = match fs::read_to_string(&file) {
                    Ok(text) if fs::symlink_metadata(&file).is_ok_and(|m| m.is_file()) => text,
                    _ => return Err(no_such(id)),
                };
                let edited = rename_text(&text, &name)?;
                if edited == text {
                    return Ok(Change {
                        message: String::new(),
                        paths: Vec::new(),
                        value: info(vault, &slug)?,
                    });
                }
                write_atomic(&file, edited.as_bytes())?;
                let renamed = info(vault, &slug)?;
                if renamed.name != name {
                    write_atomic(&file, text.as_bytes())?;
                    return Err(Error::Invalid(
                        "That name could not be written into the setup".to_owned(),
                    ));
                }
                Ok(Change {
                    message: format!("setup: rename {name}"),
                    paths: vec![path],
                    value: renamed,
                })
            },
        )
    }

    /// Moves the saved setup `id` and its folder of files to the trash, in
    /// one commit that undo takes back. A built-in setup is not one to delete.
    pub fn trash_setup(&self, actor: &Actor, id: &str, now: Instant) -> Result<SetupGone> {
        people_only(actor)?;
        let slug = slug_of(id).ok_or_else(|| no_such(id))?.to_owned();
        let trailers = [("Kasten-Setup", id.to_owned())];
        let (gone, commit) = self.apply_committing(
            actor,
            "trash_setup",
            false,
            now.millis,
            &trailers,
            |vault| {
                let yaml = yaml_path(&slug);
                let file = vault.file_of(&yaml, &[".yaml"])?;
                if !fs::symlink_metadata(&file).is_ok_and(|m| m.is_file()) {
                    return Err(no_such(id));
                }
                let dir_rel = folder_path(&slug);
                let dir = vault.file_of(&dir_rel, &[""])?;
                let has_dir = fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir());
                let mut originals = vec![yaml.clone()];
                if has_dir {
                    files_under(vault.root(), &dir_rel, &mut originals)?;
                }
                originals.sort();
                let stamp = crate::trash::free_stamp(vault, now);
                let trash = vault.root().join(".trash").join(&stamp);
                let mut moves: Vec<(PathBuf, PathBuf)> = vec![(file, trash.join(&yaml))];
                if has_dir {
                    moves.push((dir, trash.join(&dir_rel)));
                }
                let mut done = Rollback::default();
                for (from, to) in &moves {
                    if let Err(err) = done.rename(from, to) {
                        done.put_back();
                        return Err(err.into());
                    }
                }
                let mut paths = originals.clone();
                paths.extend(originals.iter().map(|p| format!(".trash/{stamp}/{p}")));
                Ok(Change {
                    message: format!("trash: setup {slug}"),
                    paths,
                    value: SetupGone {
                        id: id.to_owned(),
                        trashed: format!(".trash/{stamp}/{yaml}"),
                        commit: None,
                    },
                })
            },
        )?;
        Ok(SetupGone { commit, ..gone })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_name_line_changes_and_a_missing_one_is_added() {
        let text = "# mine\nname: Old\nicon: x\nextra:\n  - 1\n";
        assert_eq!(
            rename_text(text, "New one").unwrap(),
            "# mine\nname: New one\nicon: x\nextra:\n  - 1\n"
        );
        assert_eq!(
            rename_text("icon: x\n", "Nova").unwrap(),
            "icon: x\nname: Nova\n"
        );
        // A name YAML would read as something else is quoted.
        assert_eq!(
            rename_text("icon: x\n", "no").unwrap(),
            "icon: x\nname: \"no\"\n"
        );
        assert_eq!(rename_text("name: A", "B").unwrap(), "name: B");
        assert_eq!(
            rename_text("name: A\r\nicon: x\r\n", "B").unwrap(),
            "name: B\r\nicon: x\r\n"
        );
        assert!(rename_text("---\nname: A\n", "B").is_err());
    }
}
