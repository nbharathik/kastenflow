//! Project bundles: a project exported to a folder outside the vault with what it
//! uses, a manifest that lists every file with its hash, and an import that settles
//! what the vault has already (the folder, ids, files, tag schemas, keys) as one commit
//! that undo takes back; a bundle that was altered, or names a path it should not, is refused.

mod export;
mod import;
mod project;
mod refusals;
mod smart;
