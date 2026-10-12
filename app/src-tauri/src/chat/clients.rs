//! The HTTP clients the app shares: one for the providers' APIs, which
//! follows no redirect, and two for web pages.

use std::time::Duration;

use super::errors::chain;

const CONNECT: Duration = Duration::from_secs(15);

/// The client every chat shares; system proxy settings apply. It follows
/// no redirect: a provider's answer comes from the address its key was
/// saved for, or not at all.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT)
        .user_agent(concat!("KastenFlow/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("The chat cannot make HTTPS connections: {}", chain(&e)))
}

/// The client for web pages elsewhere: names lead only to the public
/// internet, and it follows up to ten redirects, never to this computer or
/// the local network, where a page could otherwise fetch a router's or a
/// local server's pages into the vault.
pub fn web_client() -> Result<reqwest::Client, String> {
    public_builder(web_builder())
        .build()
        .map_err(|e| format!("KastenFlow cannot make HTTPS connections: {}", chain(&e)))
}

fn public_builder(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    // A proxy resolves the destination itself, bypassing the public DNS
    // filter. Untrusted page fetches therefore connect directly.
    builder
        .no_proxy()
        .dns_resolver(super::public_dns::PublicOnly::new())
}

#[cfg(test)]
#[path = "http_public_tests.rs"]
mod public_client_tests;

/// The client for a page the person asked for on this computer or the
/// local network, such as an intranet wiki: it may stay there.
pub fn local_web_client() -> Result<reqwest::Client, String> {
    web_builder()
        .build()
        .map_err(|e| format!("KastenFlow cannot make HTTPS connections: {}", chain(&e)))
}

fn web_builder() -> reqwest::ClientBuilder {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        let from_outside = attempt
            .previous()
            .first()
            .is_some_and(|first| !super::address::private(first));
        if attempt.previous().len() >= 10 {
            attempt.error("the page redirected too many times")
        } else if from_outside && super::address::private(attempt.url()) {
            attempt.error("a page elsewhere redirected to this computer or the local network")
        } else {
            attempt.follow()
        }
    });
    reqwest::Client::builder()
        .connect_timeout(CONNECT)
        .user_agent(concat!("KastenFlow/", env!("CARGO_PKG_VERSION")))
        .redirect(policy)
}
