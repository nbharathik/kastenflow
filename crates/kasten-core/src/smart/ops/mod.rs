//! The write ops of a smart page's folder, on the vault alone: a file written,
//! a file moved to the trash, the manifest set. The engine wraps each in a
//! change (commit, history, undo, agent rules); every limit and every path
//! check is here, so no caller can write without them.

mod create;
mod delete;
mod patch;
mod restore;
mod write;

pub use create::check_new;
pub(crate) use create::write_new;
pub use delete::{Deleted, TrashedFile, check_delete, delete_file, restore_file, trashed_files};
pub use restore::{Restored, restore_folder};
pub use write::{Prepared, Written, check_write, set_manifest, write_file};
