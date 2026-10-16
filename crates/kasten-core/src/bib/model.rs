//! The shapes of the vault's bibliography as the shells see them (serde, camelCase).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The `.bib` file KastenFlow edits. Every other `.bib` file is read only.
pub const MANAGED: &str = "sources/references.bib";

/// One entry of a `.bib` file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibEntry {
    pub key: String,
    /// The entry type in lower case: `article`, `inproceedings`...
    #[serde(rename = "type")]
    pub kind: String,
    /// Fields by lower-case name, as written: outer braces or quotes off, `@string`
    /// macros put in, LaTeX left in.
    pub fields: BTreeMap<String, String>,
}

/// One `.bib` file of the vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibFile {
    pub path: String,
    /// True for `sources/references.bib` alone.
    pub managed: bool,
    /// False for a managed file that has not been made yet.
    pub exists: bool,
    /// Hash of the file's text: what an edit names as its base.
    pub hash: String,
    pub bytes: u64,
    /// Why the file is not read or not edited (too big, not UTF-8 text), when it is not.
    pub problem: Option<String>,
    pub entries: Vec<BibEntry>,
}

/// What makes two entries one work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchKind {
    Key,
    Doi,
    Arxiv,
}

impl MatchKind {
    pub fn label(self) -> &'static str {
        match self {
            MatchKind::Key => "key",
            MatchKind::Doi => "DOI",
            MatchKind::Arxiv => "arXiv identifier",
        }
    }
}

/// Where an entry is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryRef {
    pub file: String,
    pub key: String,
}

/// Entries that look like one work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Duplicate {
    pub by: MatchKind,
    /// The key, DOI or arXiv identifier they share.
    pub value: String,
    pub entries: Vec<EntryRef>,
}

/// The managed file, the external files and the duplicates among them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bibliography {
    pub managed: BibFile,
    pub external: Vec<BibFile>,
    pub duplicates: Vec<Duplicate>,
}

/// A reference to add to the managed file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReference {
    #[serde(rename = "type")]
    pub kind: String,
    pub key: String,
    /// Lower-case names; empty values are left out.
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    /// Add it although the key, DOI or arXiv identifier is in the bibliography already.
    #[serde(default)]
    pub allow_duplicate: bool,
}

/// An entry in the bibliography that a new reference would repeat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceMatch {
    pub by: MatchKind,
    pub value: String,
    pub file: String,
    pub key: String,
}

/// What an edit of the managed file did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSaved {
    pub key: String,
    /// The managed file's hash now.
    pub hash: String,
    /// The one commit, for undoing it; none in a vault without history.
    pub commit: Option<String>,
}

/// A key that was not copied, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedKey {
    pub key: String,
    pub why: String,
}

/// What making a managed copy of an external file did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adopted {
    pub added: Vec<String>,
    pub skipped: Vec<SkippedKey>,
    pub hash: String,
    pub commit: Option<String>,
}

/// What a generated key is made from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyHints {
    /// Authors as BibTeX writes them or as people say them.
    pub author: Option<String>,
    pub year: Option<String>,
    pub title: Option<String>,
}
