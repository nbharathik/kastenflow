//! What the app does with its subscriptions: add, change and remove them,
//! refresh their copies, and answer for the events on a range of days. It
//! knows the store and the reader, not Tauri, so it is all tested here.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::fetch::{self, Validators};
use super::ics::expand::Occurrence;
use super::ics::parse::{self, Feed};
use super::ics::{MAX_OCCURRENCES, events_between};
pub use super::refresh::{Refresh, finish_refresh, plan_refresh, to_refresh};
use super::store::{
    DEFAULT_REFRESH, Entry, MAX_CALENDARS, MAX_REFRESH, MIN_REFRESH, Meta, Store, valid_id,
};

/// What the window is told about a subscription: never the address.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    pub name: String,
    pub color: String,
    pub refresh_minutes: u32,
    pub shown: bool,
    pub host: String,
    pub masked: String,
    /// When the copy was last known to be current (seconds since 1970).
    pub last_updated: Option<i64>,
    pub last_checked: Option<i64>,
    /// Why the last refresh failed; the events shown are the last copy.
    pub error: Option<String>,
}

fn info(entry: &Entry, meta: &Meta) -> Info {
    Info {
        id: entry.id.clone(),
        name: entry.name.clone(),
        color: entry.color.clone(),
        refresh_minutes: entry.refresh_minutes,
        shown: entry.shown,
        host: entry.host.clone(),
        masked: entry.masked.clone(),
        last_updated: meta.updated,
        last_checked: meta.checked,
        error: meta.error.clone(),
    }
}

pub fn infos(store: &Store) -> Result<Vec<Info>, String> {
    Ok(store
        .list()?
        .iter()
        .map(|e| info(e, &store.meta(&e.id)))
        .collect())
}

/// A change to a subscription; what is left out stays as it is.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Change {
    pub name: Option<String>,
    pub color: Option<String>,
    pub shown: Option<bool>,
    pub refresh_minutes: Option<u32>,
    /// A new address for the same calendar.
    pub url: Option<String>,
}

/// The parsed copies, kept so asking for a month does not read the file
/// again, and which calendars are being fetched.
#[derive(Clone, Default)]
pub struct Calendars {
    parsed: Arc<Mutex<HashMap<String, Arc<Feed>>>>,
    busy: Arc<Mutex<HashSet<String>>>,
}

/// The right to fetch one calendar; given back when it is dropped.
pub struct Claim {
    busy: Arc<Mutex<HashSet<String>>>,
    id: String,
}

