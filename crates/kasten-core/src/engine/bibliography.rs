//! The vault's bibliography: the managed `.bib` file (`sources/references.bib`),
//! the external `.bib` files that are read only, the duplicates among them, and
//! adding, updating and adopting references (`write`).

mod problems;
mod write;

use std::collections::BTreeSet;
use std::fs;
use std::io::ErrorKind;

use super::Kasten;
use super::references::{BibText, MAX_BIB_BYTES};
use crate::bib::{
    BibEntry, BibFile, Bibliography, KeyHints, MANAGED, NewReference, ReferenceMatch, dups, key,
    style,
};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::note::content_hash;
use crate::vault::Vault;

/// The managed file as it is: its text, and whether it exists.
pub(super) struct Managed {
    pub text: String,
    pub exists: bool,
}

/// Refuses an agent: the bibliography is changed by the person.
pub(super) fn person_only(actor: &Actor, what: &str) -> Result<()> {
    if actor.is_agent() {
        return Err(Error::Invalid(format!(
            "{what} is done by the person, not by an agent"
        )));
    }
    Ok(())
}

/// The sentence for an edit that started from a file that has changed since.
pub(super) fn changed_since() -> Error {
    Error::Invalid(
        "The bibliography changed since you read it. Open it again and make the change once more"
            .to_owned(),
    )
}

/// The managed file's text, for an edit: UTF-8 and not too big to read.
pub(super) fn managed_text(vault: &Vault) -> Result<Managed> {
    let path = vault.file_of(MANAGED, &[".bib"])?;
    match fs::read(&path) {
        Ok(bytes) if bytes.len() as u64 > MAX_BIB_BYTES => Err(Error::Invalid(format!(
            "{MANAGED} is over 4 MB, which is too big to edit"
        ))),
        Ok(bytes) => String::from_utf8(bytes)
            .map(|text| Managed { text, exists: true })
            .map_err(|_| {
                Error::Invalid(format!("{MANAGED} is not UTF-8 text, so it is not edited"))
            }),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(Managed {
            text: String::new(),
            exists: false,
        }),
        Err(err) => Err(err.into()),
    }
}

fn file_of(read: BibText) -> BibFile {
    let text = read.text.unwrap_or_default();
    let entries = slides_bib::read(&text)
        .into_iter()
        .map(|raw| BibEntry {
            key: raw.key,
            kind: raw.kind,
            fields: raw.fields,
        })
        .collect();
    BibFile {
        managed: read.path == MANAGED,
        exists: true,
        hash: content_hash(&text),
        bytes: read.bytes,
        problem: read.problem,
        entries,
        path: read.path,
    }
}

fn absent() -> BibFile {
    BibFile {
        path: MANAGED.to_owned(),
        managed: true,
        exists: false,
        hash: content_hash(""),
        bytes: 0,
        problem: None,
        entries: Vec::new(),
    }
}

impl Kasten {
    /// The managed file, the external files and the duplicates among them.
    pub fn bibliography(&self) -> Result<Bibliography> {
        let mut managed = None;
        let mut external = Vec::new();
        for read in self.read_bib_files()? {
            let file = file_of(read);
            if file.managed {
                managed = Some(file);
            } else {
                external.push(file);
            }
        }
        let managed = managed.unwrap_or_else(absent);
        let all: Vec<&BibFile> = std::iter::once(&managed).chain(&external).collect();
        Ok(Bibliography {
            duplicates: dups::duplicates(&all),
            managed,
            external,
        })
    }

    /// The entries in the bibliography that `reference` would repeat, the managed
    /// file's first. Writes nothing.
    pub fn check_reference(&self, reference: &NewReference) -> Result<Vec<ReferenceMatch>> {
        let fields = clean_fields(&reference.fields)?;
        let bibliography = self.bibliography()?;
        let all: Vec<&BibFile> = std::iter::once(&bibliography.managed)
            .chain(&bibliography.external)
            .collect();
        Ok(dups::matches(&all, reference.key.trim(), &fields))
    }

    /// A key for a work, `vaswani2017attention`, that no `.bib` file of the vault
    /// uses (compared without regard to case). Writes nothing.
    pub fn suggest_key(&self, hints: &KeyHints) -> Result<String> {
        let bibliography = self.bibliography()?;
        let taken: BTreeSet<String> = std::iter::once(&bibliography.managed)
            .chain(&bibliography.external)
            .flat_map(|file| file.entries.iter())
            .map(|entry| entry.key.to_lowercase())
            .collect();
        Ok(key::suggest(hints, &|candidate| {
            taken.contains(&candidate.to_lowercase())
        }))
    }
}

/// Field names and values as they will be written; empty values left out.
pub(super) fn clean_fields(
    fields: &std::collections::BTreeMap<String, String>,
) -> Result<std::collections::BTreeMap<String, String>> {
    let mut out = std::collections::BTreeMap::new();
    for (name, value) in fields {
        let name = style::check_name(name)?;
        let value = style::check_value(&name, value)?;
        if !value.is_empty() {
            out.insert(name, value);
        }
    }
    Ok(out)
}
