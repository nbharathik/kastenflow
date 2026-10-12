//! A vault: one folder of notes. Notes are named by
//! their vault-relative path; every path is checked before any file is read
//! or written, so no op can reach outside the vault or into its private
//! folders (`.git`, `.kasten`, `.trash`).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::error::{Error, Result};
use crate::note::{NoteFile, NoteMeta, content_hash, meta_for};

/// A file's place, time and size, without reading it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStat {
    pub path: String,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

/// Folders Kasten never lists or writes notes into.
fn private(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// Whether a vault path is in `templates/`, however its folder is spelled:
/// on macOS and Windows `Templates/` and `TEMPLATEſ/` are the same folder.
pub(crate) fn in_templates(rel: &str) -> bool {
    let first = rel.split('/').next().unwrap_or(rel);
    first.to_lowercase() == "templates" || first.to_uppercase() == "TEMPLATES"
}

/// A name Windows reads as another: it drops trailing dots and spaces
/// (`templates./x.md` is `templates/x.md`), keeps device names, and gives
/// long names a short alias such as `TEMPLA~1`.
pub(crate) fn aliases_on_windows(part: &str) -> bool {
    let base = part.split('.').next().unwrap_or(part);
    let short = base.rsplit_once('~').is_some_and(|(stem, n)| {
        (1..=6).contains(&stem.chars().count())
            && !n.is_empty()
            && n.bytes().all(|b| b.is_ascii_digit())
    });
    part.ends_with(['.', ' ']) || crate::slug::windows_device(part) || short
}

fn modified(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

impl Vault {
    /// Opens an existing vault folder.
    pub fn open(root: impl Into<PathBuf>) -> Result<Vault> {
        let root = root.into();
        if !root.is_dir() {
            return Err(Error::Invalid(format!(
                "No vault folder at {}",
                root.display()
            )));
        }
        Ok(Vault { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The file for a vault-relative note path, after checking the path is
    /// plain: forward slashes, no `.` or `..`, no private folder, ends in `.md`.
    pub fn path_of(&self, rel: &str) -> Result<PathBuf> {
        self.file_of(rel, &[".md"])
    }

    /// `path_of` for other vault files, such as boards (`.canvas`) and tag
    /// schemas (`.yaml`): the path must end in one of `exts`.
    ///
    /// A link inside the vault is never followed, since it could lead
    /// anywhere; the walker skips links too. On Windows, names that stand
    /// for another file or a device are refused.
    pub fn file_of(&self, rel: &str, exts: &[&str]) -> Result<PathBuf> {
        let path = self.named(rel, exts)?;
        self.no_links(rel)?;
        Ok(path)
    }

    /// A file a commit names, for undo and restore to write: any kind of
    /// file, `.kasten`, `.trash` and `.gitignore` included, checked by its
    /// form and never through a link. Git's own folder is never written,
    /// however a commit spells it, since a shared vault can carry any
    /// history.
    pub fn tracked_file(&self, rel: &str) -> Result<PathBuf> {
        let invalid = || Error::InvalidPath(rel.to_owned());
        if rel.is_empty() || rel.starts_with('/') || rel.contains(['\\', ':', '\0']) {
            return Err(invalid());
        }
        let mut path = self.root.clone();
        for (i, part) in rel.split('/').enumerate() {
            let git = i == 0
                && part
                    .trim_end_matches(['.', ' '])
                    .eq_ignore_ascii_case(".git");
            if part.is_empty()
                || part == "."
                || part == ".."
                || git
                || (cfg!(windows) && aliases_on_windows(part))
            {
                return Err(invalid());
            }
            path.push(part);
        }
        self.no_links(rel)?;
        Ok(path)
    }

    /// Refuses a path that goes through a link inside the vault: it could
    /// lead anywhere.
    fn no_links(&self, rel: &str) -> Result<()> {
        let mut at = self.root.clone();
        for part in rel.split('/') {
            at.push(part);
            match fs::symlink_metadata(&at) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    return Err(Error::InvalidPath(rel.to_owned()));
                }
                Ok(_) => {}
                // Nothing further in can exist, links included.
                Err(_) => break,
            }
        }
        Ok(())
    }

    /// Whether `rel` is a plain note path by its form alone, without
    /// looking on disk: for sorting paths out before any is read.
    pub fn is_note_path(&self, rel: &str) -> bool {
        self.named(rel, &[".md"]).is_ok()
    }

    /// The file `rel` names, checked by its form: forward slashes, no `.`
    /// or `..`, no private first folder, one of `exts`, and on Windows no
    /// name that stands for another.
    fn named(&self, rel: &str, exts: &[&str]) -> Result<PathBuf> {
        let invalid = || Error::InvalidPath(rel.to_owned());
        if rel.is_empty()
            || rel.starts_with('/')
            || rel.contains(['\\', ':', '\0'])
            || !exts.iter().any(|ext| rel.ends_with(ext))
        {
            return Err(invalid());
        }
        let mut path = self.root.clone();
        for (i, part) in rel.split('/').enumerate() {
            if part.is_empty()
                || part == "."
                || part == ".."
                || (i == 0 && private(part))
                || (cfg!(windows) && aliases_on_windows(part))
            {
                return Err(invalid());
            }
            path.push(part);
        }
        Ok(path)
    }

    /// Every note in the vault, sorted by path. Templates are included, with
    /// kind `template`.
    pub fn notes(&self) -> Result<Vec<NoteMeta>> {
        let mut out = Vec::new();
        self.walk(&self.root, "", &mut out)?;
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    /// Every file ending in `ext` outside private folders, sorted by path,
    /// with times and sizes but not contents.
    pub fn files(&self, ext: &str) -> Result<Vec<FileStat>> {
        self.files_among(&[ext])
    }

    /// `files` for several endings in one walk of the vault.
    pub fn files_among(&self, exts: &[&str]) -> Result<Vec<FileStat>> {
        let mut out = Vec::new();
        self.walk_stats(&self.root, "", exts, &mut out)?;
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    /// `files` in one folder of the vault, for a folder that appeared or
    /// was renamed as a whole. A path that is not plain, is private or goes
    /// through a link is refused; one that is not a folder has none.
    pub fn files_in(&self, dir: &str, ext: &str) -> Result<Vec<FileStat>> {
        let path = self.named(dir, &[""])?;
        if dir.split('/').any(private) {
            return Err(Error::InvalidPath(dir.to_owned()));
        }
        self.no_links(dir)?;
        let mut out = Vec::new();
        if fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_dir()) {
            self.walk_stats(&path, dir, &[ext], &mut out)?;
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn walk_stats(
        &self,
        dir: &Path,
        prefix: &str,
        exts: &[&str],
        out: &mut Vec<FileStat>,
    ) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            let kind = entry.file_type()?;
            // The path is made only for what is used: a folder to go into or
            // a file that is wanted, not for each of the vault's other files.
            let rel = || {
                if prefix.is_empty() {
                    name.to_string()
                } else {
                    format!("{prefix}/{name}")
                }
            };
            if kind.is_dir() && !private(&name) {
                self.walk_stats(&entry.path(), &rel(), exts, out)?;
            } else if kind.is_file()
                && !name.starts_with('.')
                && exts.iter().any(|ext| name.ends_with(ext))
            {
                let rel = rel();
                let meta = entry.metadata()?;
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64);
                out.push(FileStat {
                    path: rel,
                    modified,
                    size: meta.len(),
                });
            }
        }
        Ok(())
    }

    fn walk(&self, dir: &Path, prefix: &str, out: &mut Vec<NoteMeta>) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = entry.file_type()?;
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            // Symbolic links are not followed, so a link cannot loop or lead out.
            if kind.is_dir() && !private(&name) {
                self.walk(&entry.path(), &rel, out)?;
            } else if kind.is_file() && name.ends_with(".md") && !name.starts_with('.') {
                let Ok(text) = fs::read_to_string(entry.path()) else {
                    continue;
                };
                out.push(meta_for(&rel, &text, modified(&entry.path())));
            }
        }
        Ok(())
    }

    /// A note's text, hash and metadata.
    pub fn read(&self, rel: &str) -> Result<NoteFile> {
        let path = self.path_of(rel)?;
        let text = fs::read_to_string(&path).map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => Error::NotFound(rel.to_owned()),
            _ => Error::Io(err),
        })?;
        Ok(NoteFile {
            meta: meta_for(rel, &text, modified(&path)),
            hash: content_hash(&text),
            text,
        })
    }

    /// Whether a note exists at `rel`.
    pub fn exists(&self, rel: &str) -> bool {
        self.path_of(rel).is_ok_and(|p| p.exists())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_templates_under_any_spelling_of_their_folder() {
        for path in [
            "templates/x.md",
            "Templates/x.md",
            "TEMPLATES/x.md",
            "templateſ/x.md",
        ] {
            assert!(in_templates(path), "{path}");
        }
        for path in ["library/templates/x.md", "templates-old/x.md", "x.md"] {
            assert!(!in_templates(path), "{path}");
        }
    }

    #[test]
    fn knows_the_names_windows_reads_as_another() {
        for part in [
            "templates.",
            "templates ",
            "con",
            "NUL.md",
            "TEMPLA~1",
            "PROGRA~2.md",
        ] {
            assert!(aliases_on_windows(part), "{part}");
        }
        for part in [
            "templates",
            "notes~draft.md",
            "a~b~c",
            "console.md",
            "x.md",
            "toolong~1",
        ] {
            assert!(!aliases_on_windows(part), "{part}");
        }
    }
}
