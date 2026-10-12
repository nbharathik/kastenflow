//! Where a provider's requests go, and which key may go with them.
//! A key is kept for one provider at one address, the origin
//! its requests go to: a vault whose config names another server for the
//! same provider finds no key there, so a vault someone shares can never
//! send your key where it chooses. A key only travels over https, or to a
//! server on this computer.

use std::net::IpAddr;

use kasten_core::config::Provider;
use reqwest::Url;

use super::http::Kind;
use super::{anthropic, openai, responses};
use crate::secrets::KeyStore;

/// The address each kind's own API answers at. Keys saved by name alone,
/// before keys were kept by address, are used there and nowhere else.
fn official(kind: Kind) -> &'static str {
    match kind {
        Kind::Anthropic => "https://api.anthropic.com",
        Kind::OpenAi | Kind::ChatGpt => "https://api.openai.com",
    }
}

/// Where a provider's chat requests go, parsed. A ChatGPT sign-in has one
/// address, OpenAI's Responses API, whatever the vault's settings say: its
/// tokens can never be sent anywhere a shared vault chooses.
fn endpoint(provider: &Provider) -> Result<(Kind, Url), String> {
    let kind = Kind::of(&provider.kind)?;
    let url = match kind {
        Kind::Anthropic => anthropic::url(&provider.base_url),
        Kind::OpenAi => openai::url(&provider.base_url)?,
        Kind::ChatGpt => responses::URL.to_owned(),
    };
    let parsed = Url::parse(&url).map_err(|e| {
        format!(
            "“{}” has a base URL that is not a web address: {e}",
            provider.name
        )
    })?;
    // A name, password or query in the address would travel to wherever it
    // points, and sit in the vault's settings; a key goes in the keychain.
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(format!(
            "“{}” has a base URL with a user name, password or query in it; keep a key in Settings instead",
            provider.name
        ));
    }
    Ok((kind, parsed))
}

/// A server on this computer.
pub(crate) fn loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || bare
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

/// An address on this computer or the local network: loopback, private,
/// link-local (where cloud metadata servers answer), shared by a carrier's
/// NAT, this network, broadcast, multicast or reserved; or an IPv4 one of
/// these carried inside IPv6 (mapped, compatible, NAT64 or 6to4).
pub(crate) fn local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [first, second, ..] = ip.octets();
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || first == 0
                || first >= 240
                || (first == 100 && (64..128).contains(&second))
        }
        IpAddr::V6(ip) => {
            let words = ip.segments();
            let inner = |hi: u16, lo: u16| {
                local_ip(IpAddr::V4(std::net::Ipv4Addr::from(
                    (u32::from(hi) << 16) | u32::from(lo),
                )))
            };
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
                // Site-local, retired but still routed on some networks.
                || (words[0] & 0xffc0) == 0xfec0
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|v4| local_ip(IpAddr::V4(v4)))
                // NAT64 (64:ff9b::/96) and the old IPv4-compatible form (::/96).
                || ((words[..6] == [0x64, 0xff9b, 0, 0, 0, 0] || words[..6] == [0; 6])
                    && inner(words[6], words[7]))
                // 6to4 (2002::/16) carries its IPv4 address next.
                || (words[0] == 0x2002 && inner(words[1], words[2]))
        }
    }
}

/// A server on this computer or the local network, by its address or a
/// name only a local network knows (one without a dot, or `.local`).
pub(crate) fn private(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return true;
    };
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    match bare.parse::<IpAddr>() {
        Ok(ip) => local_ip(ip),
        Err(_) => {
            let name = bare.trim_end_matches('.').to_ascii_lowercase();
            !name.contains('.')
                || name.ends_with(".localhost")
                || name.ends_with(".local")
                || name.ends_with(".internal")
        }
    }
}

/// The origin a provider's requests go to, such as `https://api.anthropic.com`.
pub fn origin_of(provider: &Provider) -> Result<String, String> {
    Ok(endpoint(provider)?.1.origin().ascii_serialization())
}

/// Whether notes may go to the provider's address without the person
/// confirming it on this computer: its kind's own API, or a server on this
/// computer. Any other address comes from the vault's config, which a vault
/// someone shares could fill.
pub fn known_address(provider: &Provider) -> Result<bool, String> {
    let (kind, url) = endpoint(provider)?;
    Ok(url.origin().ascii_serialization() == official(kind) || loopback(&url))
}

/// Whether a key may be sent where `provider`'s requests go.
pub fn may_carry_key(provider: &Provider) -> Result<bool, String> {
    Ok(carries_key(&endpoint(provider)?.1))
}

/// Whether a key may travel to `url`: over https, or to this computer.
/// Over plain http on a network, anyone on the way could read it.
fn carries_key(url: &Url) -> bool {
    url.scheme() == "https" || (url.scheme() == "http" && loopback(url))
}

/// The keychain account of a provider's key: its name and the origin its
/// requests go to, such as `Claude @ https://api.anthropic.com`.
fn account(name: &str, url: &Url) -> String {
    format!("{} @ {}", name.trim(), url.origin().ascii_serialization())
}

