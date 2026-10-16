//! The tolerant BibTeX reader a bibliography is read with. It lives in the
//! `slides-bib` crate, where the vault's editing of a `.bib` file shares its
//! span scanner; this re-exports what citations use.

#[cfg(test)]
pub use slides_bib::{MOST_BYTES, MOST_ENTRIES, MOST_VALUE};
pub use slides_bib::{Raw, read};
