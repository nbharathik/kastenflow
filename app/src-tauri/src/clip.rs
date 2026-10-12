//! The web clipper: fetches a page over https or http, with
//! the app's web client (public pages connect without a proxy), and keeps its
//! article as an inbox card through kasten-core. A page elsewhere never
//! leads the fetch to this computer or the local network.

use std::time::Duration;

use kasten_core::{Instant, NoteFile};
use reqwest::Url;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use tauri::State;

use crate::chat::address::private;
use crate::chat::commands::ChatState;
use crate::commands::notes::{HUMAN, OpenVault};

/// Pages bigger than this are not web articles.
const MAX_PAGE: usize = 8 * 1024 * 1024;
/// A page read for its title alone is read no further than this.
const TITLE_READ: usize = 512 * 1024;
const HEAD_END: &[u8] = b"</head>";
const WAIT: Duration = Duration::from_secs(30);

/// An address as a person types it: `example.com/x` is `https://example.com/x`.
pub(crate) fn address(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Which page? Paste its address".into());
    }
    let url = if url.contains("://") {
        url.to_owned()
    } else {
        format!("https://{url}")
    };
    if !(url.starts_with("https://") || url.starts_with("http://"))
        || url.contains(char::is_whitespace)
    {
        return Err(format!("“{url}” is not a web address"));
    }
    Ok(url)
}

/// Whether the page the person asked for is on this computer or the local
/// network by the address they typed: an address like `192.168.1.20`, or a
/// name only a local network knows (`nas`, `printer.local`). Such a page is
/// theirs to clip, and the fetch may stay there. A public-looking name is
/// fetched as public however its name resolves, so a name that leads to a
/// local address, now or on a second look, is refused.
fn asked_for_local(url: &str) -> bool {
    Url::parse(url).is_ok_and(|parsed| private(&parsed))
}

/// Asks for the web page at `url` (already read by `address`): over the
/// public client, or the local one when the person typed a local address.
/// Only a successful answer that is a web page comes back.
async fn fetch(chat: &ChatState, url: &str) -> Result<reqwest::Response, String> {
    let client = if asked_for_local(url) {
        chat.local_web()?
    } else {
        chat.web()?
    };
    let response = client
        .get(url)
        .header(ACCEPT, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
        .timeout(WAIT)
        .send()
        .await
        .map_err(|e| format!("Could not reach {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} answered {status}"));
    }
    let kind = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if !kind.is_empty() && !kind.contains("html") {
        return Err(format!(
            "That address is not a web page but {}",
            kind.split(';').next().unwrap_or(&kind)
        ));
    }
    Ok(response)
}

/// Whether `bytes` hold the end of a page's head, where its title is.
fn head_done(bytes: &[u8]) -> bool {
    bytes
        .windows(HEAD_END.len())
        .any(|w| w.eq_ignore_ascii_case(HEAD_END))
}

/// A web page's title, for the link a person pasted: the page is read up
/// to its head or the first 512 KB, whichever comes first, and nothing is
/// kept. The same rules as the clipper: an address elsewhere never leads the
/// fetch to this computer or the local network, and a local one is fetched
/// only when it is typed that way.
#[tauri::command]
pub async fn web_title(chat: State<'_, ChatState>, url: String) -> Result<String, String> {
    let url = address(&url)?;
    let mut response = fetch(&chat, &url).await?;
    let landed = response.url().to_string();
    let mut bytes = Vec::new();
    while bytes.len() < TITLE_READ {
        let Some(piece) = response
            .chunk()
            .await
            .map_err(|e| format!("The page stopped coming: {e}"))?
        else {
            break;
        };
        // An end tag may fall across two pieces: look from just before this one.
        let from = bytes.len().saturating_sub(HEAD_END.len() - 1);
        bytes.extend_from_slice(&piece);
        if head_done(&bytes[from..]) {
            break;
        }
    }
    bytes.truncate(TITLE_READ);
    Ok(kasten_core::clip::title_of(
        &landed,
        &String::from_utf8_lossy(&bytes),
    ))
}

/// The page at `url` (already read by `address`): the address it landed on
/// and its bytes, read in pieces up to the limit so a huge answer is never
/// held whole. The browser tab's "Capture page" reads a page the same way.
pub(crate) async fn page_bytes(chat: &ChatState, url: &str) -> Result<(String, Vec<u8>), String> {
    let mut response = fetch(chat, url).await?;
    let landed = response.url().to_string();
    let too_big = || "That page is too big to keep".to_owned();
    if response
        .content_length()
        .is_some_and(|n| n > MAX_PAGE as u64)
    {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    while let Some(piece) = response
        .chunk()
        .await
        .map_err(|e| format!("The page stopped coming: {e}"))?
    {
        if bytes.len() + piece.len() > MAX_PAGE {
            return Err(too_big());
        }
        bytes.extend_from_slice(&piece);
    }
    Ok((landed, bytes))
}

#[tauri::command]
pub async fn clip_url(
    vault: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    url: String,
) -> Result<NoteFile, String> {
    let kasten = vault.require()?;
    let url = address(&url)?;
    let (landed, bytes) = page_bytes(&chat, &url).await?;
    // Reading the page is work for a thread of its own, and a slip in it
    // is an answer, not a crash.
    tauri::async_runtime::spawn_blocking(move || {
        crate::crash::caught(|| {
            let page = String::from_utf8_lossy(&bytes);
            kasten
                .clip(&HUMAN, &landed, &page, Instant::now())
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(crate::crash::joined)?
}

#[cfg(test)]
mod tests {
    use super::{address, asked_for_local, head_done};

    #[test]
    fn knows_where_a_pages_head_ends() {
        assert!(head_done(b"<html><head><title>x</title></head><body>"));
        assert!(head_done(b"<TITLE>x</TITLE></HEAD>"));
        assert!(!head_done(b"<html><head><title>x</title>"));
        assert!(!head_done(b""));
    }

    #[test]
    fn reads_addresses_as_people_type_them() {
        assert_eq!(address(" example.com/a ").unwrap(), "https://example.com/a");
        assert_eq!(address("http://example.com").unwrap(), "http://example.com");
        assert!(address("ftp://example.com").is_err());
        assert!(address("").is_err());
        assert!(address("two words").is_err());
    }

    #[test]
    fn knows_a_page_asked_for_on_this_computer_or_the_local_network() {
        assert!(asked_for_local("http://localhost:8080/wiki"));
        assert!(asked_for_local("http://192.168.1.20/notes"));
        assert!(asked_for_local("http://nas/"));
        assert!(!asked_for_local("https://93.184.215.14/article"));
        // A public-looking name counts as public, even one whose name
        // leads here: its fetch then refuses the local address.
        assert!(!asked_for_local("http://localtest.me/"));
        assert!(!asked_for_local("https://example.com/"));
    }
}
