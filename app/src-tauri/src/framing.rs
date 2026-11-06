//! Whether a web page lets itself be shown in a frame of another page. A page cannot find that out from its frame (a refused frame still
//! "loads" the browser's error page, and the refusal is not reported to the page around it), but the headers the site answers with say:
//! `X-Frame-Options`, and the `frame-ancestors` of a `Content-Security-Policy`. The core asks once, when an embed is shown, so that a
//! page that will not be framed gets the "open it in your browser" card at once and never a broken frame.
//!
//! The question goes over the app's web client, which reaches the public internet only: an address on this computer or the local network
//! is never asked about (it is the person's own, and not worth a request that could be pointed at their network).

use std::time::Duration;

use reqwest::StatusCode;
use reqwest::header::{ACCEPT, HeaderMap};
use serde::Serialize;
use tauri::State;

use crate::chat::address::private;
use crate::chat::commands::ChatState;

/// How long a site has to answer before the question is let go.
const WAIT: Duration = Duration::from_secs(6);

/// What is known of a page's wish to be framed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    /// Nothing in its headers keeps it out of a frame of ours.
    Open,
    /// Its headers refuse a frame of ours.
    Refused,
    /// It could not be asked, or the answer was not one a verdict can be drawn from.
    Unknown,
}

/// The page that would hold the frame: where Kasten's own pages are served from on this system.
#[derive(Debug, Clone, Copy)]
struct Parent {
    scheme: &'static str,
    host: &'static str,
}

impl Parent {
    fn here() -> Parent {
        Parent::on(cfg!(windows))
    }

    fn on(windows: bool) -> Parent {
        if windows {
            Parent {
                scheme: "http",
                host: "tauri.localhost",
            }
        } else {
            Parent {
                scheme: "tauri",
                host: "localhost",
            }
        }
    }

    fn default_port(self) -> u16 {
        match self.scheme {
            "https" => 443,
            _ => 80,
        }
    }
}

/// Whether one source of a `frame-ancestors` list names the parent.
fn names(source: &str, parent: Parent) -> bool {
    let source = source.to_ascii_lowercase();
    match source.as_str() {
        // `'self'` is the site itself and `'none'` nobody. `*` should mean every host on the network schemes only, which would leave
        // out `tauri://`; it is taken as meaning us, since a page that is let in by mistake shows the browser's own error page, and a
        // page that is kept out by mistake could never be shown.
        "'none'" | "'self'" => return false,
        "*" => return true,
        _ => {}
    }
    // A scheme alone: `https:`. (`http:` also covers `https`.)
    if let Some(scheme) = source.strip_suffix(':').filter(|s| !s.contains('/')) {
        return scheme == parent.scheme || (scheme == "http" && parent.scheme == "https");
    }
    let (scheme, rest) = match source.split_once("://") {
        Some((scheme, rest)) => (Some(scheme), rest),
        None => (None, source.as_str()),
    };
    if let Some(scheme) = scheme
        && scheme != parent.scheme
        && !(scheme == "http" && parent.scheme == "https")
    {
        return false;
    }
    let authority = rest.split('/').next().unwrap_or("");
    let (host, port) = authority
        .rsplit_once(':')
        .filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit()) || *port == "*")
        .map_or((authority, None), |(host, port)| (host, Some(port)));
    let host_ok = host == "*"
        || host == parent.host
        || host
            .strip_prefix("*.")
            .is_some_and(|tail| parent.host.ends_with(&format!(".{tail}")));
    let port_ok = match port {
        None | Some("*") => true,
        Some(number) => number.parse::<u16>().ok() == Some(parent.default_port()),
    };
    host_ok && port_ok
}

/// Whether the list of sources after `frame-ancestors` lets the parent hold the page. An empty list lets nobody.
fn ancestors_allow(sources: &str, parent: Parent) -> bool {
    sources
        .split_ascii_whitespace()
        .any(|source| names(source, parent))
}

