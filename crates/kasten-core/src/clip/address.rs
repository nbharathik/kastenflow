//! What a capture keeps of the page's address and of the tags sent with it:
//! the address as a plain web link, the site it is on, and the extra tags,
//! cleaned.

use super::capture::TAG;
use crate::error::{Error, Result};

/// The longest address kept.
const MAX_URL: usize = 4096;

/// The most tags a capture carries beside `capture`.
const MAX_TAGS: usize = 8;
/// The longest tag, in characters.
const MAX_TAG: usize = 40;

/// `tags` as the tags a card keeps beside `capture`: a leading `#` goes,
/// empty ones and repeats (in any case) are dropped, and one that could not
/// be a tag (letters, digits, `-`, `_` and `/` only) refuses the capture.
pub(super) fn extra_tags(tags: &[String]) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag = tag.trim().trim_start_matches('#').trim();
        if tag.is_empty() {
            continue;
        }
        let fine = tag.chars().count() <= MAX_TAG
            && tag
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '/'));
        if !fine {
            return Err(Error::Invalid(format!(
                "“{}” cannot be a tag: tags are letters, digits, dashes, underscores and slashes, up to {MAX_TAG} characters",
                tag.chars().take(MAX_TAG).collect::<String>()
            )));
        }
        if !tag.eq_ignore_ascii_case(TAG) && !out.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            out.push(tag.to_owned());
        }
    }
    if out.len() > MAX_TAGS {
        return Err(Error::Invalid(format!(
            "A capture carries at most {MAX_TAGS} tags"
        )));
    }
    Ok(out)
}

/// `url` as an address a capture keeps: a web page's, with no name or
/// password in it.
pub(super) fn address(url: &str) -> Result<String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let rest = ["https://", "http://"]
        .iter()
        .find_map(|scheme| lower.strip_prefix(scheme).map(|_| &url[scheme.len()..]));
    let bad = |why: &str| Error::Invalid(format!("That address cannot be kept: {why}"));
    let Some(rest) = rest else {
        return Err(bad("only web pages (http or https) are captured"));
    };
    if url.len() > MAX_URL || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(bad("it is too long or holds spaces"));
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err(bad("it has no site, or holds a name and password"));
    }
    Ok(url.to_owned())
}

/// Query parameters that only say where a visitor came from: they never name
/// another page.
fn is_tracking(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("utm_") || matches!(name.as_str(), "fbclid" | "gclid" | "mc_cid" | "mc_eid")
}

/// A key that is the same for every way of writing the address of one web
/// page, so a page saved twice is found: the scheme is left out (http and
/// https are one page), the host is lowercase without a leading `www.` or a
/// default port, the fragment and a trailing slash (but the root's) go, the
/// tracking parameters (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`) go and
/// the others are sorted. The path keeps its case. None for what is not a web
/// address, or holds spaces, a name and password, or no site.
pub fn url_key(url: &str) -> Option<String> {
    let url = url.trim();
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let (scheme, rest) = url.split_once("://")?;
    let default_port = match scheme.to_ascii_lowercase().as_str() {
        "https" => "443",
        "http" => "80",
        _ => return None,
    };
    let rest = rest.split('#').next().unwrap_or(rest);
    let (authority, tail) = rest.split_at(rest.find(['/', '?']).unwrap_or(rest.len()));
    if authority.contains('@') {
        return None;
    }
    let authority = authority.to_ascii_lowercase();
    let (host, port) = if authority.starts_with('[') {
        let close = authority.find(']')?;
        (
            &authority[..=close],
            authority[close + 1..].strip_prefix(':').unwrap_or(""),
        )
    } else {
        authority
            .split_once(':')
            .unwrap_or((authority.as_str(), ""))
    };
    let host = host.strip_prefix("www.").unwrap_or(host);
    if host.is_empty() || host == "[]" {
        return None;
    }
    let port = if port == default_port { "" } else { port };
    let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
    let path = path.trim_end_matches('/');
    let mut params: Vec<&str> = query
        .split('&')
        .filter(|p| !p.is_empty() && !is_tracking(p.split('=').next().unwrap_or(p)))
        .collect();
    params.sort_unstable();
    let mut key = host.to_owned();
    if !port.is_empty() {
        key.push(':');
        key.push_str(port);
    }
    // The root is the path "/"; any other path never ends in a slash.
    key.push_str(if path.is_empty() { "/" } else { path });
    if !params.is_empty() {
        key.push('?');
        key.push_str(&params.join("&"));
    }
    Some(key)
}

