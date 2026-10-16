//! The web clients calendar feeds are fetched with.
//!
//! A feed's address is the person's own (usually a secret one from their
//! calendar service), not a page some other site asked the app to fetch, so
//! the clients follow the computer's proxy settings: on a network that lets
//! the web through only by a proxy, a feed would otherwise never arrive. They
//! share the redirect rules of every web fetch the app makes (at most ten,
//! and never from a public address to this computer or the local network).
//!
//! - A public address is fetched with names resolved by the public-only
//!   resolver, as the app's page fetches are. A proxy resolves the name
//!   itself, so with one that check has nothing to look at and the proxy's own
//!   rules apply.
//! - An address the person typed on this computer or the local network is
//!   theirs to fetch, and its client may stay there.

use std::sync::OnceLock;

use super::fetch;
use crate::chat::clients::web_builder;
use crate::chat::public_dns::PublicOnly;

/// The two clients, made on first use so starting the app loads no TLS.
#[derive(Default)]
pub struct Clients {
    public: OnceLock<Result<reqwest::Client, String>>,
    local: OnceLock<Result<reqwest::Client, String>>,
}

impl Clients {
    /// The client that suits an address.
    pub fn for_address(&self, url: &str) -> Result<reqwest::Client, String> {
        if fetch::is_local(url) {
            self.local.get_or_init(|| build(false, None)).clone()
        } else {
            self.public.get_or_init(|| build(true, None)).clone()
        }
    }

    /// Both addresses' clients are `client`: for tests, which keep to
    /// 127.0.0.1 whatever proxy this machine names.
    #[cfg(test)]
    pub fn fixed(client: reqwest::Client) -> Clients {
        let clients = Clients::default();
        let _ = clients.public.set(Ok(client.clone()));
        let _ = clients.local.set(Ok(client));
        clients
    }
}

/// A feed client. `public_only` limits names to the public internet; `proxy`
/// stands in for the system's settings (only tests give one).
pub(super) fn build(
    public_only: bool,
    proxy: Option<reqwest::Proxy>,
) -> Result<reqwest::Client, String> {
    let mut builder = web_builder();
    if public_only {
        builder = builder.dns_resolver(PublicOnly::new());
    }
    if let Some(proxy) = proxy {
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| {
        format!(
            "KastenFlow cannot make HTTPS connections: {}",
            e.without_url()
        )
    })
}
