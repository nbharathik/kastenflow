//! Where a work can be read on the web, found from its entry alone: nothing here asks a server, so
//! the address is what the bibliography says and no more. Only `http` and `https` addresses come out.

use super::refs::Entry;

/// The prefixes a DOI is written with, in lower case; the address is the DOI after them.
const DOI_PREFIXES: [&str; 7] = [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
    "doi.org/",
    "dx.doi.org/",
    "doi:",
];

/// A BibTeX value as the address it stands for: `\url{...}` unwrapped, the escapes of `_ % & # $`
/// undone, protecting braces gone. (The usual reading of a value turns `--` into a dash, which an
/// address must not have.)
fn address(raw: &str) -> String {
    let mut text = raw.trim();
    if let Some(inner) = text
        .strip_prefix("\\url{")
        .and_then(|rest| rest.strip_suffix('}'))
    {
        text = inner.trim();
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.clone().next() {
                Some(next @ ('_' | '%' | '&' | '#' | '$')) => {
                    out.push(next);
                    chars.next();
                }
                _ => out.push('\\'),
            },
            '{' | '}' => {}
            other => out.push(other),
        }
    }
    out
}

/// Whether the byte may stand in a path as it is.
fn plain_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'-' | b'.'
                | b'_'
                | b'~'
                | b'/'
                | b':'
                | b'@'
                | b'!'
                | b'$'
                | b'\''
                | b'('
                | b')'
                | b'*'
                | b'+'
                | b','
                | b';'
                | b'='
        )
}

/// The text of a path with every byte that does not belong in one written as `%XX`.
fn encode(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        if plain_byte(byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `https://doi.org/` and the DOI, for a DOI written bare or with one of the usual prefixes. It must
/// look like one: `10.`, digits and dots, a slash, then something.
fn doi_link(raw: &str) -> Option<String> {
    let text = address(raw);
    let mut doi = text.trim();
    let lower = doi.to_ascii_lowercase();
    if let Some(prefix) = DOI_PREFIXES.iter().find(|p| lower.starts_with(**p)) {
        doi = doi[prefix.len()..].trim_start();
    }
    if doi.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let (registrant, suffix) = doi.split_once('/')?;
    let digits = registrant.strip_prefix("10.")?;
    let fine = !digits.is_empty()
        && digits.bytes().all(|b| b.is_ascii_digit() || b == b'.')
        && !digits.starts_with('.')
        && !suffix.is_empty();
    fine.then(|| format!("https://doi.org/{registrant}/{}", encode(suffix)))
}

/// The address as it stands when it is a web address: `http` or `https`, with a host, and nothing in
/// it that is not allowed in one.
fn web_address(raw: &str) -> Option<String> {
    let text = address(raw);
    let url = text.trim();
    if url
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | '"' | '\\'))
    {
        return None;
    }
    let lower = url.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");
    let ok = !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'[' | b']'));
    ok.then(|| url.to_owned())
}

impl Entry {
    /// Where to read the work on the web, if the entry says. In order: its DOI, as
    /// `https://doi.org/10.…`; its `url`, when that is an `http` or `https` address; its page on the
    /// arXiv, `https://arxiv.org/abs/<id>`. None when the entry gives none of these. No other kind of
    /// address is ever returned, whatever the entry holds.
    pub fn web_link(&self) -> Option<String> {
        if let Some(link) = self.field("doi").and_then(doi_link) {
            return Some(link);
        }
        if let Some(link) = self.field("url").and_then(web_address) {
            return Some(link);
        }
        let id = self.arxiv()?;
        let id = address(&id);
        let id = id.trim();
        (!id.is_empty() && !id.chars().any(|c| c.is_whitespace() || c.is_control()))
            .then(|| format!("https://arxiv.org/abs/{}", encode(id)))
    }
}
