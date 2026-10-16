//! Tests for the vault's bibliography: the managed .bib file, external .bib
//! files that are read only, duplicates, adding and updating references byte for
//! byte, Pandoc citations in pages, and renaming a citation key across the .bib
//! file, pages, pictures and decks in one commit.

mod adopt;
mod cites;
mod edits;
mod rename;
pub mod support;
mod verify;
