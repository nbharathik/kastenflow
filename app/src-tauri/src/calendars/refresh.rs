//! Refreshing the copies of subscribed calendars: which are due, what to ask
//! for, and what to record of the answer. A copy is replaced only by one that
//! reads as a calendar, and a failed refresh keeps the last copy and says why.

use super::fetch::{Answer, Validators};
use super::ics::parse;
use super::service::Calendars;
use super::store::{Entry, Meta, Store};

/// Which subscriptions a refresh is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refresh {
    /// Every shown calendar, now.
    Always,
    /// Those not asked for in the last so many minutes.
    OlderThan(u32),
    /// Those whose own refresh time has come.
    Due,
}

/// Whether a subscription is to be fetched now.
pub fn wanted(entry: &Entry, meta: &Meta, now: i64, which: Refresh) -> bool {
    if !entry.shown {
        return false;
    }
    let minutes = match which {
        Refresh::Always => return true,
        Refresh::OlderThan(minutes) => minutes,
        Refresh::Due => entry.refresh_minutes,
    };
    meta.checked
        .is_none_or(|at| now - at >= i64::from(minutes) * 60)
}

/// The subscriptions to refresh now.
pub fn to_refresh(store: &Store, now: i64, which: Refresh) -> Result<Vec<String>, String> {
    Ok(store
        .list()?
        .into_iter()
        .filter(|e| wanted(e, &store.meta(&e.id), now, which))
        .map(|e| e.id)
        .collect())
}

/// What to ask for to refresh a subscription: where, and what is held.
pub struct Plan {
    pub url: String,
    pub have: Validators,
}

pub fn plan_refresh(store: &Store, id: &str) -> Result<Plan, String> {
    store.entry(id)?;
    let have = if store.read_feed(id).is_some() {
        store.meta(id).validators
    } else {
        // No copy to be unchanged from.
        Validators::default()
    };
    Ok(Plan {
        url: store.address(id)?,
        have,
    })
}

/// Records what a fetch found. True when the window has something new to show:
/// a new copy, or a change in whether the last refresh worked.
pub fn finish_refresh(
    store: &Store,
    calendars: &Calendars,
    id: &str,
    answer: Result<Answer, String>,
    now: i64,
) -> Result<bool, String> {
    store.entry(id)?;
    let mut meta = store.meta(id);
    let had_error = meta.error.clone();
    meta.checked = Some(now);
    let answer = answer.and_then(|answer| match answer {
        Answer::Unchanged => Ok(None),
        Answer::Fresh { text, validators } => {
            let feed = parse::parse(&text)?;
            Ok(Some((text, validators, feed)))
        }
    });
    let mut changed = false;
    match answer {
        Ok(None) => {
            meta.updated = Some(now);
            meta.error = None;
        }
        Ok(Some((text, validators, feed))) => {
            store.write_feed(id, &text)?;
            meta.validators = validators;
            meta.updated = Some(now);
            meta.error = None;
            calendars.put(id, feed);
            changed = true;
        }
        Err(message) => meta.error = Some(message),
    }
    changed |= had_error != meta.error;
    store.save_meta(id, &meta)?;
    Ok(changed)
}
