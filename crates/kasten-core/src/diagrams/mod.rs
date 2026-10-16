//! Diagrams: `name.drawio` is the source (uncompressed `mxfile` XML, written
//! by the diagram editor, readable in a diff and by agents) and
//! `name.drawio.svg` is its picture, an ordinary SVG that carries the hash of
//! the source it was drawn from in a trailing comment. A page, a slide or a
//! board shows the picture, so nothing needs the editor to be viewed; a
//! missing or stale picture is drawn again the next time the editor is at
//! hand. The two files are written together or not at all, and they move,
//! rename, duplicate, trash and come back as one. Core keeps the source as
//! the editor wrote it: it checks that it is a well-formed diagram, never
//! rewrites it, and never replaces a file it did not read.

mod cells;
pub mod describe;
pub mod draw;
mod files;
mod format;
mod import;
mod info;
pub mod layout;
pub mod lint;
pub mod model;
mod moved;
mod names;
mod pairs;
pub mod presets;
mod relink;
pub mod sanitize;
pub mod shapes;
pub mod spec;
pub mod steps;
mod xml;

#[cfg(test)]
mod xml_tests;

pub use cells::{cell_ids, removed_cells};
pub use files::{
    DiagramFile, DiagramSaved, Preview, check_new_diagram, create_diagram, draft_for, plan_diagram,
    read_diagram, read_preview, write_diagram, write_draft, write_edited, write_preview,
};
pub use format::{
    DRAFT_MARK, EXT, MAX_BYTES, SIDECAR_EXT, blank_xml, check_svg, check_xml, sidecar_of, stamp_of,
    stamped,
};
pub use import::import_diagram;
pub use info::{DiagramInfo, DiagramMoved, list};
pub use moved::moved_cells;
pub use names::title_of;
pub(crate) use names::{free_pair, stem_of_path};
pub use pairs::{
    Moves, duplicate_diagram, files_of, has_unique_name, move_diagram, rename_diagram,
};
pub(crate) use relink::relink_pages;
