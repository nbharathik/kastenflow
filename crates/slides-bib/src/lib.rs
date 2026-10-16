//! BibTeX for KastenFlow Slides and the vault's bibliography: a tolerant reader
//! (`read`), a span scanner that says where every entry, field and value is
//! written (`scan`) and the identifiers that tell two entries are one work
//! (`doi_key`, `arxiv_key`).
//!
//! The scanner's spans follow one another without a gap, so a host can change
//! one value and write the rest back as it was: comments, `@string` macros,
//! fields it does not know and formatting all stay. The crate has no
//! dependencies, touches no file and builds for WebAssembly.

mod ids;
mod read;
mod scan;

pub use ids::{arxiv_key, doi_key, normalise_arxiv, normalise_doi};
pub use read::{MOST_VALUE, Raw, expand, fields_of, macros, read, read_spans};
pub use scan::{FieldSpan, Kind, MOST_BYTES, MOST_ENTRIES, Piece, PieceKind, Span, scan};

#[cfg(test)]
mod tests;
