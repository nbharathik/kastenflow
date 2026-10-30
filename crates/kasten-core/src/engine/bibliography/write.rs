//! Changing the managed bibliography: adding a reference, setting fields, replacing an
//! entry's text and making a managed copy of an external file. Each is one commit that
//! undo takes back, names the hash of the file it started from, and changes only the
//! bytes it means to (see `bib::edit`).

use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;

use super::super::references::MAX_BIB_BYTES;
use super::super::{Change, Kasten};
use super::{changed_since, clean_fields, managed_text, person_only};
use crate::atomic::{create_atomic, write_atomic};
use crate::bib::{
    Adopted, BibFile, MANAGED, NewReference, ReferenceMatch, ReferenceSaved, copy, dups, edit,
    style,
};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::note::content_hash;
use crate::time::Instant;

/// The sentence for a reference that repeats one that is there.
fn duplicate(found: &ReferenceMatch) -> Error {
    Error::Invalid(match found.by {
        crate::bib::MatchKind::Key => format!(
            "A reference with the key “{}” is in {} already. Pick another key, or add it anyway if it is another work",
            found.key, found.file
        ),
        by => format!(
            "“{}” in {} has the same {} ({}). Add the reference anyway only if it is another work",
            found.key,
            found.file,
            by.label(),
            found.value
        ),
    })
}

impl Kasten {
    /// Runs an edit of the managed file in one commit. The edit gets the file's text and
    /// gives the new text; the file is as `base_hash` says or the edit is refused.
    /// Gives what the edit gave, the new hash and the commit.
    fn edit_managed<T>(
        &self,
        actor: &Actor,
        op: &str,
        base_hash: &str,
        now: Instant,
        message: String,
        edit: impl FnOnce(&Kasten, &str) -> Result<(String, T)>,
    ) -> Result<(T, String, Option<String>)> {
        let (done, commit) = self.apply_committing(actor, op, false, now.millis, &[], |vault| {
            let managed = managed_text(vault)?;
            if content_hash(&managed.text) != base_hash {
                return Err(changed_since());
            }
            let (text, value) = edit(self, &managed.text)?;
            let hash = content_hash(&text);
            if text == managed.text {
                return Ok(Change {
                    value: (value, hash),
                    paths: Vec::new(),
                    message,
                });
            }
            let file = vault.file_of(MANAGED, &[".bib"])?;
            if managed.exists {
                write_atomic(&file, text.as_bytes())?;
            } else {
                create_atomic(&file, text.as_bytes()).map_err(|err| match err.kind() {
                    ErrorKind::AlreadyExists => changed_since(),
                    _ => err.into(),
                })?;
            }
            Ok(Change {
                value: (value, hash),
                paths: vec![MANAGED.to_owned()],
                message,
            })
        })?;
        let (value, hash) = done;
        Ok((value, hash, commit))
    }

    /// Adds `reference` at the end of the managed file in house style, making the file
    /// if there is none. Refused when its key, DOI or arXiv identifier is in the
    /// bibliography already, unless `allow_duplicate` says it is another work.
    pub fn add_reference(
        &self,
        actor: &Actor,
        reference: &NewReference,
        base_hash: &str,
        now: Instant,
    ) -> Result<ReferenceSaved> {
        person_only(actor, "Adding a reference")?;
        self.add_reference_as(actor, reference, base_hash, now)
    }

    /// `add_reference` for any actor: an agent's goes through the modes
    /// (`parity_refusals`, which always holds it for review unless the
    /// session is autonomous) before it gets here.
    pub(in crate::engine) fn add_reference_as(
        &self,
        actor: &Actor,
        reference: &NewReference,
        base_hash: &str,
        now: Instant,
    ) -> Result<ReferenceSaved> {
        let kind = style::check_type(&reference.kind)?;
        let key = style::check_key(&reference.key)?;
        let fields = clean_fields(&reference.fields)?;
        let allow = reference.allow_duplicate;
        let message = format!("reference: add {key}");
        let (key, hash, commit) = self.edit_managed(
            actor,
            "add_reference",
            base_hash,
            now,
            message,
            |kasten, text| {
                if !allow {
                    let bibliography = kasten.bibliography()?;
                    let all: Vec<&BibFile> = std::iter::once(&bibliography.managed)
                        .chain(&bibliography.external)
                        .collect();
                    if let Some(found) = dups::matches(&all, &key, &fields).first() {
                        return Err(duplicate(found));
                    }
                }
                let entry = style::render_entry(&kind, &key, &fields, style::eol_of(text));
                Ok((edit::append(text, &entry), key.clone()))
            },
        )?;
        Ok(ReferenceSaved { key, hash, commit })
    }

