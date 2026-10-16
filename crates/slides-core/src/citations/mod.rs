//! Citations: reading a bibliography, looking up the works a citation names,
//! writing them in the formats a slide asks for, and numbering them across a deck.
//!
//! A bibliography is BibTeX text that the host supplies (Kasten reads the `.bib`
//! files of the vault; the `slides` command reads `refs.bib` beside the deck),
//! read here into [`Refs`]. A citation element holds keys and a format; [`lines`]
//! writes them, given the [`Refs`] that can say who wrote each work and the
//! [`Numbering`] that says which number each work has in the deck. Drawing never
//! fails on a key it cannot find: the key is shown, marked, and lint reports it.

mod bibtex;
mod format;
mod latex;
mod links;
mod names;
mod numbering;
mod refs;
mod summary;
mod venues;

#[cfg(test)]
mod tests;

pub use format::{Piece, full_label, lines, pieces, short_label};
pub use names::{Authors, Person};
pub use numbering::Numbering;
pub use refs::{Entry, Refs};
pub use summary::Reference;
pub use venues::short_venue;

/// What a citation is written from besides its own keys.
#[derive(Clone, Copy, Debug, Default)]
pub struct Cites<'a> {
    /// The bibliography. Without one, keys are written as they are, never marked.
    pub refs: Option<&'a Refs>,
    /// How the deck numbers the works. Without it a citation numbers its own keys from 1.
    pub numbering: Option<&'a Numbering>,
}
