//! A keychain that does not look empty because it hiccuped. Reading the
//! system keychain can fail for a moment (a locked Secret Service, a
//! credential store that is busy); a read that fails is asked again after a
//! short wait, and one that keeps failing is answered with the last value
//! seen or written for that entry, so a sign-in or a key does not seem to
//! vanish. Nothing is kept anywhere but in memory.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::secrets::KeyStore;

/// The waits between the tries of one read.
const WAITS: [Duration; 2] = [Duration::from_millis(120), Duration::from_millis(400)];

pub struct Steady {
    inner: Arc<dyn KeyStore>,
    waits: Vec<Duration>,
    /// What each entry last held, as read or written.
    known: Mutex<HashMap<String, Option<String>>>,
}

impl Steady {
    pub fn new(inner: Arc<dyn KeyStore>) -> Steady {
        Steady::waiting(inner, WAITS.to_vec())
    }

    /// With these waits between the tries of a read.
    pub fn waiting(inner: Arc<dyn KeyStore>, waits: Vec<Duration>) -> Steady {
        Steady {
            inner,
            waits,
            known: Mutex::default(),
        }
    }

    fn remember(&self, entry: &str, value: Option<String>) {
        let mut known = self.known.lock().unwrap_or_else(|p| p.into_inner());
        known.insert(entry.to_owned(), value);
    }

    fn last_known(&self, entry: &str) -> Option<Option<String>> {
        let known = self.known.lock().unwrap_or_else(|p| p.into_inner());
        known.get(entry).cloned()
    }
}

impl KeyStore for Steady {
    fn get(&self, entry: &str) -> Result<Option<String>, String> {
        let mut failure = String::new();
        for (try_number, wait) in std::iter::once(&Duration::ZERO)
            .chain(&self.waits)
            .enumerate()
        {
            if try_number > 0 {
                std::thread::sleep(*wait);
            }
            match self.inner.get(entry) {
                Ok(value) => {
                    self.remember(entry, value.clone());
                    return Ok(value);
                }
                Err(err) => failure = err,
            }
        }
        // Still failing: what was last seen is a better answer than "nothing".
        self.last_known(entry).ok_or(failure)
    }

    fn set(&self, entry: &str, key: &str) -> Result<(), String> {
        self.inner.set(entry, key)?;
        self.remember(entry, Some(key.to_owned()));
        Ok(())
    }

    fn delete(&self, entry: &str) -> Result<(), String> {
        self.inner.delete(entry)?;
        self.remember(entry, None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::secrets::MemoryKeys;

    /// A keychain that fails its next `failures` reads.
    struct Hiccup {
        inner: MemoryKeys,
        failures: AtomicUsize,
        reads: AtomicUsize,
    }

    impl Hiccup {
        fn new(failures: usize) -> Arc<Hiccup> {
            Arc::new(Hiccup {
                inner: MemoryKeys::default(),
                failures: AtomicUsize::new(failures),
                reads: AtomicUsize::new(0),
            })
        }

        fn fail_next(&self, n: usize) {
            self.failures.store(n, Ordering::SeqCst);
        }
    }

    impl KeyStore for Hiccup {
        fn get(&self, entry: &str) -> Result<Option<String>, String> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            let left = self.failures.load(Ordering::SeqCst);
            if left > 0 {
                self.failures.store(left - 1, Ordering::SeqCst);
                return Err("The system keychain is not available: busy".to_owned());
            }
            self.inner.get(entry)
        }

        fn set(&self, entry: &str, key: &str) -> Result<(), String> {
            self.inner.set(entry, key)
        }

        fn delete(&self, entry: &str) -> Result<(), String> {
            self.inner.delete(entry)
        }
    }

    fn steady(raw: &Arc<Hiccup>) -> Steady {
        Steady::waiting(
            Arc::clone(raw) as Arc<dyn KeyStore>,
            vec![Duration::ZERO, Duration::ZERO],
        )
    }

    #[test]
    fn a_read_that_fails_for_a_moment_is_asked_again() {
        let raw = Hiccup::new(0);
        raw.set("a", "1").unwrap();
        let keys = steady(&raw);
        raw.fail_next(2);
        assert_eq!(keys.get("a").unwrap(), Some("1".to_owned()));
        assert_eq!(
            raw.reads.load(Ordering::SeqCst),
            3,
            "two failures, then it read"
        );
    }

    #[test]
    fn a_read_that_keeps_failing_gives_what_was_last_seen() {
        let raw = Hiccup::new(0);
        raw.set("a", "1").unwrap();
        let keys = steady(&raw);
        assert_eq!(keys.get("a").unwrap(), Some("1".to_owned()));
        raw.fail_next(100);
        assert_eq!(
            keys.get("a").unwrap(),
            Some("1".to_owned()),
            "an entry that was there does not seem to vanish"
        );
        // An entry never seen has nothing to fall back on: the error stands.
        assert!(keys.get("b").unwrap_err().contains("busy"));
        // Once the keychain is back, it is believed again.
        raw.fail_next(0);
        raw.delete("a").unwrap();
        assert_eq!(keys.get("a").unwrap(), None);
    }

    #[test]
    fn what_is_written_or_deleted_through_it_is_what_it_falls_back_to() {
        let raw = Hiccup::new(0);
        let keys = steady(&raw);
        keys.set("a", "new").unwrap();
        raw.fail_next(100);
        assert_eq!(keys.get("a").unwrap(), Some("new".to_owned()));
        raw.fail_next(0);
        keys.delete("a").unwrap();
        raw.fail_next(100);
        assert_eq!(keys.get("a").unwrap(), None);
    }
}
