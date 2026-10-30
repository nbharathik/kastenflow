//! Which pages are smart pages: the page a frame or a call names has to be
//! one (`layout: smart`), and the frame is known by the page's id.

use kasten_core::frontmatter::{read_map, split};
use kasten_core::smart::SMART_LAYOUT;
use kasten_core::{Kasten, NoteFile};

/// The longest page id the scheme will look up.
const MAX_ID: usize = 64;

/// Whether `id` can be a page id in an address (and a file name in the error
/// log's folder): letters, digits, `-` and `_`, not the word the kit lives
/// under, and not a name Windows reads as a device (`con`, `nul`, `com1`).
pub fn plausible_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID
        && id != super::kit::SEGMENT
        && !is_device(id)
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A name Windows keeps for a device, whatever its case.
fn is_device(id: &str) -> bool {
    let lower = id.to_ascii_lowercase();
    let numbered = |prefix: &str| {
        lower
            .strip_prefix(prefix)
            .is_some_and(|n| matches!(n.as_bytes(), [b'0'..=b'9']))
    };
    matches!(lower.as_str(), "con" | "prn" | "aux" | "nul") || numbered("com") || numbered("lpt")
}

/// Whether the text of a page says `layout: smart`.
pub fn is_smart(text: &str) -> bool {
    read_map(split(text).prefix)
        .ok()
        .and_then(|keys| {
            keys.get("layout")
                .and_then(|v| v.as_str())
                .map(str::to_owned)
        })
        .is_some_and(|layout| layout == SMART_LAYOUT)
}

/// The smart page at `path`, read; an error in plain words when it is not
/// there, not a page, or not a smart page.
pub fn read(kasten: &Kasten, path: &str) -> Result<NoteFile, String> {
    let note = kasten.read(path).map_err(|err| err.to_string())?;
    if !is_smart(&note.text) {
        return Err(format!("“{}” is not a smart page.", note.meta.title));
    }
    let Some(id) = note.meta.id.as_deref() else {
        return Err(format!(
            "“{}” is not ready to run yet. Try again in a moment.",
            note.meta.title
        ));
    };
    // What is kept by id (a person's leave, the error log) would be shared.
    if kasten.id_is_shared(id).unwrap_or(false) {
        return Err(format!(
            "“{}” has the same id as another page, so it does not run. Make a copy of it with Duplicate and use the copy.",
            note.meta.title
        ));
    }
    Ok(note)
}

/// The path of the smart page whose id is `id`, or None. A id that two notes
/// carry names neither: one page's code is never shown under the other's name.
pub fn path_of(kasten: &Kasten, id: &str) -> Option<String> {
    if !plausible_id(id) || kasten.id_is_shared(id).unwrap_or(true) {
        return None;
    }
    let path = kasten.path_of_id(id).ok().flatten()?;
    let note = kasten.read(&path).ok()?;
    (note.meta.id.as_deref() == Some(id) && is_smart(&note.text)).then_some(path)
}

/// A short stamp of the page's files as they are now: names, sizes and the
/// time each was last changed. A person's leave for pictures from the web is
/// given for these files; once the stamp differs, the leave is over.
pub fn fingerprint(kasten: &Kasten, page: &str) -> String {
    let mut lines = Vec::new();
    if let Ok(listing) = kasten.smart_read(page) {
        for file in &listing.files {
            let stamp = std::fs::metadata(kasten.root().join(&listing.dir).join(&file.path))
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_nanos());
            lines.push(format!("{}:{}:{stamp}", file.path, file.size));
        }
    }
    lines.sort();
    kasten_core::smart::hash_bytes(lines.join("\n").as_bytes())
}
