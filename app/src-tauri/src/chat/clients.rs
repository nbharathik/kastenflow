//! The HTTP clients the app shares: one for the providers' APIs, which
//! follows no redirect, and two for web pages.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::errors::chain;

const CONNECT: Duration = Duration::from_secs(15);
/// A connection that has sat idle this long is not reused: a router or a
/// provider's load balancer has usually dropped it by then, and the request
/// that found out would fail.
const IDLE_CONNECTION: Duration = Duration::from_secs(20);
/// How often an open connection is probed, so one that went dead is found.
const KEEPALIVE: Duration = Duration::from_secs(30);
/// The longest a read waits for the next piece of an answer. An answer is
/// streamed, so there is no limit on the whole.
const BETWEEN_PIECES: Duration = Duration::from_secs(240);

/// The client every chat shares; system proxy settings apply. It follows
/// no redirect: a provider's answer comes from the address its key was
/// saved for, or not at all.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT)
        .pool_idle_timeout(IDLE_CONNECTION)
        .tcp_keepalive(KEEPALIVE)
        .read_timeout(BETWEEN_PIECES)
        .user_agent(concat!("KastenFlow/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("The chat cannot make HTTPS connections: {}", chain(&e)))
}

type Build = dyn Fn() -> Result<reqwest::Client, String> + Send + Sync;

#[derive(Default)]
struct Slot {
    client: Option<reqwest::Client>,
    /// Counts the clients made, so two requests that find the same one
    /// dead make one new client between them.
    generation: u64,
}

/// The providers' client, made when first needed and made again when a
/// connection failed in a way that says the old one (its pool, its proxy
/// settings) should not be trusted. A client that could not be made is not
/// remembered: the next use tries again.
pub struct Shared {
    build: Box<Build>,
    slot: Mutex<Slot>,
}

impl Shared {
    /// The app's own client.
    pub fn standard() -> Shared {
        Shared::with(client)
    }

    /// A shared client made by `build`.
    pub fn with(
        build: impl Fn() -> Result<reqwest::Client, String> + Send + Sync + 'static,
    ) -> Shared {
        Shared {
            build: Box::new(build),
            slot: Mutex::default(),
        }
    }

    fn slot(&self) -> std::sync::MutexGuard<'_, Slot> {
        self.slot.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The client, and which one it is.
    pub fn get(&self) -> Result<(reqwest::Client, u64), String> {
        let mut slot = self.slot();
        if let Some(client) = &slot.client {
            return Ok((client.clone(), slot.generation));
        }
        let made = (self.build)()?;
        slot.generation += 1;
        slot.client = Some(made.clone());
        Ok((made, slot.generation))
    }

    pub fn client(&self) -> Result<reqwest::Client, String> {
        self.get().map(|(client, _)| client)
    }

    /// A new client in place of generation `seen`, unless another request
    /// already made one; the current client either way. If a new one cannot
    /// be made the old one stays.
    pub fn replace(&self, seen: u64) -> Result<(reqwest::Client, u64), String> {
        let mut slot = self.slot();
        if slot.client.is_some()
            && slot.generation == seen
            && let Ok(made) = (self.build)()
        {
            slot.generation += 1;
            slot.client = Some(made);
        }
        drop(slot);
        self.get()
    }
}

impl std::fmt::Debug for Shared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Shared").finish_non_exhaustive()
    }
}

/// Makes a shared client of the app's own kind.
pub fn shared() -> Arc<Shared> {
    Arc::new(Shared::standard())
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

/// The shared start of the clients for web addresses the person gave or a page
/// named: the user agent, the connect time and the redirect rules. System proxy
/// settings apply unless the caller turns them off.
pub(crate) fn web_builder() -> reqwest::ClientBuilder {
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