/// The address a note keeps in a `url:` line at the top level of its
/// frontmatter (what the web clipper and a capture write), read from the
/// line alone: a plain, single-quoted or double-quoted value. None when there
/// is none, or it is written some other way (a block scalar).
pub fn front_url(text: &str) -> Option<String> {
    let prefix = crate::frontmatter::split(text).prefix;
    for line in prefix.split_inclusive('\n').skip(1) {
        let line = line.trim_end_matches(['\n', '\r']);
        if line.trim_end() == "---" {
            break;
        }
        let Some(rest) = line.strip_prefix("url") else {
            continue;
        };
        let Some(value) = rest.trim_start_matches([' ', '\t']).strip_prefix(':') else {
            continue;
        };
        let value = value.trim();
        let url = match value.chars().next()? {
            '"' => {
                let inner = value[1..].strip_suffix('"').or_else(|| {
                    // A comment after the closing quote.
                    value[1..].rfind('"').map(|i| &value[1..=i])
                })?;
                inner.replace("\\\"", "\"").replace("\\\\", "\\")
            }
            '\'' => {
                let end = value[1..].rfind('\'')?;
                value[1..=end].replace("''", "'")
            }
            '>' | '|' | '#' => return None,
            _ => value
                .split(" #")
                .next()
                .unwrap_or(value)
                .trim_end()
                .to_owned(),
        };
        return (!url.is_empty()).then_some(url);
    }
    None
}

/// The key of the page a note was saved from: its top-level `url:`, else its
/// `props.url` (what a capture records), as `url_key` reads it.
pub(crate) fn note_url_key(text: &str, props: &serde_json::Value) -> Option<String> {
    front_url(text)
        .and_then(|url| url_key(&url))
        .or_else(|| props.get("url")?.as_str().and_then(url_key))
}