impl Drop for Claim {
    fn drop(&mut self) {
        self.busy
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}

impl Calendars {
    fn held(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Feed>>> {
        self.parsed.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The right to fetch `id`, unless it is being fetched already: a refresh
    /// on a timer and one the person asked for never run side by side.
    pub fn claim(&self, id: &str) -> Option<Claim> {
        let mut busy = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        busy.insert(id.to_owned()).then(|| Claim {
            busy: Arc::clone(&self.busy),
            id: id.to_owned(),
        })
    }

    pub(super) fn put(&self, id: &str, feed: Feed) {
        self.held().insert(id.to_owned(), Arc::new(feed));
    }

    pub fn forget(&self, id: &str) {
        self.held().remove(id);
    }

    /// The feed's last copy, read from the cache folder the first time.
    fn feed(&self, store: &Store, id: &str) -> Option<Arc<Feed>> {
        if let Some(feed) = self.held().get(id) {
            return Some(Arc::clone(feed));
        }
        let feed = Arc::new(parse::parse(&store.read_feed(id)?).ok()?);
        self.held().insert(id.to_owned(), Arc::clone(&feed));
        Some(feed)
    }
}

fn clean_name(name: &str) -> String {
    name.trim().chars().take(80).collect()
}

fn clean_color(color: &str) -> Option<String> {
    let color = color.trim();
    let fine = !color.is_empty()
        && color.len() <= 24
        && color
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '#' | '_' | '-'));
    fine.then(|| color.to_owned())
}

fn clamp_refresh(minutes: u32) -> u32 {
    minutes.clamp(MIN_REFRESH, MAX_REFRESH)
}

/// A subscription that has been asked for and not yet fetched.
#[derive(Debug)]
pub struct New {
    pub name: String,
    pub url: String,
    pub color: String,
}

/// Checks what the person typed, before anything is fetched or kept.
pub fn check_new(store: &Store, name: &str, url: &str, color: &str) -> Result<New, String> {
    let list = store.list()?;
    if list.len() >= MAX_CALENDARS {
        return Err(format!("KastenFlow keeps up to {MAX_CALENDARS} calendars"));
    }
    let url = fetch::address(url)?;
    // The same address twice would show every event twice.
    if let Some(same) = list
        .iter()
        .find(|e| store.address(&e.id).is_ok_and(|have| have == url))
    {
        return Err(format!(
            "That calendar is already subscribed, as “{}”",
            same.name
        ));
    }
    Ok(New {
        name: clean_name(name),
        url,
        color: clean_color(color).unwrap_or_else(|| "blue".to_owned()),
    })
}

/// Keeps a fetched feed as a new subscription: after it has been read once,
/// so an address that is not a calendar is never kept. The address goes to
/// the keychain, the copy to the cache folder, the rest to the list.
pub fn save_new(
    store: &Store,
    calendars: &Calendars,
    new: New,
    text: &str,
    validators: Validators,
    now: i64,
) -> Result<Info, String> {
    let feed = parse::parse(text)?;
    let host = fetch::host_of(&new.url);
    let name = Some(clean_name(&new.name))
        .filter(|n| !n.is_empty())
        .or_else(|| {
            feed.name
                .as_deref()
                .map(clean_name)
                .filter(|n| !n.is_empty())
        })
        .unwrap_or_else(|| host.clone());
    let id = store.new_id()?;
    let entry = Entry {
        id: id.clone(),
        name,
        color: new.color,
        refresh_minutes: DEFAULT_REFRESH,
        shown: true,
        host,
        masked: fetch::masked(&new.url),
    };
    let meta = Meta {
        validators,
        checked: Some(now),
        updated: Some(now),
        error: None,
    };
    let kept = (|| {
        store.set_address(&id, &new.url)?;
        store.write_feed(&id, text)?;
        store.save_meta(&id, &meta)?;
        let entry = entry.clone();
        store.update(|list| {
            if list.len() >= MAX_CALENDARS {
                return Err(format!("KastenFlow keeps up to {MAX_CALENDARS} calendars"));
            }
            list.push(entry);
            Ok(())
        })
    })();
    if let Err(err) = kept {
        // Nothing half-kept: no address in the keychain, no copy.
        let _ = store.forget_address(&id);
        store.drop_cache(&id);
        return Err(err);
    }
    calendars.put(&id, feed);
    Ok(info(&entry, &meta))
}

/// Replaces the address, and the copy, of a subscription with those of a feed
/// just fetched from a new address.
pub fn replace_feed(
    store: &Store,
    calendars: &Calendars,
    id: &str,
    url: &str,
    text: &str,
    validators: Validators,
    now: i64,
) -> Result<(), String> {
    let feed = parse::parse(text)?;
    let entry = store.entry(id)?;
    let (host, masked) = (fetch::host_of(url), fetch::masked(url));
    store.set_address(id, url)?;
    store.write_feed(id, text)?;
    store.save_meta(
        id,
        &Meta {
            validators,
            checked: Some(now),
            updated: Some(now),
            error: None,
        },
    )?;
    store.update(|list| {
        if let Some(e) = list.iter_mut().find(|e| e.id == entry.id) {
            e.host = host;
            e.masked = masked;
        }
        Ok(())
    })?;
    calendars.put(id, feed);
    Ok(())
}

/// Applies a change other than a new address.
pub fn edit(store: &Store, id: &str, change: &Change) -> Result<Info, String> {
    store.update(|list| {
        let entry = list
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| "That calendar is not in the list".to_owned())?;
        if let Some(name) = &change.name {
            let name = clean_name(name);
            if !name.is_empty() {
                entry.name = name;
            }
        }
        if let Some(color) = change.color.as_deref().and_then(clean_color) {
            entry.color = color;
        }
        if let Some(shown) = change.shown {
            entry.shown = shown;
        }
        if let Some(minutes) = change.refresh_minutes {
            entry.refresh_minutes = clamp_refresh(minutes);
        }
        Ok(())
    })?;
    Ok(info(&store.entry(id)?, &store.meta(id)))
}

/// Removes a subscription and everything kept for it: its copy, and its
/// address in the keychain. The list and the copy go first, so a keychain
/// that will not answer cannot keep a calendar the person removed.
pub fn remove(store: &Store, calendars: &Calendars, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("That calendar is not in the list".into());
    }
    store.update(|list| {
        let before = list.len();
        list.retain(|e| e.id != id);
        if list.len() == before {
            return Err("That calendar is not in the list".to_owned());
        }
        Ok(())
    })?;
    store.drop_cache(id);
    calendars.forget(id);
    store.forget_address(id).map_err(|e| {
        format!(
            "The calendar was removed, but its address could not be removed from the keychain: {e}"
        )
    })
}

/// An event of one subscription.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEvent {
    /// The subscription it belongs to.
    pub calendar: String,
    #[serde(flatten)]
    pub event: Occurrence,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvents {
    pub events: Vec<ExternalEvent>,
    /// Some events are missing: there were too many to give.
    pub truncated: bool,
}

/// The events of every shown subscription on the days from `from` to `to`
/// (`2026-10-12`, both included), on the clock of the zone called `zone`.
pub fn events(
    store: &Store,
    calendars: &Calendars,
    from: &str,
    to: &str,
    zone: Option<&str>,
) -> Result<CalendarEvents, String> {
    let mut out = CalendarEvents::default();
    for entry in store.list()?.into_iter().filter(|e| e.shown) {
        let Some(feed) = calendars.feed(store, &entry.id) else {
            continue;
        };
        let made = events_between(&feed, from, to, zone)?;
        out.truncated |= made.truncated;
        out.events
            .extend(made.items.into_iter().map(|event| ExternalEvent {
                calendar: entry.id.clone(),
                event,
            }));
    }
    out.events.sort_by(|a, b| {
        a.event
            .start
            .cmp(&b.event.start)
            .then(b.event.all_day.cmp(&a.event.all_day))
            .then_with(|| a.event.title.cmp(&b.event.title))
            .then_with(|| a.calendar.cmp(&b.calendar))
    });
    if out.events.len() > MAX_OCCURRENCES {
        out.events.truncate(MAX_OCCURRENCES);
        out.truncated = true;
    }
    Ok(out)
}