/// The verdict the headers of a page's answer give for a frame in `parent`. A policy that has `frame-ancestors` is the whole of it:
/// browsers set `X-Frame-Options` aside then. Only enforced policies count, not a report-only one.
fn verdict_of(headers: &HeaderMap, parent: Parent) -> Verdict {
    let mut ancestors = false;
    for value in headers.get_all("content-security-policy") {
        let Ok(text) = value.to_str() else { continue };
        // Several policies may share a header, apart by commas; a page must meet every one.
        for policy in text.split(',') {
            for directive in policy.split(';') {
                let directive = directive.trim();
                let (name, sources) = directive
                    .split_once(char::is_whitespace)
                    .unwrap_or((directive, ""));
                if name.eq_ignore_ascii_case("frame-ancestors") {
                    ancestors = true;
                    if !ancestors_allow(sources, parent) {
                        return Verdict::Refused;
                    }
                }
            }
        }
    }
    if ancestors {
        return Verdict::Open;
    }
    for value in headers.get_all("x-frame-options") {
        let Ok(text) = value.to_str() else { continue };
        // `ALLOW-FROM` is obsolete and browsers ignore it; only these two keep a page out of ours.
        if text
            .split(',')
            .map(|word| word.trim().to_ascii_uppercase())
            .any(|word| word == "DENY" || word == "SAMEORIGIN")
        {
            return Verdict::Refused;
        }
    }
    Verdict::Open
}

/// The headers of the page at `url`: a HEAD request, and when the site will not answer one, the start of a GET (the body is never read).
async fn headers_of(client: &reqwest::Client, url: &str) -> Option<HeaderMap> {
    let head = client
        .head(url)
        .header(ACCEPT, "text/html,*/*;q=0.5")
        .timeout(WAIT)
        .send()
        .await;
    let retry = match &head {
        Ok(response) => matches!(
            response.status(),
            StatusCode::BAD_REQUEST
                | StatusCode::FORBIDDEN
                | StatusCode::METHOD_NOT_ALLOWED
                | StatusCode::NOT_ACCEPTABLE
                | StatusCode::NOT_IMPLEMENTED
        ),
        Err(_) => true,
    };
    let response = if retry {
        client
            .get(url)
            .header(ACCEPT, "text/html,*/*;q=0.5")
            .timeout(WAIT)
            .send()
            .await
            .ok()?
    } else {
        head.ok()?
    };
    // Only a page that was given counts: an error page's headers are not the page's.
    response
        .status()
        .is_success()
        .then(|| response.headers().clone())
}

