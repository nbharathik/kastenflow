//! Slide decks (`.deck` files), made and changed by the Slides editor, the
//! `slides` command and agents. A deck is JSON in one fixed form, written
//! by the editor's own engine; core keeps it as text and looks only at its
//! envelope (format, version, title, slide count) and at the image files it
//! names, and at the keys its citations name (`cites`). Nothing here rewrites
//! a deck's text on a person's behalf, and a save never replaces a
//! file it did not read: a stale save goes to a copy beside it.

mod brand;
mod changes;
pub mod cites;
mod files;
mod generator_library;
mod head;
mod library;
mod structure;
mod templates;
mod uses;

pub use brand::{
    BRAND_EXT, BRAND_FOLDER, BRAND_FORMAT, BrandFile, BrandSaved, MAX_BRAND_BYTES, brand_head,
    brand_path, effective_brand, read_brand, save_brand,
};
pub use changes::{REPLACES_DECK, SlideChanges, SlideRef, slide_changes};
pub use files::{
    DeckFile, DeckSaved, check_new_deck, create_deck, plan_deck, read_deck, title_at, write_deck,
};
pub use generator_library::{
    GENERATOR_EXT, GENERATOR_FOLDER, GENERATOR_FORMAT, GeneratorFile, GeneratorHead, GeneratorInfo,
    GeneratorSaved, MAX_GENERATOR_BYTES, generator_head, generator_path_of_id, list_generators,
    read_generator, save_generator,
};
pub use head::{FORMAT, Head, MAX_BYTES, head_of, images_of};
pub use library::{
    LAYOUT_EXT, LAYOUT_FOLDER, LAYOUT_FORMAT, LayoutFile, LayoutHead, LayoutInfo, LayoutSaved,
    layout_head, list_layouts, path_of_id, read_layout, save_layout,
};
pub use structure::{check_structure, structure_problem};
pub use templates::{TEMPLATE_FOLDER, create_template, is_template};
pub use uses::{DeckImages, images_by_slide};
