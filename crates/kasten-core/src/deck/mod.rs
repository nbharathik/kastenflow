//! Slide decks (`.deck` files), made and changed by the Slides editor, the
//! `slides` command and agents. A deck is JSON in one fixed form, written
//! by the editor's own engine; core keeps it as text and looks only at its
//! envelope (format, version, title, slide count) and at the image files it
//! names. Nothing here rewrites a deck's text, and a save never replaces a
//! file it did not read: a stale save goes to a copy beside it.

mod changes;
mod files;
mod head;
mod structure;
mod templates;
mod uses;

pub use changes::{REPLACES_DECK, SlideChanges, SlideRef, slide_changes};
pub use files::{
    DeckFile, DeckSaved, check_new_deck, create_deck, read_deck, title_at, write_deck,
};
pub use head::{FORMAT, Head, MAX_BYTES, head_of, images_of};
pub use structure::{check_structure, structure_problem};
pub use templates::{TEMPLATE_FOLDER, create_template, is_template};
pub use uses::{DeckImages, images_by_slide};
