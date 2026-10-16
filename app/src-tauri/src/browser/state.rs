//! Which browser webviews are alive. Each costs a web view process, so at
//! most four live at once: opening a fifth closes the one used least
//! recently (hidden ones first), and its tab keeps its address, so showing
//! the tab again loads it again. A view that stays hidden for a long time is
//! closed the same way (`stale`). The deck preview is one of the four, but a
//! tab never takes its place. Only labels made here are ever acted on.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::policy::PREVIEW;

/// The most webviews alive at once.
pub const MAX_LIVE: usize = 4;

struct Entry {
    id: String,
    url: String,
    used: u64,
    shown: bool,
    /// Since when the view has been hidden (while `shown` is false).
    hidden_at: Option<Instant>,
}

/// The registry. Calls are short and never made while a webview call is
/// waited for: webview events arrive on the main thread, which may be waiting
/// for a command that holds this.
#[derive(Default)]
pub struct Registry {
    live: Vec<Entry>,
    /// Where tabs whose webview was closed were; used again when they open.
    kept: HashMap<String, String>,
    clock: u64,
}

impl Registry {
    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    pub fn contains(&self, id: &str) -> bool {
        self.live.iter().any(|e| e.id == id)
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.live.len()
    }

    pub fn ids(&self) -> Vec<String> {
        self.live.iter().map(|e| e.id.clone()).collect()
    }

    /// The address of a live tab, else the one a closed one was at.
    pub fn url_of(&self, id: &str) -> Option<String> {
        self.live
            .iter()
            .find(|e| e.id == id)
            .map(|e| e.url.clone())
            .or_else(|| self.kept.get(id).cloned())
    }

    /// Whether `id` is alive and not hidden.
    pub fn shown(&self, id: &str) -> bool {
        self.live.iter().any(|e| e.id == id && e.shown)
    }

    /// Whether any view is on the screen: the only time a page can have the keyboard.
    pub fn any_shown(&self) -> bool {
        self.live.iter().any(|e| e.shown)
    }

    /// Makes room for a new webview: the id to close, if all are in use. The
    /// preview is never the one: it is what the person is looking at.
    pub fn room_for_one(&self) -> Option<String> {
        if self.live.len() < MAX_LIVE {
            return None;
        }
        self.live
            .iter()
            .filter(|e| e.id != PREVIEW)
            .min_by_key(|e| (e.shown, e.used))
            .map(|e| e.id.clone())
    }

    /// Notes a webview at `url`, shown now.
    pub fn add(&mut self, id: &str, url: &str) {
        let used = self.tick();
        self.live.retain(|e| e.id != id);
        self.kept.remove(id);
        self.live.push(Entry {
            id: id.to_owned(),
            url: url.to_owned(),
            used,
            shown: true,
            hidden_at: None,
        });
    }

    /// A tab was used (shown or moved).
    pub fn touch(&mut self, id: &str, shown: bool) {
        let used = self.tick();
        if let Some(entry) = self.live.iter_mut().find(|e| e.id == id) {
            entry.used = used;
            entry.shown = shown;
            if shown {
                entry.hidden_at = None;
            }
        }
    }

    /// The view was hidden at `now`. Hiding it again does not start the wait over.
    pub fn hidden(&mut self, id: &str, now: Instant) {
        if let Some(entry) = self.live.iter_mut().find(|e| e.id == id)
            && entry.shown
        {
            entry.shown = false;
            entry.hidden_at = Some(now);
        }
    }

    /// The views that have been hidden for `idle` or longer at `now`: they are
    /// closed, and their tabs keep their addresses.
    pub fn stale(&self, now: Instant, idle: Duration) -> Vec<String> {
        self.live
            .iter()
            .filter(|e| !e.shown)
            .filter(|e| {
                e.hidden_at
                    .is_some_and(|since| now.saturating_duration_since(since) >= idle)
            })
            .map(|e| e.id.clone())
            .collect()
    }

    /// The tab went to `url`.
    pub fn went(&mut self, id: &str, url: &str) {
        if let Some(entry) = self.live.iter_mut().find(|e| e.id == id) {
            entry.url = url.to_owned();
        }
    }

    /// The webview was closed to make room: its tab keeps its address.
    pub fn evicted(&mut self, id: &str) {
        if let Some(at) = self.live.iter().position(|e| e.id == id) {
            let entry = self.live.remove(at);
            self.kept.insert(entry.id, entry.url);
        }
    }

