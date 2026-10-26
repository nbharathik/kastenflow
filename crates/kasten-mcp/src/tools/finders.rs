//! Naming things the notes lookups do not reach: a saved search and a note in
//! the trash.

use kasten_core::{Error, Kasten, Result};

/// A saved search's path from its name or its path.
pub(crate) fn collection_path(k: &Kasten, reference: &str) -> Result<String> {
    let wanted = reference.trim();
    if kasten_core::collections::is_path(wanted) {
        return Ok(wanted.to_owned());
    }
    let found: Vec<String> = k
        .collections()?
        .into_iter()
        .filter(|c| c.name.eq_ignore_ascii_case(wanted) || c.slug.eq_ignore_ascii_case(wanted))
        .map(|c| c.path)
        .collect();
    match found.as_slice() {
        [one] => Ok(one.clone()),
        [] => Err(Error::Invalid(format!(
            "No saved search called “{wanted}”; list_collections names them"
        ))),
        many => Err(Error::Invalid(format!(
            "Several saved searches are called “{wanted}”; name one by path: {}",
            many.join(", ")
        ))),
    }
}

/// Where a note in the trash is now, from that path, the path it had, or its title.
pub(crate) fn trashed_path(k: &Kasten, reference: &str) -> Result<String> {
    let wanted = reference.trim();
    let found: Vec<String> = k
        .list_trash()?
        .into_iter()
        .filter(|t| t.original.ends_with(".md"))
        .filter(|t| {
            t.trashed == wanted || t.original == wanted || t.title.eq_ignore_ascii_case(wanted)
        })
        .map(|t| t.trashed)
        .collect();
    match found.as_slice() {
        [one] => Ok(one.clone()),
        [] => Err(Error::Invalid(format!(
            "Nothing called “{wanted}” is in the trash; list_trash names what is there"
        ))),
        many => Err(Error::Invalid(format!(
            "Several notes in the trash match “{wanted}”; name one by its trash path: {}",
            many.join(", ")
        ))),
    }
}
