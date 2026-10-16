//! Fetching a calendar feed over the web. The address of a private feed is a
//! secret (anyone who has it can read the calendar), so nothing here puts it
//! in a message: errors name the host only.

use std::time::Duration;

use reqwest::StatusCode;
use reqwest::Url;
use reqwest::header::{ACCEPT, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use serde::{Deserialize, Serialize};

use crate::chat::address::private;

/// A feed bigger than this is not read.
pub const MAX_FEED: usize = 10 * 1024 * 1024;
/// How long one fetch may take.
pub const WAIT: Duration = Duration::from_secs(30);
/// Longer addresses are not kept: a keychain holds a secret of about a
/// thousand characters at the least (Windows' Credential Manager), and a feed's
/// address is far shorter.
const MAX_ADDRESS: usize = 1000;

/// What the server said about the version it gave, to ask for a change only.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Validators {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

/// What a fetch found.
#[derive(Debug, PartialEq, Eq)]
pub enum Answer {
    /// The copy we have is still the current one.
    Unchanged,
    Fresh {
        text: String,
        validators: Validators,
    },
}

/// An address as a person pastes it: `webcal://` means `https://`, and one
/// with no scheme is `https://` too.
pub fn address(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Paste the calendar's address".into());
    }
    let lower = input.to_ascii_lowercase();
    let url = if let Some(rest) = lower
        .strip_prefix("webcals://")
        .or_else(|| lower.strip_prefix("webcal://"))
    {
        // The original casing, after the scheme.
        let skip = input.len() - rest.len();
        format!("https://{}", &input[skip..])
    } else if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let parsed = Url::parse(&url).map_err(|_| "That is not a web address".to_owned())?;
    if url.len() > MAX_ADDRESS {
        return Err("That address is longer than a calendar's address is".into());
    }
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || url.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("That is not a web address a calendar can be fetched from".into());
    }
    Ok(url)
}

/// The host of an address, for messages: the rest of it is secret.
pub fn host_of(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_else(|| "that address".to_owned())
}

/// What the window may show of an address: the host, and no more than
/// whether it ends in `.ics`.
pub fn masked(url: &str) -> String {
    let ics = Url::parse(url).is_ok_and(|u| u.path().to_ascii_lowercase().ends_with(".ics"));
    format!("{}/…{}", host_of(url), if ics { ".ics" } else { "" })
}

/// Whether the address is on this computer or the local network, by what the
/// person typed: such a feed is theirs to fetch, and the fetch may stay there.
pub fn is_local(url: &str) -> bool {
    Url::parse(url).is_ok_and(|parsed| private(&parsed))
}

/// The error and its causes, without the address the request went to.
fn words(err: reqwest::Error) -> String {
    let err = err.without_url();
    let mut text = err.to_string();
    let mut source = std::error::Error::source(&err);
    while let Some(cause) = source {
        let more = cause.to_string();
        if !text.contains(&more) {
            text.push_str(": ");
            text.push_str(&more);
        }
        source = cause.source();
    }
    scrub(&text)
}

/// A message with every word that is an address left out: the feed's is a
/// secret, and a proxy's may carry a name and password.
fn scrub(text: &str) -> String {
    text.split(' ')
        .map(|word| if word.contains("://") { "…" } else { word })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Why a request did not get an answer, in words that name the host only.
fn unreached(host: &str, err: reqwest::Error) -> String {
    if err.is_timeout() {
        return format!("{host} did not answer in time. It will be tried again in a while");
    }
    let text = words(err);
    let lower = text.to_ascii_lowercase();
    // A proxy that fails reads like any other connection failure; say where to look.
    let hint = if lower.contains("proxy") || lower.contains("tunnel") {
        ". If this computer uses a proxy, check its settings"
    } else {
        ""
    };
    format!("Could not reach {host}: {text}{hint}")
}

fn refused(host: &str, status: StatusCode) -> String {
    match status.as_u16() {
        407 => format!(
            "A proxy between this computer and {host} asked for a sign-in. Check this computer's proxy settings"
        ),
        404 | 410 => format!(
            "{host} has no calendar at that address any more. If it was reset, copy the new address"
        ),
        401 | 403 => format!(
            "{host} refused the address. It may need a sign-in, or its secret address was reset"
        ),
        429 | 500..=599 => format!("{host} answered {status}. It will be tried again in a while"),
        _ => format!("{host} answered {status}"),
    }
}

fn too_big(host: &str) -> String {
    format!(
        "The calendar from {host} is bigger than {} MB, which KastenFlow does not read",
        MAX_FEED / (1024 * 1024)
    )
}

fn header(response: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

/// Asks for the feed at `url` (already read by `address`), by the client that
/// suits it, and only for a change when `have` says what we hold. The future
/// can be dropped at any time: the connection is closed and nothing is kept.
pub async fn get(client: &reqwest::Client, url: &str, have: &Validators) -> Result<Answer, String> {
    get_within(client, url, have, WAIT).await
}

/// `get`, giving up when the whole answer has not come in `wait`.
pub async fn get_within(
    client: &reqwest::Client,
    url: &str,
    have: &Validators,
    wait: Duration,
) -> Result<Answer, String> {
    let host = host_of(url);
    let mut request = client
        .get(url)
        .header(ACCEPT, "text/calendar, text/plain;q=0.9, */*;q=0.5")
        .timeout(wait);
    if let Some(etag) = &have.etag {
        request = request.header(IF_NONE_MATCH, etag);
    }
    if let Some(modified) = &have.last_modified {
        request = request.header(IF_MODIFIED_SINCE, modified);
    }
    let mut response = request.send().await.map_err(|e| unreached(&host, e))?;
    let status = response.status();
    if status == StatusCode::NOT_MODIFIED {
        return Ok(Answer::Unchanged);
    }
    if !status.is_success() {
        return Err(refused(&host, status));
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_FEED as u64)
    {
        return Err(too_big(&host));
    }
    let validators = Validators {
        etag: header(&response, ETAG),
        last_modified: header(&response, LAST_MODIFIED),
    };
    let mut bytes = Vec::new();
    while let Some(piece) = response.chunk().await.map_err(|e| {
        if e.is_timeout() {
            format!("The calendar from {host} took too long to arrive. It will be tried again in a while")
        } else {
            format!("The calendar from {host} stopped coming: {}", words(e))
        }
    })? {
        if bytes.len() + piece.len() > MAX_FEED {
            return Err(too_big(&host));
        }
        bytes.extend_from_slice(&piece);
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let head: String = text
        .chars()
        .take(64)
        .collect::<String>()
        .to_ascii_uppercase();
    if !head
        .trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with("BEGIN:VCALENDAR")
    {
        return Err(format!(
            "{host} did not give a calendar. Use the calendar's iCal (.ics) address"
        ));
    }
    // A calendar that stops short is not a copy to keep over a whole one.
    let tail: String = text.trim_end().chars().rev().take(16).collect();
    let tail: String = tail.chars().rev().collect::<String>().to_ascii_uppercase();
    if !tail.ends_with("END:VCALENDAR") {
        return Err(format!(
            "The calendar from {host} was cut off. It will be tried again in a while"
        ));
    }
    Ok(Answer::Fresh { text, validators })
}

#[cfg(test)]
#[path = "fetch_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "fetch_failure_tests.rs"]
mod failure_tests;
