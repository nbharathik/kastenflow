//! The last few versions of decks this process read or wrote, so that
//! `render_diff` can draw a slide as it was: a deck hash an agent was given
//! (by `get_deck`, a write tool or a render) names a version that is still
//! here. Memory only, bounded in count and bytes, and gone when the process
//! ends; the history in the vault is the lasting record.

use std::sync::Mutex;

use slides_core::agent::DeckText;

/// The most versions kept, across all decks.
const MOST_VERSIONS: usize = 16;
/// The most bytes of deck text kept in all.
const MOST_BYTES: usize = 24 * 1024 * 1024;

static KEPT: Mutex<Vec<DeckText>> = Mutex::new(Vec::new());

fn held() -> std::sync::MutexGuard<'static, Vec<DeckText>> {
    KEPT.lock().unwrap_or_else(|p| p.into_inner())
}

/// Remembers this version of a deck (the newest is the one seen last).
pub(super) fn keep(text: &DeckText) {
    let mut kept = held();
    kept.retain(|v| !(v.name == text.name && v.hash == text.hash));
    kept.push(text.clone());
    while kept.len() > 1
        && (kept.len() > MOST_VERSIONS
            || kept.iter().map(|v| v.text.len()).sum::<usize>() > MOST_BYTES)
    {
        kept.remove(0);
    }
}

/// A kept version of the deck `name`: the one with hash `hash`, or (without
/// one) the newest whose hash is not `not`.
pub(super) fn find(name: &str, hash: Option<&str>, not: &str) -> Option<DeckText> {
    held()
        .iter()
        .rev()
        .filter(|v| v.name == name)
        .find(|v| match hash {
            Some(wanted) => v.hash == wanted,
            None => v.hash != not,
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(name: &str, n: usize) -> DeckText {
        DeckText {
            name: name.to_owned(),
            text: format!("text {n}"),
            hash: format!("hash{n}"),
        }
    }

    #[test]
    fn a_version_is_found_by_its_hash_or_as_the_one_before_the_latest_and_the_count_is_bounded() {
        // A name of its own, so tests that run beside this one cannot disturb it.
        let name = "versions-test/a.deck";
        keep(&version(name, 1));
        keep(&version(name, 2));
        assert_eq!(find(name, Some("hash1"), "hash2").unwrap().text, "text 1");
        assert_eq!(find(name, None, "hash2").unwrap().hash, "hash1");
        assert!(find(name, Some("hash9"), "hash2").is_none());
        assert!(find("versions-test/other.deck", None, "x").is_none());
        // Seen again, a version is not kept twice.
        keep(&version(name, 2));
        assert_eq!(held().iter().filter(|v| v.name == name).count(), 2);
        for n in 10..40 {
            keep(&version("versions-test/b.deck", n));
        }
        assert!(held().len() <= MOST_VERSIONS);
        assert!(find("versions-test/b.deck", Some("hash39"), "").is_some());
    }
}
