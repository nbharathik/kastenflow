//! The `diagrams` scheme: serves the installed diagram editor's files to the
//! frame that shows it, and nothing else. A request names a file inside the
//! installed folder or gets a plain refusal: the path is decoded and checked
//! (no `..`, no backslash, no colon, no link out of the folder), a folder is
//! never listed, and nothing is served while the editor is not installed.
//! Every answer says what it is (`nosniff`) and keeps the page local: it may
//! talk to itself and to `blob:` and `data:` addresses and load nothing from
//! the network, so a diagram cannot make the editor fetch an image or a
//! script from anywhere.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::http::{Method, Response, StatusCode, header};

use crate::commands::assets::percent_decode;

/// The name of the scheme. In a frame's address it is `diagrams://localhost/`,
/// and on Windows, where a web view only knows http and https,
/// `http://diagrams.localhost/`.
pub const SCHEME: &str = "diagrams";

/// What the editor's page may do. It is a third-party program, pinned by its
/// hash, running with no way to Kasten's commands and none to the network:
/// scripts and styles are its own, images and fonts its own or inline.
const POLICY: &str = "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self' blob:; media-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

/// The media type of a file, by its extension.
fn media_type(file: &Path) -> &'static str {
    let ext = file
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" | "cur" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "eot" => "application/vnd.ms-fontobject",
        "txt" | "md" | "csv" => "text/plain; charset=utf-8",
        "xml" | "xsl" => "application/xml; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// A refusal in plain text, with the same safe headers as everything else.
fn plain(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    answer(
        status,
        "text/plain; charset=utf-8",
        text.as_bytes().to_vec(),
    )
}

fn answer(status: StatusCode, kind: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, kind)
        .header(header::CONTENT_SECURITY_POLICY, POLICY)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// The file a request names, inside `dir`, or the status to answer with.
fn resolve(dir: &Path, request_path: &str) -> Result<PathBuf, StatusCode> {
    let decoded = percent_decode(request_path).ok_or(StatusCode::BAD_REQUEST)?;
    if decoded.contains(['\0', '\\', ':']) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let rel = decoded.strip_prefix('/').unwrap_or(&decoded);
    // The editor's folder is never listed.
    if rel.is_empty() || rel.ends_with('/') {
        return Err(StatusCode::NOT_FOUND);
    }
    let mut path = dir.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(StatusCode::BAD_REQUEST);
        }
        path.push(part);
    }
    // After links are followed, the file is still inside the folder.
    let base = dir.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let file = path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    if !file.starts_with(&base) || !file.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(file)
}

/// The answer to a request for `request_path` (the address's path, still
/// percent-encoded) while the installed editor is at `editor`, or None when
/// it is not installed.
pub fn respond(editor: Option<&Path>, method: &Method, request_path: &str) -> Response<Vec<u8>> {
    let head = *method == Method::HEAD;
    if !head && *method != Method::GET {
        return plain(
            StatusCode::METHOD_NOT_ALLOWED,
            "Only GET and HEAD are served",
        );
    }
    let Some(dir) = editor else {
        return plain(StatusCode::NOT_FOUND, "The diagram editor is not installed");
    };
    let file = match resolve(dir, request_path) {
        Ok(file) => file,
        Err(status) => return plain(status, "Not found"),
    };
    let Ok(bytes) = fs::read(&file) else {
        return plain(StatusCode::NOT_FOUND, "Not found");
    };
    let body = if head { Vec::new() } else { bytes };
    answer(StatusCode::OK, media_type(&file), body)
}
