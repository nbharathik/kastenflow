//! Pandoc-style `[@key]` citations in pages: finding them, and renaming a
//! citation key in a page's text (the bytes of the key and nothing else).

mod plan;
mod scan;

pub use plan::{
    CitingDeck, CitingPage, DeckText, KeyRename, KeyRenamePlan, KeyRenamed, KeyUses, PlannedDeck,
    PlannedPage,
};
pub use scan::{Cite, citations};

/// The keys a page's text cites, each once, in the order first cited.
pub fn keys_in(text: &str) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    for cite in citations(text) {
        let key = &text[cite.key];
        if !keys.iter().any(|known| known == key) {
            keys.push(key.to_owned());
        }
    }
    keys
}

/// How many times the text cites `key`.
pub fn count_of(text: &str, key: &str) -> usize {
    citations(text)
        .into_iter()
        .filter(|cite| &text[cite.key.clone()] == key)
        .count()
}

/// The text with `to` written for `from` in every citation of `from`, and how
/// many citations that is. Every other byte stays.
pub fn rename_in(text: &str, from: &str, to: &str) -> (String, usize) {
    let found: Vec<_> = citations(text)
        .into_iter()
        .filter(|cite| &text[cite.key.clone()] == from)
        .collect();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    for cite in &found {
        out.push_str(&text[copied..cite.key.start]);
        out.push_str(to);
        copied = cite.key.end;
    }
    out.push_str(&text[copied..]);
    (out, found.len())
}