/// The site an address is on: its host without a port or a leading `www.`.
pub fn site_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host = if authority.starts_with('[') {
        authority.split_inclusive(']').next().unwrap_or(authority)
    } else {
        authority.split(':').next().unwrap_or(authority)
    };
    let host = host.to_ascii_lowercase();
    host.strip_prefix("www.").unwrap_or(&host).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_page_has_one_key_however_its_address_is_written() {
        let same: &[&[&str]] = &[
            &[
                "https://example.com/guide",
                "http://example.com/guide",
                "HTTPS://EXAMPLE.COM/guide",
                "https://www.example.com/guide",
                "https://example.com:443/guide",
                "http://example.com:80/guide",
                "https://example.com/guide/",
                "https://example.com/guide#section-2",
                "https://example.com/guide/?utm_source=news&utm_medium=email",
                "https://example.com/guide?fbclid=abc&gclid=def&mc_cid=1&mc_eid=2",
                "  https://example.com/guide  ",
            ],
            &[
                "https://example.com/",
                "https://example.com",
                "http://www.example.com/#top",
                "https://example.com/?utm_campaign=x",
            ],
            &[
                "https://example.com/s?b=2&a=1",
                "https://example.com/s?a=1&b=2",
                "https://example.com/s/?a=1&b=2&UTM_Source=z#x",
            ],
            &["http://[::1]:8080/x", "https://[::1]:8080/x/"],
        ];
        for group in same {
            let keys: Vec<Option<String>> = group.iter().map(|u| url_key(u)).collect();
            assert!(keys[0].is_some(), "{group:?}");
            assert!(keys.iter().all(|k| *k == keys[0]), "{group:?} -> {keys:?}");
        }
    }

    #[test]
    fn different_pages_have_different_keys() {
        let all = [
            "https://example.com/guide",
            "https://example.com/Guide",
            "https://example.com/guide/two",
            "https://example.org/guide",
            "https://news.example.com/guide",
            "https://example.com:8443/guide",
            "http://example.com:443/guide",
            "https://example.com/guide?page=2",
            "https://example.com/guide?page=3",
            "https://example.com/guide?page",
            "https://example.com/",
            "https://example.com/?q=1",
        ];
        let keys: Vec<String> = all.iter().map(|u| url_key(u).unwrap()).collect();
        for (i, a) in keys.iter().enumerate() {
            for (j, b) in keys.iter().enumerate() {
                assert!(i == j || a != b, "{} and {} share {a}", all[i], all[j]);
            }
        }
    }

    #[test]
    fn the_key_is_host_port_path_and_sorted_query() {
        assert_eq!(
            url_key("https://www.Example.com:443/A/b/?z=1&utm_x=2&a=%20&fbclid=q#f").unwrap(),
            "example.com/A/b?a=%20&z=1"
        );
        assert_eq!(url_key("http://example.com").unwrap(), "example.com/");
        assert_eq!(
            url_key("http://example.com:8080/?").unwrap(),
            "example.com:8080/"
        );
        assert_eq!(url_key("https://[::1]:443/x").unwrap(), "[::1]/x");
    }

    #[test]
    fn what_is_not_a_web_address_has_no_key() {
        for bad in [
            "",
            "   ",
            "example.com/x",
            "mailto:a@b.c",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "ftp://example.com/x",
            "https://",
            "https:///x",
            "https://u:p@example.com/",
            "https://exa mple.com/",
            "https://example.com/a b",
            "https://example.com/\u{7}",
            "https://www./x",
        ] {
            assert_eq!(url_key(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn reads_the_url_a_note_keeps_at_the_top_of_its_frontmatter() {
        let front = |lines: &str| format!("---\ntitle: T\n{lines}---\n");
        for (lines, want) in [
            ("url: https://a.example/x\n", Some("https://a.example/x")),
            (
                "url:   https://a.example/x  # note\n",
                Some("https://a.example/x"),
            ),
            (
                "url: \"https://a.example/x?a=1&b=2\"\n",
                Some("https://a.example/x?a=1&b=2"),
            ),
            (
                "url: 'https://a.example/it''s'\n",
                Some("https://a.example/it's"),
            ),
            (
                "url: https://a.example/x#frag\n",
                Some("https://a.example/x#frag"),
            ),
            ("props:\n  url: https://b.example\n", None),
            ("url: >\n  https://a.example/x\n", None),
            ("url:\n", None),
            ("Url: https://a.example/x\n", None),
            ("urls: https://a.example/x\n", None),
        ] {
            assert_eq!(front_url(&front(lines)).as_deref(), want, "{lines:?}");
        }
        let crlf = "---\r\nurl: https://a.example/x\r\n---\r\nbody";
        assert_eq!(front_url(crlf).as_deref(), Some("https://a.example/x"));
        assert_eq!(front_url("no frontmatter"), None);
        assert_eq!(front_url(""), None);
    }

    #[test]
    fn keeps_web_addresses_only_and_names_the_site() {
        assert_eq!(
            address(" https://www.Example.com/a?b=1#c ").unwrap(),
            "https://www.Example.com/a?b=1#c"
        );
        for bad in [
            "http:///x",
            "https://u:p@example.com/",
            "https://a b/",
            "mailto:a@b.c",
            "HTTP:example.com",
        ] {
            assert!(address(bad).is_err(), "{bad}");
        }
        assert_eq!(site_of("https://www.Example.com:8443/a?b=1"), "example.com");
        assert_eq!(site_of("http://[::1]:8080/x"), "[::1]");
        assert_eq!(site_of("https://news.example.org"), "news.example.org");
    }

    #[test]
    fn extra_tags_are_cleaned_and_one_that_cannot_be_a_tag_refuses() {
        let list = |tags: &[&str]| tags.iter().map(|t| (*t).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            extra_tags(&list(&["#a", " b ", "A", "", "Capture", "x/y-z_1", "é"])).unwrap(),
            ["a", "b", "x/y-z_1", "é"]
        );
        assert!(extra_tags(&[]).unwrap().is_empty());
        for bad in ["a b", "a,b", "a:b", "a#b", "<x>", &"z".repeat(41)] {
            assert!(extra_tags(&list(&[bad])).is_err(), "{bad}");
        }
        let nine: Vec<String> = (0..9).map(|n| format!("t{n}")).collect();
        assert!(extra_tags(&nine).is_err());
        assert_eq!(extra_tags(&nine[..8]).unwrap().len(), 8);
    }
}