    /// The tab was closed for good.
    pub fn forget(&mut self, id: &str) {
        self.live.retain(|e| e.id != id);
        self.kept.remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn at_most_four_live_and_the_one_used_least_goes_first() {
        let mut r = Registry::default();
        for id in ["a", "b", "c", "d"] {
            assert_eq!(r.room_for_one(), None);
            r.add(id, &format!("https://{id}.example/"));
        }
        assert_eq!(r.len(), MAX_LIVE);
        // All shown: the least recently used.
        assert_eq!(r.room_for_one().as_deref(), Some("a"));
        r.touch("a", true);
        assert_eq!(r.room_for_one().as_deref(), Some("b"));
        // A hidden one goes before a shown one, however recently it was used.
        r.hidden("d", Instant::now());
        assert_eq!(r.room_for_one().as_deref(), Some("d"));
        r.evicted("d");
        assert_eq!(r.len(), 3);
        assert_eq!(r.room_for_one(), None);
        assert!(!r.contains("d"));
    }

    #[test]
    fn an_evicted_tab_keeps_its_address_until_it_opens_again_or_closes() {
        let mut r = Registry::default();
        r.add("a", "https://a.example/");
        r.went("a", "https://a.example/page-2");
        assert_eq!(r.url_of("a").as_deref(), Some("https://a.example/page-2"));
        r.evicted("a");
        assert!(!r.contains("a"));
        assert_eq!(r.url_of("a").as_deref(), Some("https://a.example/page-2"));
        r.add("a", "https://a.example/page-2");
        assert!(r.contains("a"));
        r.forget("a");
        assert_eq!(r.url_of("a"), None);
        // Strangers are not known, and changing them changes nothing.
        r.went("zzz", "https://x/");
        r.touch("zzz", true);
        r.hidden("zzz", Instant::now());
        r.evicted("zzz");
        assert_eq!(r.len(), 0);
        assert!(r.ids().is_empty());
    }

    #[test]
    fn adding_a_tab_twice_keeps_one() {
        let mut r = Registry::default();
        r.add("a", "https://one/");
        r.add("a", "https://two/");
        assert_eq!(r.ids(), ["a"]);
        assert_eq!(r.url_of("a").as_deref(), Some("https://two/"));
    }

    const TEN_MINUTES: Duration = Duration::from_secs(600);

    #[test]
    fn a_tab_hidden_past_the_idle_time_is_stale_and_keeps_its_address() {
        let start = Instant::now();
        let mut r = Registry::default();
        r.add("a", "https://a.example/");
        r.add("b", "https://b.example/");
        r.went("a", "https://a.example/deep");
        // Nothing is stale while every view is shown, however long ago it was made.
        assert!(r.stale(start + TEN_MINUTES * 5, TEN_MINUTES).is_empty());
        r.hidden("a", start);
        // Hidden, but not for long enough.
        assert!(
            r.stale(start + TEN_MINUTES - Duration::from_secs(1), TEN_MINUTES)
                .is_empty()
        );
        // Long enough: only the hidden one, and not the shown one.
        assert_eq!(r.stale(start + TEN_MINUTES, TEN_MINUTES), ["a"]);
        assert_eq!(r.stale(start + TEN_MINUTES * 3, TEN_MINUTES), ["a"]);
        // Closing it as stale keeps where it was, so showing the tab loads it again.
        r.evicted("a");
        assert!(!r.contains("a"));
        assert_eq!(r.url_of("a").as_deref(), Some("https://a.example/deep"));
        assert!(r.stale(start + TEN_MINUTES * 3, TEN_MINUTES).is_empty());
    }

    #[test]
    fn hiding_again_does_not_start_the_wait_over_and_showing_ends_it() {
        let start = Instant::now();
        let mut r = Registry::default();
        r.add("a", "https://a.example/");
        r.hidden("a", start);
        r.hidden("a", start + Duration::from_secs(500));
        assert_eq!(r.stale(start + TEN_MINUTES, TEN_MINUTES), ["a"]);
        // Shown again (the person came back to the tab): the clock is gone.
        r.touch("a", true);
        assert!(r.shown("a"));
        assert!(r.stale(start + TEN_MINUTES * 9, TEN_MINUTES).is_empty());
        // Hidden anew: counted from now.
        let later = start + TEN_MINUTES * 9;
        r.hidden("a", later);
        assert!(
            r.stale(later + Duration::from_secs(1), TEN_MINUTES)
                .is_empty()
        );
        assert_eq!(r.stale(later + TEN_MINUTES, TEN_MINUTES), ["a"]);
        // A stranger is never stale, and a clock that runs backwards is not an error.
        assert!(r.stale(start, TEN_MINUTES).is_empty());
        r.hidden("zzz", later);
        assert!(!r.shown("zzz"));
    }

    #[test]
    fn the_preview_counts_among_the_four_and_no_tab_takes_its_place() {
        let mut r = Registry::default();
        r.add(PREVIEW, "https://example.com/");
        for id in ["a", "b"] {
            r.add(id, &format!("https://{id}.example/"));
        }
        assert_eq!(r.room_for_one(), None);
        r.add("c", "https://c.example/");
        assert_eq!(r.len(), MAX_LIVE);
        // The preview was used first, yet it is not the one to go.
        assert_eq!(r.room_for_one().as_deref(), Some("a"));
        r.hidden("c", Instant::now());
        assert_eq!(r.room_for_one().as_deref(), Some("c"));
        // Asking to open the preview again is the same view, not a fifth.
        r.add(PREVIEW, "https://example.com/next");
        assert_eq!(r.len(), MAX_LIVE);
        assert_eq!(
            r.url_of(PREVIEW).as_deref(),
            Some("https://example.com/next")
        );
        assert!(r.shown(PREVIEW));
    }

    #[test]
    fn a_page_can_have_the_keyboard_only_while_some_view_is_on_the_screen() {
        let mut r = Registry::default();
        assert!(!r.any_shown());
        r.add("a", "https://a.example/");
        assert!(r.any_shown());
        r.hidden("a", Instant::now());
        assert!(!r.any_shown());
        r.add(PREVIEW, "https://example.com/");
        assert!(r.any_shown());
        r.evicted(PREVIEW);
        assert!(!r.any_shown());
    }

    #[test]
    fn a_hidden_preview_goes_stale_like_a_tab() {
        let start = Instant::now();
        let mut r = Registry::default();
        r.add(PREVIEW, "https://example.com/");
        r.hidden(PREVIEW, start);
        assert_eq!(r.stale(start + TEN_MINUTES, TEN_MINUTES), [PREVIEW]);
        r.forget(PREVIEW);
        assert!(r.stale(start + TEN_MINUTES, TEN_MINUTES).is_empty());
        assert_eq!(r.url_of(PREVIEW), None);
    }
}
