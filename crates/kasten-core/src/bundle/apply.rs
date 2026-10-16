//! Writing an import of a bundle, inside the engine's lock: every file is checked
//! against the manifest again as it is read, rewritten where the import settled a
//! name, and created new (nothing is replaced); the works go on the end of the managed
//! bibliography. The paths written go into the import's one commit. An import that
//! fails part way is put back, so it can be tried again.

use std::fs;
use std::io::ErrorKind;

use slides_assets::{Sidecar, sha256_hex};

use super::import::Prepared;
use super::places::{How, Move};
use super::rewrite;
use crate::bib::{MANAGED, edit};
use crate::cite;
use crate::deck;
use crate::error::{Error, Result};
use crate::note::content_hash;
use crate::rollback::Rollback;
use crate::vault::Vault;

fn stale() -> Error {
    Error::Invalid("The vault changed while the import was being prepared; import again".to_owned())
}

/// The text of a file with what the import settled written in it.
fn rewritten(prepared: &Prepared, file: &Move, bytes: Vec<u8>) -> Vec<u8> {
    if file.how == How::Plain {
        return bytes;
    }
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return bytes;
    };
    let mut out = text.to_owned();
    if file.how == How::Card {
        for (old, new) in &prepared.keys {
            if let Ok(mut card) = Sidecar::parse(&out)
                && card.citation_key() == Some(old.as_str())
            {
                card.set_citation_key(Some(new));
                out = card.to_text();
            }
        }
    } else {
        out = rewrite::ids(&out, &prepared.ids);
        if prepared.slug != prepared.old_folder {
            out = rewrite::folder(&out, &prepared.old_folder, &prepared.slug);
        }
        for (old, new) in &prepared.files {
            out = rewrite::file(&out, old, new);
        }
        for (old, new) in &prepared.keys {
            match file.how {
                How::Note => out = cite::rename_in(&out, old, new).0,
                How::Deck => {
                    if let Some(next) = deck::cites::swap_keys(&out, old, new) {
                        out = next;
                    }
                }
                _ => {}
            }
        }
    }
    if out.as_bytes() == bytes.as_slice() {
        bytes
    } else {
        out.into_bytes()
    }
}

/// Writes the import; gives the paths written. All of it or none.
pub(crate) fn write(vault: &Vault, prepared: &Prepared) -> Result<Vec<String>> {
    let root = vault.root();
    if root.join("projects").join(&prepared.slug).exists() {
        return Err(stale());
    }
    for file in &prepared.moves {
        if root.join(&file.to).exists() {
            return Err(stale());
        }
    }
    let mut done = Rollback::default();
    let written = write_all(vault, prepared, &mut done);
    if written.is_err() {
        done.put_back();
    }
    written
}

fn write_all(vault: &Vault, prepared: &Prepared, done: &mut Rollback) -> Result<Vec<String>> {
    let mut paths = Vec::new();
    for file in &prepared.moves {
        let from = prepared
            .root
            .join(file.from.replace('/', std::path::MAIN_SEPARATOR_STR));
        let bytes = fs::read(&from)?;
        if sha256_hex(&bytes) != file.sha256 {
            return Err(Error::Invalid(format!(
                "{} changed while it was being imported. Nothing was imported",
                file.from
            )));
        }
        let bytes = rewritten(prepared, file, bytes);
        done.create(&vault.file_of(&file.to, &[""])?, &bytes)
            .map_err(|err| match err.kind() {
                ErrorKind::AlreadyExists => stale(),
                _ => err.into(),
            })?;
        paths.push(file.to.clone());
    }
    if let Some(bib) = &prepared.bib {
        let file = vault.file_of(MANAGED, &[".bib"])?;
        let before = match fs::read(&file) {
            Ok(bytes) => Some(bytes),
            Err(err) if err.kind() == ErrorKind::NotFound => None,
            Err(err) => return Err(err.into()),
        };
        let mut text = String::from_utf8(before.clone().unwrap_or_default()).map_err(|_| {
            Error::Invalid(format!("{MANAGED} is not UTF-8 text, so it is not edited"))
        })?;
        if content_hash(&text) != bib.base_hash {
            return Err(stale());
        }
        for chunk in &bib.chunks {
            text = edit::append(&text, chunk);
        }
        done.write(&file, text.as_bytes(), before)?;
        paths.push(MANAGED.to_owned());
    }
    Ok(paths)
}
