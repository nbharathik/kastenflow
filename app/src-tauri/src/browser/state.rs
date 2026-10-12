//! Which browser webviews are alive. Each costs a web view process, so at
//! most four live at once: opening a fifth closes the one used least
//! recently (hidden ones first), and its tab keeps its address, so showing
//! the tab again loads it again. Only labels made here are ever acted on.

use std::collections::HashMap;

/// The most webviews alive at once.
pub const MAX_LIVE: usize = 4;

struct Entry {
    id: String,
    url: String,
    used: u64,
    shown: bool,
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

    /// Makes room for a new webview: the id to close, if all are in use.
    pub fn room_for_one(&self) -> Option<String> {
        if self.live.len() < MAX_LIVE {
            return None;
        }
        self.live
            .iter()
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
        });
    }

    /// A tab was used (shown or moved).
    pub fn touch(&mut self, id: &str, shown: bool) {
        let used = self.tick();
        if let Some(entry) = self.live.iter_mut().find(|e| e.id == id) {
            entry.used = used;
            entry.shown = shown;
        }
    }

    pub fn hidden(&mut self, id: &str) {
        if let Some(entry) = self.live.iter_mut().find(|e| e.id == id) {
            entry.shown = false;
        }
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
        r.hidden("d");
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
        r.hidden("zzz");
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
}
