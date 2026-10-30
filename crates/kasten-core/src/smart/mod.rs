//! The shared contract of smart pages: a page with `layout: smart` and a code
//! folder beside it (`<page>.smart/`) that runs in a sandboxed frame and
//! talks to the app through a small message bridge. This module holds the
//! types and the limits, how the folder is read (`files`), the words its
//! `index.html` shows for search (`index_text`), the checks every write makes
//! (`limits`) and the write ops themselves (`ops`). The engine wraps those in
//! changes (`Kasten::smart_*`); the folder travels with its page as a sidecar
//! (`companions`).

mod bridge;
mod files;
mod index_text;
mod limits;
mod manifest;
pub mod ops;

#[cfg(test)]
mod tests;

pub use bridge::{
    BridgeAnswer, BridgeCall, BridgeError, BridgeErrorCode, BridgeEvent, BridgeRequest, ErrorKind,
    ErrorLog, ErrorRecord, ErrorReport, SmartTheme,
};
pub use files::{
    SmartBytes, SmartFile, SmartListing, check_manifest, hash_bytes, manifest_text, parse_manifest,
};
pub(crate) use files::{dir_for, list_files, listing, read_file, read_manifest};
pub use index_text::visible_text;
pub use limits::{MAX_FILES, check_listed, check_path, is_text_file};
pub use manifest::{
    FilterOp, QuerySpec, SmartFilter, SmartManifest, SmartSize, SmartSort, SmartView, SortDir,
};

/// The folder beside a page `<name>.md` is `<name>.smart`.
pub const SMART_DIR_SUFFIX: &str = ".smart";
/// The manifest, at the top of the folder.
pub const MANIFEST_FILE: &str = "smart.yaml";
/// The page's layout, at the top of the folder.
pub const INDEX_FILE: &str = "index.html";
pub const DATA_DIR: &str = "data";
pub const ASSETS_DIR: &str = "assets";
/// The `layout:` value of a smart page.
pub const SMART_LAYOUT: &str = "smart";
/// The manifest format this version reads and writes.
pub const MANIFEST_VERSION: u32 = 1;
/// The kit a manifest names when it names none.
pub const DEFAULT_KIT: &str = "1";

/// The most one file of the folder may hold.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// The most the whole folder may hold.
pub const MAX_TOTAL_BYTES: u64 = 10 * 1024 * 1024;
/// File endings a folder may hold (lower case): code, data and pictures. No
/// `.wasm`, no program of any kind.
pub const ALLOWED_EXTENSIONS: [&str; 9] = [
    "html", "js", "css", "json", "svg", "png", "webp", "jpg", "txt",
];

/// Calls the bridge answers per second, per page.
pub const MAX_CALLS_PER_SECOND: u32 = 50;
/// The most one bridge answer may hold.
pub const MAX_ANSWER_BYTES: usize = 2 * 1024 * 1024;
/// How long the app waits after a vault change before re-running watches.
pub const WATCH_DEBOUNCE_MS: u64 = 300;
/// Errors kept per page.
pub const MAX_ERROR_RECORDS: usize = 50;
/// The tallest a smart block inside another page may be.
pub const MAX_BLOCK_HEIGHT_PX: u32 = 1200;
/// Smart frames live at once inside one page.
pub const MAX_LIVE_FRAMES: usize = 4;
/// The most notes one query may ask for.
pub const MAX_QUERY_LIMIT: u32 = 10_000;

/// What a smart frame may load: its own files only, no network. `base-uri` and
/// `form-action` do not fall back to `default-src`, so they are named: a
/// `<base>` cannot re-point the page's relative addresses and no form can post
/// anywhere.
pub const CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/// The policy for a page, with web pictures when the person allowed them.
pub fn csp(web_images: bool) -> String {
    if web_images {
        CSP.replace(
            "img-src 'self' data: blob:",
            "img-src 'self' data: blob: https:",
        )
    } else {
        CSP.to_string()
    }
}

/// Whether `rel` (a path inside the folder, with `/`) is one the folder may
/// hold and the protocol may serve: relative, no `..`, no empty parts, no
/// hidden part (one that starts with a dot), an allowed ending, or the
/// manifest at the top.
pub fn is_allowed_path(rel: &str) -> bool {
    if rel == MANIFEST_FILE {
        return true;
    }
    if rel.is_empty() || rel.contains(['\\', ':', '\0']) {
        return false;
    }
    if rel
        .split('/')
        .any(|part| part.is_empty() || part.starts_with('.'))
    {
        return false;
    }
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => {
            ALLOWED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
        }
        _ => false,
    }
}

/// The folder beside a page: `a/b.md` gives `a/b.smart`. None for a path that
/// is not a Markdown page.
pub fn sidecar_dir(page_path: &str) -> Option<String> {
    let stem = page_path.strip_suffix(".md")?;
    let name = stem.rsplit('/').next().unwrap_or(stem);
    if name.is_empty() {
        return None;
    }
    Some(format!("{stem}{SMART_DIR_SUFFIX}"))
}
