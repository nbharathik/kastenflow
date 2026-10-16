//! The works a bundle cites, `references.bib`, coming into the vault's managed
//! bibliography: a work the vault has as it is, is not added again; a work whose
//! key the vault has for another work comes in under a new key, and the project's
//! citations follow.

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;

use super::places::conflict;
use crate::bib::{BibEntry, MANAGED, copy, edit};
use crate::engine::Kasten;
use crate::error::{Error, Result};
use crate::import::{ImportConflict, ImportConflictKind};
use crate::note::content_hash;

/// Works to add to the managed bibliography, as text, and the hash it must still have.
#[derive(Debug, Clone)]
pub(crate) struct Bib {
    pub base_hash: String,
    pub chunks: Vec<String>,
}

/// What the bundle's works come to: the chunks to add, the keys that had to change, and
/// what that settled.
pub(super) struct Works {
    pub bib: Option<Bib>,
    pub keys: Vec<(String, String)>,
    pub conflicts: Vec<ImportConflict>,
}

pub(super) fn plan(kasten: &Kasten, text: &str) -> Result<Works> {
    let theirs = slides_bib::read(text);
    let mut works = Works {
        bib: None,
        keys: Vec::new(),
        conflicts: Vec::new(),
    };
    if theirs.is_empty() {
        return Ok(works);
    }
    let bibliography = kasten.bibliography()?;
    if let Some(why) = &bibliography.managed.problem {
        return Err(Error::Invalid(format!(
            "{MANAGED} cannot be edited ({why}); fix that before importing a bundle that cites works"
        )));
    }
    let ours: Vec<&BibEntry> = std::iter::once(&bibliography.managed)
        .chain(&bibliography.external)
        .flat_map(|file| file.entries.iter())
        .collect();
    let mut taken: HashSet<String> = ours.iter().map(|e| e.key.to_lowercase()).collect();
    taken.extend(theirs.iter().map(|e| e.key.to_lowercase()));
    let mut renamed_text = text.to_owned();
    let mut add: Vec<String> = Vec::new();
    for entry in &theirs {
        let Some(have) = ours.iter().find(|e| e.key.eq_ignore_ascii_case(&entry.key)) else {
            add.push(entry.key.clone());
            continue;
        };
        if have.kind == entry.kind && have.fields == entry.fields {
            continue;
        }
        let new = (2..)
            .map(|n| format!("{}-{n}", entry.key))
            .find(|k| !taken.contains(&k.to_lowercase()))
            .unwrap_or_else(|| entry.key.clone());
        taken.insert(new.to_lowercase());
        renamed_text = edit::rename_key(&renamed_text, &entry.key, &new)?;
        works.conflicts.push(conflict(
            ImportConflictKind::Key,
            entry.key.clone(),
            format!(
                "Your bibliography has another work under that key, so the bundle's was added as {new} and the project cites it by that"
            ),
        ));
        add.push(new.clone());
        works.keys.push((entry.key.clone(), new));
    }
    let managed = match fs::read_to_string(kasten.vault().file_of(MANAGED, &[".bib"])?) {
        Ok(text) => text,
        Err(err) if err.kind() == ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err.into()),
    };
    let chunks: Vec<String> = copy::pick(&renamed_text, Some(&add), &managed)
        .chunks
        .into_iter()
        .map(|(_, chunk)| chunk)
        .collect();
    works.bib = (!chunks.is_empty()).then(|| Bib {
        base_hash: content_hash(&managed),
        chunks,
    });
    Ok(works)
}
