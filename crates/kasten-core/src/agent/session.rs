//! Agent sessions: every MCP connection and chat thread is one, with an
//! id, a client name and a start time.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::atomic::write_atomic;
use crate::error::Result;
use crate::history::Actor;
use crate::id::ulid_at;
use crate::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub client: String,
    /// Milliseconds since the Unix epoch.
    pub started: u64,
}

/// The most characters a session's name keeps.
pub const NAME_MAX: usize = 80;

/// Format characters that draw nothing but change what a name looks like:
/// zero-width spaces and joiners, left-to-right and right-to-left marks and
/// overrides (a name shown reversed), isolates, the word joiner and the byte
/// order mark. A client name loses them, so it is shown as it is written.
pub fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}'
            | '\u{061C}'
            | '\u{180E}'
            | '\u{FEFF}'
    )
}

/// A client's name made safe to show and to sign commits with: control
/// characters become spaces, angle brackets (which a commit's author cannot
/// hold) go, runs of white space shrink to one space, the ends lose spaces
/// and the marks git trims from a name, and at most [`NAME_MAX`] characters
/// stay. Nothing left is "agent".
pub fn clean_name(name: &str) -> String {
    let spaced: String = name
        .chars()
        .filter(|c| !matches!(c, '<' | '>') && !is_invisible(*c))
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let words = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let capped: String = words.chars().take(NAME_MAX).collect();
    let trimmed = capped.trim_matches(|c: char| {
        c.is_whitespace() || matches!(c, '.' | ',' | ':' | ';' | '"' | '\'' | '\\')
    });
    if trimmed.is_empty() {
        "agent".to_owned()
    } else {
        trimmed.to_owned()
    }
}

impl Session {
    /// A new session for `client` (a short name such as `claude-code`).
    pub fn start(client: &str, now: Instant) -> Session {
        let client: String = client
            .trim()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') {
                    c
                } else {
                    '-'
                }
            })
            .take(40)
            .collect();
        Session {
            id: ulid_at(now.millis),
            client: if client.is_empty() {
                "agent".to_owned()
            } else {
                client
            },
            started: now.millis,
        }
    }

    /// A new session named as the connecting client named itself (a routine
    /// says "routine: conference tracking"): the words kept, control
    /// characters and angle brackets gone, at most [`NAME_MAX`] characters.
    /// Two runs under one name are two sessions (their ids and start times
    /// differ), which is what the digest and History show.
    pub fn named(name: &str, now: Instant) -> Session {
        Session {
            id: ulid_at(now.millis),
            client: clean_name(name),
            started: now.millis,
        }
    }

    /// Who the session's commits are by.
    pub fn actor(&self) -> Actor {
        Actor::Agent {
            client: self.client.clone(),
            session: self.id.clone(),
        }
    }
}

/// What a session changed lately, for the soft limits.
#[derive(Debug, Clone, Default)]
pub struct Tally {
    /// Paths changed, with when.
    pub changed: Vec<(String, u64)>,
    pub trashed: usize,
    /// Slides taken out of decks (removed, or left empty), with when.
    slides: Vec<(usize, u64)>,
    /// Cards taken off boards (nodes removed), with when.
    nodes: Vec<(usize, u64)>,
    /// Pictures added: their size in bytes, with when.
    pictures: Vec<(u64, u64)>,
}

/// How long anything is remembered: no window is longer.
const MEMORY_MS: u64 = 3_600_000;

/// Whether changing `path` counts as changing a note: Kasten's own files do
/// not, and neither do the files in `assets/` (pictures with their sidecars,
/// two files each), which twenty figures for one deck would turn into forty
/// notes. Nor do the files of a smart page's code folder, one by one: a page is
/// built of many of them, so together they count as the one page (`record`).
fn counts_as_a_note(path: &str) -> bool {
    !path.starts_with(".kasten/")
        && !(path.starts_with("assets/") && !path.ends_with(".md"))
        && !crate::companions::in_folder(path)
}

impl Tally {
    pub fn record(&mut self, paths: &[String], now: u64) {
        for path in paths.iter().filter(|p| counts_as_a_note(p)) {
            self.changed.push((path.clone(), now));
        }
        // Writing files into many smart pages is changing many pages.
        for page in paths
            .iter()
            .filter_map(|p| crate::companions::page_of_member(p))
        {
            self.changed.push((page, now));
        }
        // Older entries no longer count for anything.
        self.changed
            .retain(|(_, at)| now.saturating_sub(*at) <= MEMORY_MS);
    }

    /// Notes that `count` slides were taken out of decks at `now`.
    pub fn took_out_slides(&mut self, count: usize, now: u64) {
        if count > 0 {
            self.slides.push((count, now));
        }
        self.slides
            .retain(|(_, at)| now.saturating_sub(*at) <= MEMORY_MS);
    }

    /// Slides taken out of decks within `window` milliseconds before `now`.
    pub fn slides_taken_out(&self, now: u64, window: u64) -> usize {
        self.slides
            .iter()
            .filter(|(_, at)| now.saturating_sub(*at) <= window)
            .map(|(n, _)| *n)
            .sum()
    }

    /// Notes that `count` cards were taken off boards at `now`.
    pub fn took_off_cards(&mut self, count: usize, now: u64) {
        if count > 0 {
            self.nodes.push((count, now));
        }
        self.nodes
            .retain(|(_, at)| now.saturating_sub(*at) <= MEMORY_MS);
    }

