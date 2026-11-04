//! Which site an embedded address is of, for the sites that have a player or an embed of their own. The editor turns such a link into the
//! site's embed when it shows it (a YouTube watch page is not framed, its player is); this only names the site, so that an agent that
//! makes an embed from any link has it noted on the element, and `get_deck` tells the next reader what it is.
//!
//! The same sites as the editor's, by the same rules (the TypeScript side is `toEmbedUrl`); nothing here fetches anything.

const YOUTUBE: &[&str] = &[
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
];
const VIMEO: &[&str] = &["vimeo.com", "www.vimeo.com", "player.vimeo.com"];
const LOOM: &[&str] = &["loom.com", "www.loom.com"];
const FIGMA: &[&str] = &["figma.com", "www.figma.com"];

/// A web address taken apart: no name and password, the host in lower case, the path's parts and the query's pairs.
struct Address<'a> {
    host: String,
    parts: Vec<&'a str>,
    query: Vec<(&'a str, &'a str)>,
}

fn parse(address: &str) -> Option<Address<'_>> {
    let text = address.trim();
    let (scheme, rest) = text.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    if authority.contains('@') || authority.is_empty() {
        return None;
    }
    let host = authority
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let tail = tail.split('#').next().unwrap_or("");
    let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
    Some(Address {
        host,
        parts: path.split('/').filter(|part| !part.is_empty()).collect(),
        query: query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .collect(),
    })
}

fn is_video_id(id: &str) -> bool {
    id.len() == 11
        && id != "videoseries"
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn asked<'a>(address: &Address<'a>, name: &str) -> Option<&'a str> {
    address
        .query
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, value)| *value)
}

fn youtube(address: &Address) -> bool {
    let first = address.parts.first().copied();
    let video = if address.host == "youtu.be" {
        first
    } else if matches!(first, Some("shorts" | "embed" | "live" | "v")) {
        address.parts.get(1).copied()
    } else if first == Some("watch") {
        asked(address, "v")
    } else {
        None
    };
    video.is_some_and(is_video_id) || asked(address, "list").is_some_and(|list| !list.is_empty())
}

fn all_digits(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|c| c.is_ascii_digit())
}

fn vimeo(address: &Address) -> bool {
    if address.host == "player.vimeo.com" {
        return address.parts.first() == Some(&"video")
            && address.parts.get(1).is_some_and(|id| all_digits(id));
    }
    address.parts.iter().any(|part| all_digits(part))
}

fn loom(address: &Address) -> bool {
    matches!(address.parts.first().copied(), Some("share" | "embed"))
        && address
            .parts
            .get(1)
            .is_some_and(|id| id.len() >= 8 && id.chars().all(|c| c.is_ascii_alphanumeric()))
}

fn google(address: &Address) -> Option<&'static str> {
    if address.parts.get(1) != Some(&"d") || address.parts.len() < 3 {
        return None;
    }
    match address.parts.first().copied() {
        Some("presentation") => Some("google-slides"),
        Some("document") => Some("google-docs"),
        Some("spreadsheets") => Some("google-sheets"),
        _ => None,
    }
}

/// The site an address is of: `youtube`, `vimeo`, `loom`, `google-slides`, `google-docs`, `google-sheets` or `figma`; None for any other
/// address and for what is not a web address.
pub fn provider_of(address: &str) -> Option<&'static str> {
    let address = parse(address)?;
    let host = address.host.as_str();
    if YOUTUBE.contains(&host) {
        youtube(&address).then_some("youtube")
    } else if VIMEO.contains(&host) {
        vimeo(&address).then_some("vimeo")
    } else if LOOM.contains(&host) {
        loom(&address).then_some("loom")
    } else if host == "docs.google.com" {
        google(&address)
    } else if FIGMA.contains(&host) {
        matches!(
            address.parts.first().copied(),
            Some("file" | "design" | "proto" | "board" | "embed")
        )
        .then_some("figma")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_of_a_known_site_names_it() {
        for (address, site) in [
            (
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90",
                "youtube",
            ),
            ("https://youtu.be/dQw4w9WgXcQ?t=1m30s", "youtube"),
            ("  HTTPS://WWW.YouTube.com/shorts/dQw4w9WgXcQ ", "youtube"),
            ("https://www.youtube.com/playlist?list=PLabc123", "youtube"),
            (
                "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
                "youtube",
            ),
            ("https://vimeo.com/76979871", "vimeo"),
            ("https://player.vimeo.com/video/76979871?h=abc", "vimeo"),
            ("https://www.loom.com/share/0123456789abcdef", "loom"),
            (
                "https://docs.google.com/presentation/d/1AbC-dEf_123/edit",
                "google-slides",
            ),
            (
                "https://docs.google.com/document/d/e/2PACX-1vABC/pub",
                "google-docs",
            ),
            (
                "https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0",
                "google-sheets",
            ),
            ("https://www.figma.com/design/AbC123/My-file", "figma"),
        ] {
            assert_eq!(provider_of(address), Some(site), "{address}");
        }
    }

    #[test]
    fn any_other_address_names_no_site() {
        for address in [
            "https://example.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/",
            "https://www.youtube.com/watch?v=short",
            "https://youtu.be/",
            "https://vimeo.com/features",
            "https://www.loom.com/pricing",
            "https://docs.google.com/forms/d/e/1FAIpQ/viewform",
            "https://www.figma.com/pricing",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://",
            "not an address",
            "",
        ] {
            assert_eq!(provider_of(address), None, "{address}");
        }
    }
}
