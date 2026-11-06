//! Whether a vault has a deck, for the list of tools a client gets. A vault with no deck lists the few deck tools that
//! start one and the guide to making one (`decks::routes::ENTRY`); once it has a deck, the rest are listed too. The
//! answer is kept for a few seconds, since the list is worked out for every call, and looking is a walk of the vault.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use kasten_core::Kasten;

/// How long an answer is trusted.
const FRESH: Duration = Duration::from_secs(3);

type Seen = Mutex<HashMap<PathBuf, (Instant, bool)>>;

fn seen() -> &'static Seen {
    static SEEN: OnceLock<Seen> = OnceLock::new();
    SEEN.get_or_init(Seen::default)
}

/// Whether the vault has a deck, as of a few seconds ago at most. A vault that cannot say is taken to have one, so no
/// tool is hidden from a vault that needs it.
pub(crate) fn has_decks(kasten: &Kasten) -> bool {
    let key = kasten.root().to_path_buf();
    let kept = seen()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(&key)
        .copied();
    if let Some((at, known)) = kept
        && at.elapsed() < FRESH
    {
        return known;
    }
    has_decks_now(kasten)
}

/// Forgets what was seen of the vault, after a change that may have made or taken away a deck.
pub(crate) fn forget(kasten: &Kasten) {
    seen()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(kasten.root());
}

/// Whether the vault has a deck, looking now.
pub(crate) fn has_decks_now(kasten: &Kasten) -> bool {
    let any = match kasten.decks() {
        Ok(decks) => !decks.is_empty(),
        Err(_) => true,
    };
    seen()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(kasten.root().to_path_buf(), (Instant::now(), any));
    any
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_vault_has_decks_once_one_is_there_and_the_answer_is_kept_for_a_moment() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-mcp-slides-group-{}",
            kasten_core::ulid_at(kasten_core::Instant::now().millis)
        ));
        std::fs::create_dir_all(dir.join(".kasten")).unwrap();
        std::fs::create_dir_all(dir.join("library")).unwrap();
        let kasten = Kasten::open(&dir).unwrap();
        assert!(!has_decks_now(&kasten), "an empty vault has none");
        let deck = slides_core::ops::Engine::create("Talk", "Light", 3).unwrap();
        let text = slides_core::canonical::write(deck.deck()).unwrap();
        std::fs::write(dir.join("library/talk.deck"), text).unwrap();
        assert!(!has_decks(&kasten), "the answer of a moment ago is kept");
        assert!(has_decks_now(&kasten), "looking again finds the deck");
        assert!(has_decks(&kasten));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