/// The key for `provider`, if one was saved for where its requests go.
pub fn key_for(keys: &dyn KeyStore, provider: &Provider) -> Result<Option<String>, String> {
    let (kind, url) = endpoint(provider)?;
    // A ChatGPT provider takes no key: the account signs its requests.
    if kind == Kind::ChatGpt || !carries_key(&url) {
        return Ok(None);
    }
    if let Some(key) = keys.get(&account(&provider.name, &url))? {
        return Ok(Some(key));
    }
    if url.origin().ascii_serialization() == official(kind) {
        return keys.get(provider.name.trim());
    }
    Ok(None)
}

/// Keeps `key` for `provider` at the address its requests go to, in place
/// of any kept by its name alone.
pub fn save_key(keys: &dyn KeyStore, provider: &Provider, key: &str) -> Result<(), String> {
    let (kind, url) = endpoint(provider)?;
    if kind == Kind::ChatGpt {
        return Err("A ChatGPT sign-in takes no API key".to_owned());
    }
    if !carries_key(&url) {
        return Err(format!(
            "A key is only sent over https, or to a server on this computer; “{}” uses plain http",
            provider.name
        ));
    }
    keys.set(&account(&provider.name, &url), key)?;
    keys.delete(provider.name.trim())
}

/// Forgets the key kept for `provider`, by address and by name alone.
pub fn forget_key(keys: &dyn KeyStore, provider: &Provider) -> Result<(), String> {
    if let Ok((_, url)) = endpoint(provider) {
        keys.delete(&account(&provider.name, &url))?;
    }
    keys.delete(provider.name.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(kind: &str, base_url: &str) -> Provider {
        Provider {
            name: "P".into(),
            kind: kind.into(),
            base_url: base_url.into(),
            model: "m".into(),
        }
    }

    #[test]
    fn keeps_a_key_by_name_and_origin() {
        let (_, url) = endpoint(&provider("anthropic", "")).unwrap();
        assert_eq!(account(" P ", &url), "P @ https://api.anthropic.com");
        let (_, url) = endpoint(&provider("openai", "https://LLM.example:443/v1")).unwrap();
        assert_eq!(account("P", &url), "P @ https://llm.example");
        let (_, url) = endpoint(&provider("openai", "http://localhost:8000/v1")).unwrap();
        assert_eq!(account("P", &url), "P @ http://localhost:8000");
    }

    #[test]
    fn knows_addresses_on_this_computer_or_the_local_network() {
        for (address, local) in [
            ("https://example.com/a", false),
            ("https://93.184.215.14/a", false),
            ("http://localhost:3000/", true),
            ("http://127.0.0.1/", true),
            ("http://10.0.0.5/admin", true),
            ("http://192.168.1.1/", true),
            ("http://169.254.169.254/latest/meta-data", true),
            ("http://[::1]/", true),
            ("http://[fd00::1]/", true),
            ("http://nas/", true),
            ("http://printer.local/", true),
            ("http://0.0.0.0:8080/", true),
            ("http://100.64.0.7/", true),
            ("http://255.255.255.255/", true),
            ("http://[::ffff:10.0.0.1]/", true),
            // An IPv4 address carried inside IPv6: NAT64, the old
            // compatible form and 6to4 all lead to the IPv4 one.
            ("http://[64:ff9b::a9fe:a9fe]/", true),
            ("http://[::7f00:1]/", true),
            ("http://[2002:c0a8:0101::1]/", true),
            ("http://[fec0::1]/", true),
            ("http://[ff02::1]/", true),
            ("http://224.0.0.1/", true),
            ("http://240.0.0.1/", true),
            ("http://[64:ff9b::808:808]/", false),
            ("http://[2002:0808:0808::1]/", false),
            ("http://[2606:4700::1111]/", false),
            ("http://8.8.8.8/", false),
        ] {
            assert_eq!(private(&Url::parse(address).unwrap()), local, "{address}");
        }
    }

    #[test]
    fn knows_the_official_apis_and_this_computer_without_asking() {
        for (kind, base, known) in [
            ("anthropic", "", true),
            ("openai", "https://api.openai.com/v1", true),
            ("openai", "http://localhost:11434/v1", true),
            ("openai", "https://m.example/v1", false),
            ("anthropic", "https://m.example", false),
            ("openai", "http://192.168.1.20:8000/v1", false),
        ] {
            assert_eq!(
                known_address(&provider(kind, base)).unwrap(),
                known,
                "{base}"
            );
        }
        assert_eq!(
            origin_of(&provider("openai", "https://M.example:443/v1")).unwrap(),
            "https://m.example"
        );
    }

    #[test]
    fn a_base_url_holds_no_secret() {
        for base in [
            "https://me:secret@llm.example/v1",
            "https://token@llm.example/v1",
            "https://llm.example/v1?key=secret",
            "https://llm.example/v1#secret",
        ] {
            let err = endpoint(&provider("openai", base)).unwrap_err();
            assert!(!err.contains("secret"), "{err}");
        }
        assert!(endpoint(&provider("openai", "https://llm.example/v1")).is_ok());
    }

    #[test]
    fn a_key_travels_over_https_or_to_this_computer() {
        for (base, carries) in [
            ("https://llm.example/v1", true),
            ("http://localhost:8000/v1", true),
            ("http://127.0.0.1:8000/v1", true),
            ("http://[::1]:8000/v1", true),
            ("http://llm-server:8000/v1", false),
            ("http://192.168.1.20:8000/v1", false),
        ] {
            let (_, url) = endpoint(&provider("openai", base)).unwrap();
            assert_eq!(carries_key(&url), carries, "{base}");
        }
    }
}
