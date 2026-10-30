//! The `smart` scheme: serves one smart page's folder, and the kit, to the
//! frame that shows the page, and nothing else.
//!
//! An address is `smart://localhost/<frame>/<page id>/<file>` (on Windows,
//! where a web view knows only http and https,
//! `http://smart.localhost/<frame>/<page id>/<file>`) or
//! `…/<frame>/kit/<version>/<file>`. `<frame>` is a secret the window made for
//! one frame when it put the frame on screen (256 random bits, kept in the
//! `Runtime` until the frame goes away); it is in the path, so every relative
//! address in the page keeps it. A request whose secret is not a live frame's,
//! or not the frame of the page it names, is refused: a page's code, which
//! sees only its own address, can neither load another page's files nor send
//! its frame to another page. The path is cut at its slashes first and each
//! part is decoded and checked on its own, so an encoded slash, dot, colon or
//! backslash can never turn one part into two or into a way out. A part may
//! not be empty, hidden, `.` or `..`; a folder is never listed; the page must
//! be a smart page of the open vault; and its file is read through the core
//! (`smart_file`), which refuses links, odd names, other endings and large
//! files. Every answer says what it is (`nosniff`) and carries the policy
//! that keeps the page local: its own files, no network (and, when its owner
//! allowed it, pictures from the web).

use kasten_core::Kasten;
use kasten_core::smart::{csp, is_allowed_path};
use tauri::Manager;
use tauri::http::{Method, Request, Response, StatusCode, header};

use super::runtime::{Busy, Runtime, is_nonce};
use super::{kit, page};
use crate::commands::assets::percent_decode;

/// The name of the scheme.
pub const SCHEME: &str = "smart";

/// What the scheme needs to answer: the open vault, the page a live frame's
/// secret belongs to, and whether a page may show pictures from the web.
pub struct Serving<'a> {
    pub kasten: Option<&'a Kasten>,
    /// The id of the page whose frame has this secret, if a frame has it now.
    pub frame_page: &'a dyn Fn(&str) -> Option<String>,
    pub web_images: &'a dyn Fn(&str) -> bool,
}

/// What is found for a request: the file's name, its bytes, and the page it
/// belongs to (the kit belongs to none).
struct Found {
    name: String,
    bytes: Vec<u8>,
    page_id: Option<String>,
}

/// The media type of a file, by its ending.
fn media_type(name: &str) -> &'static str {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "txt" | "yaml" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn answer(status: StatusCode, kind: &str, policy: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, kind)
        .header(header::CONTENT_SECURITY_POLICY, policy)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// A refusal in plain text, with the same safe headers as everything else.
fn plain(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    answer(
        status,
        "text/plain; charset=utf-8",
        &csp(false),
        text.as_bytes().to_vec(),
    )
}

/// The address the frame's own page was reached at, `scheme://host`, when it
/// is one of the two this scheme is reached at.
fn base_of(request: &Request<Vec<u8>>) -> Option<String> {
    let uri = request.uri();
    let (scheme, host) = (uri.scheme_str()?, uri.host()?);
    let authority = uri.authority()?.as_str();
    let ours = matches!(
        (scheme, host),
        ("smart", "localhost") | ("http", "smart.localhost")
    );
    // No port, name or password: the host alone.
    (ours && authority == host).then(|| format!("{scheme}://{host}"))
}

/// The parts of a request's path, each decoded and checked.
fn parts_of(path: &str) -> Result<Vec<String>, StatusCode> {
    let rest = path.strip_prefix('/').ok_or(StatusCode::BAD_REQUEST)?;
    let mut parts = Vec::new();
    for raw in rest.split('/') {
        let part = percent_decode(raw).ok_or(StatusCode::BAD_REQUEST)?;
        if part.is_empty() {
            // A folder (a trailing slash), or `//`.
            return Err(StatusCode::NOT_FOUND);
        }
        if part.starts_with('.')
            || part.contains(['/', '\\', ':'])
            || part.chars().any(char::is_control)
        {
            return Err(StatusCode::BAD_REQUEST);
        }
        parts.push(part);
    }
    Ok(parts)
}

fn kit_file(parts: &[String]) -> Result<Found, StatusCode> {
    let (version, rel) = match parts {
        [_, version, rel @ ..] if !rel.is_empty() => (version, rel.join("/")),
        _ => return Err(StatusCode::NOT_FOUND),
    };
    let text = kit::file(version, &rel).ok_or(StatusCode::NOT_FOUND)?;
    Ok(Found {
        name: rel,
        bytes: text.as_bytes().to_vec(),
        page_id: None,
    })
}

/// A file of the page `owner`, the one the frame is for: the address must name
/// that page and no other.
fn page_file(kasten: Option<&Kasten>, parts: &[String], owner: &str) -> Result<Found, StatusCode> {
    let [id, rel @ ..] = parts else {
        return Err(StatusCode::NOT_FOUND);
    };
    if rel.is_empty() || !page::plausible_id(id) || id != owner {
        return Err(StatusCode::NOT_FOUND);
    }
    let rel = rel.join("/");
    if !is_allowed_path(&rel) {
        return Err(StatusCode::NOT_FOUND);
    }
    let kasten = kasten.ok_or(StatusCode::NOT_FOUND)?;
    let path = page::path_of(kasten, id).ok_or(StatusCode::NOT_FOUND)?;
    let file = kasten
        .smart_file(&path, &rel)
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Found {
        name: rel,
        bytes: file.bytes,
        page_id: Some(id.clone()),
    })
}