    /// Sets the fields named in the entry `key` of the managed file (a value of `None`
    /// takes the field out): a value is changed where it stands, a new field is added
    /// as a line after the last one, and every other byte of the file stays.
    pub fn update_reference(
        &self,
        actor: &Actor,
        key: &str,
        fields: &BTreeMap<String, Option<String>>,
        base_hash: &str,
        now: Instant,
    ) -> Result<ReferenceSaved> {
        person_only(actor, "Editing a reference")?;
        let message = format!("reference: edit {key}");
        let (key, hash, commit) = self.edit_managed(
            actor,
            "update_reference",
            base_hash,
            now,
            message,
            |_, text| Ok((edit::set_fields(text, key, fields)?, key.to_owned())),
        )?;
        Ok(ReferenceSaved { key, hash, commit })
    }

    /// Replaces the text of the entry `key` with `text`, which must be one complete entry
    /// with the same key.
    pub fn replace_reference(
        &self,
        actor: &Actor,
        key: &str,
        text: &str,
        base_hash: &str,
        now: Instant,
    ) -> Result<ReferenceSaved> {
        person_only(actor, "Editing a reference")?;
        let message = format!("reference: edit {key}");
        let (key, hash, commit) = self.edit_managed(
            actor,
            "replace_reference",
            base_hash,
            now,
            message,
            |_, file| Ok((edit::replace_entry(file, key, text)?, key.to_owned())),
        )?;
        Ok(ReferenceSaved { key, hash, commit })
    }

    /// Copies entries of the external `.bib` file at `external` (those named by `keys`, or
    /// all) into the managed file, as written, with the macros they use. The external file
    /// is not changed; keys the managed file has are skipped.
    pub fn adopt_bib(
        &self,
        actor: &Actor,
        external: &str,
        keys: Option<&[String]>,
        base_hash: &str,
        now: Instant,
    ) -> Result<Adopted> {
        person_only(actor, "Making a managed copy")?;
        if external == MANAGED {
            return Err(Error::Invalid(format!(
                "{MANAGED} is the managed file already"
            )));
        }
        let message = format!("reference: copy from {external}");
        let ((added, skipped), hash, commit) = self.edit_managed(
            actor,
            "adopt_bib",
            base_hash,
            now,
            message,
            |kasten, text| {
                let source = read_external(kasten, external)?;
                let picked = copy::pick(&source, keys, text);
                let mut out = text.to_owned();
                let mut added = Vec::new();
                for (key, chunk) in picked.chunks {
                    out = edit::append(&out, &chunk);
                    added.push(key);
                }
                Ok((out, (added, picked.skipped)))
            },
        )?;
        Ok(Adopted {
            added,
            skipped,
            hash,
            commit,
        })
    }
}

/// An external `.bib` file's text: UTF-8 and not too big.
fn read_external(kasten: &Kasten, path: &str) -> Result<String> {
    let file = kasten.vault.file_of(path, &[".bib"])?;
    let bytes = fs::read(file).map_err(|err| match err.kind() {
        ErrorKind::NotFound => Error::NotFound(path.to_owned()),
        _ => Error::Io(err),
    })?;
    if bytes.len() as u64 > MAX_BIB_BYTES {
        return Err(Error::Invalid(format!(
            "{path} is over 4 MB, which is too big to read"
        )));
    }
    String::from_utf8(bytes).map_err(|_| Error::Invalid(format!("{path} is not UTF-8 text")))
}