    /// Cards taken off boards within `window` milliseconds before `now`.
    pub fn cards_taken_off(&self, now: u64, window: u64) -> usize {
        self.nodes
            .iter()
            .filter(|(_, at)| now.saturating_sub(*at) <= window)
            .map(|(n, _)| *n)
            .sum()
    }

    /// Notes that a picture of `bytes` bytes was added at `now`.
    pub fn added_picture(&mut self, bytes: u64, now: u64) {
        self.pictures.push((bytes, now));
        self.pictures
            .retain(|(_, at)| now.saturating_sub(*at) <= MEMORY_MS);
    }

    /// How many pictures, and how many bytes of them, were added within `window` milliseconds before `now`.
    pub fn pictures_added(&self, now: u64, window: u64) -> (usize, u64) {
        self.pictures
            .iter()
            .filter(|(_, at)| now.saturating_sub(*at) <= window)
            .fold((0, 0), |(n, sum), (bytes, _)| (n + 1, sum + bytes))
    }

    /// Distinct paths changed within `window` milliseconds before `now`.
    pub fn recent(&self, now: u64, window: u64) -> BTreeSet<&str> {
        self.changed
            .iter()
            .filter(|(_, at)| now.saturating_sub(*at) <= window)
            .map(|(p, _)| p.as_str())
            .collect()
    }
}

const TRUST: &str = ".kasten/cache/trust.json";

/// Sessions a person trusted, with when the trust ends (a session is
/// trusted for an hour). Kept in the cache, shared by the app and
/// the MCP server.
pub fn load_trust(root: &Path) -> HashMap<String, u64> {
    std::fs::read_to_string(root.join(TRUST))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_trust(root: &Path, trust: &HashMap<String, u64>) -> Result<()> {
    let path = root.join(TRUST);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(trust).unwrap_or_else(|_| "{}".to_owned());
    write_atomic(&path, text.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_have_clean_client_names() {
        let s = Session::start("Claude Code / 1.0", Instant { millis: 1 });
        assert_eq!(s.client, "Claude-Code---1.0");
        assert_eq!(Session::start("  ", Instant { millis: 1 }).client, "agent");
        assert_eq!(s.id.len(), 26);
    }

    #[test]
    fn a_routines_name_keeps_its_words_and_loses_what_cannot_be_shown() {
        let now = Instant { millis: 5 };
        let routine = Session::named("routine: conference tracking", now);
        assert_eq!(routine.client, "routine: conference tracking");
        let odd = Session::named("  my\u{7}\u{1b}[31m agent\r\nKasten-Session: x <b>  ", now);
        assert_eq!(odd.client, "my [31m agent Kasten-Session: x b");
        assert!(!odd.client.chars().any(char::is_control));
        let long = Session::named(&"é".repeat(300), now);
        assert_eq!(long.client.chars().count(), NAME_MAX);
        // Marks that reverse or hide text cannot spoof a name in the digest.
        let spoof = Session::named("evil\u{202E}tnegA\u{200B}\u{FEFF} \u{2066}x\u{2069}", now);
        assert_eq!(spoof.client, "eviltnegA x");
        for blank in ["", "   ", "\u{7}\n", "<>", " . , ", "\u{200B}\u{202E}"] {
            assert_eq!(Session::named(blank, now).client, "agent", "{blank:?}");
        }
        // Two runs under one name are two sessions.
        let again = Session::named("routine: conference tracking", Instant { millis: 6 });
        assert_eq!(again.client, routine.client);
        assert_ne!(again.id, routine.id);
        assert_ne!(again.started, routine.started);
    }

    #[test]
    fn tallies_recent_distinct_paths() {
        let mut t = Tally::default();
        t.record(
            &[
                "a.md".into(),
                "b.md".into(),
                ".kasten/proposals/x.json".into(),
            ],
            1_000,
        );
        t.record(&["a.md".into()], 700_000);
        assert_eq!(
            t.recent(700_000, 600_000).into_iter().collect::<Vec<_>>(),
            ["a.md"]
        );
        assert_eq!(t.recent(700_000, 700_000).len(), 2);
    }

    #[test]
    fn slides_taken_out_and_pictures_added_are_counted_in_a_window() {
        let mut t = Tally::default();
        t.took_out_slides(2, 1_000);
        t.took_out_slides(0, 1_500);
        t.took_out_slides(3, 500_000);
        assert_eq!(t.slides_taken_out(500_000, 600_000), 5);
        // The first two fall out of a shorter window; nothing counts after an hour.
        assert_eq!(t.slides_taken_out(500_000, 100_000), 3);
        assert_eq!(t.slides_taken_out(4_000_000, 600_000), 0);
        t.added_picture(4_000, 10_000);
        t.added_picture(6_000, 20_000);
        assert_eq!(t.pictures_added(30_000, 600_000), (2, 10_000));
        assert_eq!(t.pictures_added(30_000, 15_000), (1, 6_000));
        assert_eq!(t.pictures_added(900_000, 600_000), (0, 0));
    }

    #[test]
    fn pictures_and_their_sidecars_are_not_notes() {
        let mut t = Tally::default();
        t.record(
            &[
                "assets/figure.png".into(),
                "assets/.meta/figure.png.json".into(),
                "library/talk.deck".into(),
            ],
            1_000,
        );
        assert_eq!(
            t.recent(1_000, 600_000).into_iter().collect::<Vec<_>>(),
            ["library/talk.deck"]
        );
    }
}