/// A page's own references to the kit, `smart://kit/1/kit.js`, name the kit
/// at the address the frame was reached at, with the frame's secret in it.
fn with_kit_at(name: &str, bytes: Vec<u8>, base: &str, frame: &str) -> Vec<u8> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("html" | "css")) {
        return bytes;
    }
    match String::from_utf8(bytes) {
        Ok(text) => text
            .replace("smart://kit/", &format!("{base}/{frame}/{}/", kit::SEGMENT))
            .into_bytes(),
        Err(err) => err.into_bytes(),
    }
}

/// The id of the page whose frame has the secret `nonce`, asked for at each
/// request. With smart pages off for the page (its project's choice, else the
/// vault's plugin) nothing is served, whatever frames were left open: the
/// choice is read from the vault every time.
pub fn live_frame(
    kasten: Option<&Kasten>,
    runtime: Option<&Runtime>,
    nonce: &str,
) -> Option<String> {
    let id = runtime?.frame_page(nonce)?;
    let kasten = kasten?;
    let path = page::path_of(kasten, &id)?;
    kasten.smart_enabled_for_page(&path).then_some(id)
}

/// The scheme's handler for the app: answers on a thread of its own, from the
/// open vault (none is served while no vault is open) and the app's data
/// folder, where a person's leave for pictures from the web is kept.
pub fn handler<R: tauri::Runtime>(
    context: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let kasten = app
            .try_state::<crate::open_vault::OpenVault>()
            .and_then(|vault| vault.kasten());
        let dir = app.path().app_local_data_dir().ok();
        // The leave is for the files the person saw: it ends when they change.
        let web_images = |id: &str| {
            super::settings::web_images(dir.as_deref(), id, &|| {
                kasten
                    .as_deref()
                    .and_then(|k| page::path_of(k, id).map(|path| page::fingerprint(k, &path)))
                    .unwrap_or_default()
            })
        };
        let frame_page = |nonce: &str| {
            live_frame(
                kasten.as_deref(),
                app.try_state::<Runtime>().as_deref(),
                nonce,
            )
        };
        // A frame has only so many requests open at once.
        let runtime = app.try_state::<Runtime>();
        let secret = request
            .uri()
            .path()
            .trim_start_matches('/')
            .split('/')
            .next()
            .unwrap_or_default();
        let admission = match runtime.as_deref().map(|rt| rt.admit(secret)) {
            Some(Err(Busy)) => {
                responder.respond(plain(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Too many files at once; try again in a moment",
                ));
                return;
            }
            Some(Ok(guard)) => guard,
            None => None,
        };
        let response = respond(
            &Serving {
                kasten: kasten.as_deref(),
                frame_page: &frame_page,
                web_images: &web_images,
            },
            &request,
        );
        drop(admission);
        responder.respond(response);
    });
}

/// The answer to a request.
pub fn respond(serving: &Serving, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let head = *request.method() == Method::HEAD;
    if !head && *request.method() != Method::GET {
        return plain(
            StatusCode::METHOD_NOT_ALLOWED,
            "Only GET and HEAD are served",
        );
    }
    let Some(base) = base_of(request) else {
        return plain(StatusCode::NOT_FOUND, "Not found");
    };
    let parts = match parts_of(request.uri().path()) {
        Ok(parts) => parts,
        Err(status) => return plain(status, "Not found"),
    };
    // The first part is the frame's secret: a live frame's, or nothing is served.
    let [frame, rest @ ..] = parts.as_slice() else {
        return plain(StatusCode::NOT_FOUND, "Not found");
    };
    if !is_nonce(frame) {
        return plain(StatusCode::NOT_FOUND, "Not found");
    }
    let Some(owner) = (serving.frame_page)(frame) else {
        return plain(StatusCode::NOT_FOUND, "Not found");
    };
    let found = if rest.first().map(String::as_str) == Some(kit::SEGMENT) {
        kit_file(rest)
    } else {
        page_file(serving.kasten, rest, &owner)
    };
    let found = match found {
        Ok(found) => found,
        Err(status) => return plain(status, "Not found"),
    };
    let web = found
        .page_id
        .as_deref()
        .is_some_and(|id| (serving.web_images)(id));
    let kind = media_type(&found.name);
    let body = with_kit_at(&found.name, found.bytes, &base, frame);
    let mut response = answer(
        StatusCode::OK,
        kind,
        &csp(web),
        if head { Vec::new() } else { body },
    );
    // A sandboxed frame asks with the origin "null": the answer may be read by
    // it (a module script), and by nobody else.
    let asked_by_a_frame = request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|v| v.as_bytes() == b"null");
    if asked_by_a_frame {
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            header::HeaderValue::from_static("null"),
        );
    }
    response
}
