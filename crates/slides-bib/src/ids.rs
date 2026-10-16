//! The identifiers that say two entries are one work: a DOI, an arXiv number.
//! Each is read out of the ways people write it (`doi = {10.1000/X}`, a
//! `https://doi.org/` address, `eprint = {arXiv:1706.03762v5}`) and put in one
//! form, so the same work compares equal wherever it came from. Nothing here
//! looks anything up: an identifier is only read, never checked.

use std::collections::BTreeMap;

fn digits_at(bytes: &[u8], from: usize) -> usize {
    bytes
        .get(from..)
        .unwrap_or_default()
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .count()
}

/// A DOI, as it is compared: lower case, without `doi:`, a resolver's address or
/// the punctuation that ends a sentence. None when `text` holds none.
pub fn normalise_doi(text: &str) -> Option<String> {
    let lower = text.trim().to_ascii_lowercase().replace("%2f", "/");
    let bytes = lower.as_bytes();
    let mut from = 0;
    while let Some(found) = lower.get(from..).and_then(|rest| rest.find("10.")) {
        let start = from + found;
        from = start + 3;
        if start > 0 && bytes[start - 1].is_ascii_alphanumeric() {
            continue;
        }
        let digits = digits_at(bytes, start + 3);
        let slash = start + 3 + digits;
        if !(4..=9).contains(&digits) || bytes.get(slash) != Some(&b'/') {
            continue;
        }
        let rest = lower.get(slash + 1..)?;
        let suffix = rest.split_whitespace().next().unwrap_or_default();
        let suffix = suffix.trim_end_matches(['.', ',', ';', '}', ')', '>', '"', '\'']);
        if suffix.is_empty() {
            return None;
        }
        return Some(format!("{}/{suffix}", &lower[start..slash]));
    }
    None
}

/// An arXiv identifier, as it is compared: lower case, without `arXiv:`, an address or
/// the version (`1706.03762v5` is `1706.03762`; `hep-th/9901001` stays). None when
/// `text` holds none.
pub fn normalise_arxiv(text: &str) -> Option<String> {
    let lower = text.trim().to_ascii_lowercase();
    let bytes = lower.as_bytes();
    // 1706.03762: four digits, a dot, four or five digits.
    for start in 0..bytes.len() {
        if (start > 0 && bytes[start - 1].is_ascii_digit()) || digits_at(bytes, start) != 4 {
            continue;
        }
        if bytes.get(start + 4) != Some(&b'.') {
            continue;
        }
        let tail = digits_at(bytes, start + 5);
        if (4..=5).contains(&tail) {
            return lower.get(start..start + 5 + tail).map(str::to_owned);
        }
    }
    // hep-th/9901001, math.gt/0309136: an archive, a slash, seven digits.
    for (slash, byte) in bytes.iter().enumerate() {
        if *byte != b'/' || digits_at(bytes, slash + 1) != 7 {
            continue;
        }
        let archive = bytes[..slash]
            .iter()
            .rev()
            .take_while(|b| b.is_ascii_lowercase() || matches!(**b, b'-' | b'.'))
            .count();
        if archive >= 2 {
            return lower.get(slash - archive..slash + 8).map(str::to_owned);
        }
    }
    None
}

/// The DOI of an entry's fields (lower-case names), normalised: from `doi`, else
/// from a `url` at doi.org.
pub fn doi_key(fields: &BTreeMap<String, String>) -> Option<String> {
    fields
        .get("doi")
        .and_then(|doi| normalise_doi(doi))
        .or_else(|| {
            let url = fields.get("url")?;
            url.to_ascii_lowercase()
                .contains("doi.org/")
                .then(|| normalise_doi(url))?
        })
}

/// The arXiv identifier of an entry's fields, normalised: from `eprint` (when the
/// entry says it is arXiv's, or the number looks like one), from the DOI arXiv gives
/// its papers (`10.48550/arXiv.2005.14165`), from an address at arxiv.org, or from a
/// `journal` or `note` such as "arXiv preprint arXiv:2005.14165".
pub fn arxiv_key(fields: &BTreeMap<String, String>) -> Option<String> {
    let said = |name: &str| fields.get(name).map(|v| v.trim().to_ascii_lowercase());
    if let Some(eprint) = fields.get("eprint") {
        let prefix = said("archiveprefix")
            .or_else(|| said("eprinttype"))
            .unwrap_or_default();
        if (prefix.is_empty() || prefix == "arxiv")
            && let Some(id) = normalise_arxiv(eprint)
        {
            return Some(id);
        }
    }
    if let Some(doi) = fields.get("doi").and_then(|doi| normalise_doi(doi))
        && let Some(id) = doi.strip_prefix("10.48550/arxiv.")
    {
        return normalise_arxiv(id);
    }
    for name in ["url", "howpublished"] {
        if let Some(value) = fields.get(name) {
            let lower = value.to_ascii_lowercase();
            if let Some(at) = lower.find("arxiv.org/") {
                return normalise_arxiv(&lower[at + "arxiv.org/".len()..]);
            }
        }
    }
    for name in ["journal", "note"] {
        if let Some(value) = fields.get(name) {
            let lower = value.to_ascii_lowercase();
            if let Some(at) = lower.find("arxiv:") {
                return normalise_arxiv(&lower[at + "arxiv:".len()..]);
            }
        }
    }
    None
}
