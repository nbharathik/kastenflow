//! Reading and editing BibTeX for the vault's bibliography, changing only the
//! bytes of the values edited. The vault has one managed `.bib` file
//! (`sources/references.bib`) that KastenFlow edits; every other `.bib` file is
//! read only. The scanner that says where each entry and field is written is the
//! `slides-bib` crate's, shared with the Slides reader.

pub mod copy;
pub mod dups;
pub mod edit;
pub mod key;
mod layout;
mod model;
pub mod style;

pub use model::{
    Adopted, BibEntry, BibFile, Bibliography, Duplicate, EntryRef, KeyHints, MANAGED, MatchKind,
    NewReference, ReferenceMatch, ReferenceSaved, SkippedKey,
};
