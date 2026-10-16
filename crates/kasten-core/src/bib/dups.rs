//! Entries that are one work: the same key, the same DOI, the same arXiv
//! identifier, within one file or across the files of the vault.

use std::collections::{BTreeMap, BTreeSet};

use slides_bib::{arxiv_key, doi_key};

use super::model::{BibEntry, BibFile, Duplicate, EntryRef, MatchKind, ReferenceMatch};

/// The identifiers an entry's fields give: its DOI and arXiv number, normalised.
pub fn identifiers(fields: &BTreeMap<String, String>) -> (Option<String>, Option<String>) {
    (doi_key(fields), arxiv_key(fields))
}

/// Every group of entries that look like one work, among `files` (the managed one
/// first): by key, then by DOI, then by arXiv identifier, each sorted by what they share.
pub fn duplicates(files: &[&BibFile]) -> Vec<Duplicate> {
    let mut by_key: BTreeMap<String, Vec<EntryRef>> = BTreeMap::new();
    let mut by_doi: BTreeMap<String, Vec<EntryRef>> = BTreeMap::new();
    let mut by_arxiv: BTreeMap<String, Vec<EntryRef>> = BTreeMap::new();
    for file in files {
        for entry in &file.entries {
            let at = EntryRef {
                file: file.path.clone(),
                key: entry.key.clone(),
            };
            by_key
                .entry(entry.key.clone())
                .or_default()
                .push(at.clone());
            let (doi, arxiv) = identifiers(&entry.fields);
            if let Some(doi) = doi {
                by_doi.entry(doi).or_default().push(at.clone());
            }
            if let Some(arxiv) = arxiv {
                by_arxiv.entry(arxiv).or_default().push(at);
            }
        }
    }
    let mut out = Vec::new();
    for (by, groups) in [
        (MatchKind::Key, by_key),
        (MatchKind::Doi, by_doi),
        (MatchKind::Arxiv, by_arxiv),
    ] {
        for (value, entries) in groups {
            let keys: BTreeSet<&str> = entries.iter().map(|e| e.key.as_str()).collect();
            // The same key twice is a key duplicate; its DOI is not news.
            if entries.len() < 2 || (by != MatchKind::Key && keys.len() == 1) {
                continue;
            }
            out.push(Duplicate { by, value, entries });
        }
    }
    out
}

/// The entries of `files` that a reference with this key and these fields would repeat.
pub fn matches(
    files: &[&BibFile],
    key: &str,
    fields: &BTreeMap<String, String>,
) -> Vec<ReferenceMatch> {
    let (doi, arxiv) = identifiers(fields);
    let mut out = Vec::new();
    for file in files {
        for entry in &file.entries {
            let found = |by, value: &str, entry: &BibEntry| ReferenceMatch {
                by,
                value: value.to_owned(),
                file: file.path.clone(),
                key: entry.key.clone(),
            };
            // BibTeX takes keys that differ only in case for one key.
            if entry.key.eq_ignore_ascii_case(key) {
                out.push(found(MatchKind::Key, key, entry));
            }
            let (entry_doi, entry_arxiv) = identifiers(&entry.fields);
            if let (Some(want), Some(have)) = (&doi, &entry_doi)
                && want == have
            {
                out.push(found(MatchKind::Doi, want, entry));
            }
            if let (Some(want), Some(have)) = (&arxiv, &entry_arxiv)
                && want == have
            {
                out.push(found(MatchKind::Arxiv, want, entry));
            }
        }
    }
    out
}
