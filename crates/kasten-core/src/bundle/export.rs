//! Writing a bundle into a folder outside the vault. The folder must be new or
//! empty; nothing is written in the vault and nothing is replaced. The manifest
//! goes last, so a folder an export stopped in is not taken for a bundle. Nothing
//! is deleted when an export fails: the person is told, and the folder is theirs.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use super::manifest::{FORMAT, MANIFEST_FILE, Manifest, ManifestFile, ManifestProject, VERSION};
use super::{BundleExported, Collected, MOST_FILE_BYTES, Source};
use crate::atomic::create_atomic;
use crate::error::{Error, Result};
use crate::time::Instant;

fn refuse(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// The folder to export into, as an absolute path with links resolved as far as it exists:
/// outside the vault, and either not there yet or an empty folder.
pub(crate) fn check_dest(vault: &Path, dest: &Path) -> Result<PathBuf> {
    if dest.as_os_str().is_empty() {
        return Err(refuse("Choose a folder to export into"));
    }
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    let mut near = dest.to_path_buf();
    // The nearest folder that exists, and the parts below it that do not.
    while fs::symlink_metadata(&near).is_err() {
        let Some(name) = near.file_name().map(ToOwned::to_owned) else {
            return Err(refuse(format!("There is no folder at {}", dest.display())));
        };
        missing.push(name);
        if !near.pop() {
            return Err(refuse(format!("There is no folder at {}", dest.display())));
        }
    }
    let mut resolved = fs::canonicalize(&near)
        .map_err(|_| refuse(format!("{} cannot be used", near.display())))?;
    if !resolved.is_dir() {
        return Err(refuse(format!(
            "{} is a file, not a folder",
            dest.display()
        )));
    }
    for name in missing.into_iter().rev() {
        if Path::new(&name)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(refuse(format!("{} cannot be used", dest.display())));
        }
        resolved.push(name);
    }
    let vault = fs::canonicalize(vault)?;
    if resolved.starts_with(&vault) {
        return Err(refuse(
            "Choose a folder outside the vault: a bundle is a copy to take away, and nothing is written in the vault",
        ));
    }
    if vault.starts_with(&resolved) {
        return Err(refuse(
            "That folder holds the vault; choose a folder outside it",
        ));
    }
    if resolved.exists() && fs::read_dir(&resolved)?.next().is_some() {
        return Err(refuse(
            "That folder is not empty. Choose a new folder, or an empty one, so nothing in it is replaced",
        ));
    }
    Ok(resolved)
}

fn bytes_of(source: &Source) -> Result<Vec<u8>> {
    match source {
        Source::File(path) => Ok(fs::read(path)?),
        Source::Text(text) => Ok(text.clone().into_bytes()),
    }
}

/// Writes the bundle: every file, then the manifest. Gives what was written.
pub(crate) fn write(
    collected: &Collected,
    vault: &Path,
    dest: &Path,
    now: Instant,
) -> Result<BundleExported> {
    let folder = check_dest(vault, dest)?;
    let mut listed = Vec::with_capacity(collected.files.len());
    let mut total = 0u64;
    for file in &collected.files {
        let bytes = bytes_of(&file.source)?;
        if bytes.len() as u64 > MOST_FILE_BYTES {
            return Err(refuse(format!("{} is too big for a bundle", file.path)));
        }
        let target = folder.join(file.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        create_atomic(&target, &bytes).map_err(|err| match err.kind() {
            ErrorKind::AlreadyExists => refuse(format!("{} is there already", file.path)),
            _ => Error::Io(err),
        })?;
        total += bytes.len() as u64;
        listed.push(ManifestFile {
            path: file.path.clone(),
            bytes: bytes.len() as u64,
            sha256: slides_assets::sha256_hex(&bytes),
        });
    }
    let manifest = Manifest {
        format: FORMAT.to_owned(),
        version: VERSION,
        made: now.rfc3339(),
        app: format!("{} {}", crate::PRODUCT_NAME, crate::VERSION),
        project: ManifestProject {
            folder: collected.project.folder.clone(),
            title: collected.project.title.clone(),
            id: collected.project.id.clone(),
        },
        files: listed,
        references: collected.references.clone(),
        outside: collected.outside.clone(),
    };
    create_atomic(&folder.join(MANIFEST_FILE), manifest.to_text().as_bytes())?;
    Ok(BundleExported {
        dest: dest.display().to_string(),
        files: manifest.files.len(),
        bytes: total,
        references: collected.references.len(),
        outside: collected.outside.clone(),
    })
}