/// Asks the site at `url` whether it lets itself be shown in a frame of Kasten's window.
#[tauri::command]
pub async fn frame_policy(chat: State<'_, ChatState>, url: String) -> Result<Verdict, String> {
    let address = crate::clip::address(&url)?;
    let parsed = reqwest::Url::parse(&address)
        .map_err(|e| format!("“{address}” is not a web address: {e}"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.host_str().is_none() {
        return Err(format!("“{address}” is not a web address KastenFlow asks"));
    }
    // This computer and the local network are the person's own.
    if private(&parsed) {
        return Ok(Verdict::Unknown);
    }
    let client = chat.web()?;
    Ok(headers_of(&client, parsed.as_str())
        .await
        .map_or(Verdict::Unknown, |headers| {
            verdict_of(&headers, Parent::here())
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderName, HeaderValue};

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    const WIN: Parent = Parent {
        scheme: "http",
        host: "tauri.localhost",
    };
    const MAC: Parent = Parent {
        scheme: "tauri",
        host: "localhost",
    };

    fn verdict(pairs: &[(&str, &str)]) -> Verdict {
        verdict_of(&headers(pairs), WIN)
    }

    #[test]
    fn a_page_with_no_such_headers_is_open() {
        assert_eq!(verdict(&[]), Verdict::Open);
        assert_eq!(verdict(&[("content-type", "text/html")]), Verdict::Open);
        assert_eq!(
            verdict(&[("content-security-policy", "default-src 'self'; img-src *")]),
            Verdict::Open
        );
    }

    #[test]
    fn x_frame_options_deny_and_sameorigin_refuse_in_any_case() {
        for value in ["DENY", "deny", " SameOrigin ", "SAMEORIGIN, DENY"] {
            assert_eq!(
                verdict(&[("x-frame-options", value)]),
                Verdict::Refused,
                "{value}"
            );
        }
        // An obsolete word that browsers ignore, and nonsense, keep nobody out.
        for value in ["ALLOW-FROM https://tauri.localhost", "ALLOWALL", ""] {
            assert_eq!(
                verdict(&[("x-frame-options", value)]),
                Verdict::Open,
                "{value}"
            );
        }
    }

    #[test]
    fn frame_ancestors_none_and_self_refuse() {
        for value in [
            "frame-ancestors 'none'",
            "default-src 'self'; frame-ancestors 'self'",
            "frame-ancestors 'self' https://a.example https://*.b.example",
            "FRAME-ANCESTORS https://a.example",
            "frame-ancestors",
            "frame-ancestors ;",
        ] {
            assert_eq!(
                verdict(&[("content-security-policy", value)]),
                Verdict::Refused,
                "{value}"
            );
        }
    }

    #[test]
    fn frame_ancestors_that_name_us_or_everyone_let_us_in() {
        for value in [
            "frame-ancestors *",
            "frame-ancestors 'self' http://tauri.localhost",
            "frame-ancestors tauri.localhost",
            "frame-ancestors *.localhost",
            "frame-ancestors http: https:",
            "frame-ancestors http://tauri.localhost:*",
            "frame-ancestors http://tauri.localhost/some/path",
        ] {
            assert_eq!(
                verdict(&[("content-security-policy", value)]),
                Verdict::Open,
                "{value}"
            );
        }
        // On the other systems the parent is `tauri://localhost`.
        let on_mac = |value: &str| verdict_of(&headers(&[("content-security-policy", value)]), MAC);
        assert_eq!(on_mac("frame-ancestors tauri://localhost"), Verdict::Open);
        assert_eq!(on_mac("frame-ancestors tauri:"), Verdict::Open);
        assert_eq!(on_mac("frame-ancestors https:"), Verdict::Refused);
        assert_eq!(on_mac("frame-ancestors 'self'"), Verdict::Refused);
    }

    #[test]
    fn a_source_that_does_not_name_our_origin_does_not_let_us_in() {
        for value in [
            "frame-ancestors https://tauri.localhost",
            "frame-ancestors http://tauri.localhost:8080",
            "frame-ancestors http://localhost",
            "frame-ancestors https://*.example.com",
            "frame-ancestors *.example.com",
            "frame-ancestors https:",
            "frame-ancestors evil-tauri.localhost",
        ] {
            assert_eq!(
                verdict(&[("content-security-policy", value)]),
                Verdict::Refused,
                "{value}"
            );
        }
    }

    #[test]
    fn frame_ancestors_are_the_whole_answer_when_there_are_any() {
        // Browsers set X-Frame-Options aside when the policy has frame-ancestors.
        assert_eq!(
            verdict(&[
                ("x-frame-options", "DENY"),
                ("content-security-policy", "frame-ancestors *"),
            ]),
            Verdict::Open
        );
        // Without them the old header counts.
        assert_eq!(
            verdict(&[
                ("x-frame-options", "SAMEORIGIN"),
                ("content-security-policy", "default-src 'self'"),
            ]),
            Verdict::Refused
        );
    }

    #[test]
    fn every_policy_must_be_met_and_a_report_only_one_is_not_enforced() {
        assert_eq!(
            verdict(&[
                ("content-security-policy", "frame-ancestors *"),
                ("content-security-policy", "frame-ancestors 'none'"),
            ]),
            Verdict::Refused
        );
        assert_eq!(
            verdict(&[(
                "content-security-policy",
                "frame-ancestors *, frame-ancestors 'self'"
            )]),
            Verdict::Refused
        );
        assert_eq!(
            verdict(&[(
                "content-security-policy-report-only",
                "frame-ancestors 'none'"
            )]),
            Verdict::Open
        );
    }

    #[test]
    fn a_verdict_is_said_in_a_word() {
        assert_eq!(serde_json::to_string(&Verdict::Open).unwrap(), "\"open\"");
        assert_eq!(
            serde_json::to_string(&Verdict::Refused).unwrap(),
            "\"refused\""
        );
        assert_eq!(
            serde_json::to_string(&Verdict::Unknown).unwrap(),
            "\"unknown\""
        );
    }
}
