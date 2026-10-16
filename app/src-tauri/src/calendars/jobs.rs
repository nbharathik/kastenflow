//! Running refreshes: which calendars are fetched side by side, and what stops
//! them. A fetch that is stopped (the window closed, the app quitting) hangs up
//! and records nothing, because a copy is replaced only by a whole answer and
//! a failure is recorded only for an answer that came.

use std::time::{SystemTime, UNIX_EPOCH};

use tokio::task::JoinHandle;

use super::fetch::{self, Answer};
use super::service::{self, Calendars, Claim};
use super::store::Store;

/// Seconds since 1970.
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// Runs work that touches the keychain or the disk off the async threads, and
/// answers with an error instead of a panic.
pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || crate::crash::caught(work))
        .await
        .map_err(crate::crash::joined)?
}

/// A fetch under way. Dropping it stops the fetch: the connection is closed
/// and nothing that has come so far is kept.
struct Fetch(JoinHandle<Result<Answer, String>>);

impl Fetch {
    async fn answer(&mut self) -> Result<Answer, String> {
        match (&mut self.0).await {
            Ok(answer) => answer,
            Err(e) if e.is_panic() => Err(crate::crash::problem(&*e.into_panic())),
            Err(_) => Err("The refresh was stopped".into()),
        }
    }
}

impl Drop for Fetch {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Refreshes these calendars side by side, each answer recorded as it is
/// read by `clock`'s time. True when the window has something new to show.
/// Dropping the future stops every fetch still under way.
pub async fn refresh_ids(
    store: &Store,
    cal: &Calendars,
    ids: Vec<String>,
    clock: fn() -> i64,
) -> bool {
    let mut jobs = Vec::new();
    for id in ids {
        let Some(claim) = cal.claim(&id) else {
            continue;
        };
        let planned = {
            let (store, id) = (store.clone(), id.clone());
            blocking(move || service::plan_refresh(&store, &id)).await
        };
        let started = planned.and_then(|plan| cal.client_for(&plan.url).map(|c| (plan, c)));
        let job = match started {
            Ok((plan, client)) => {
                tokio::spawn(async move { fetch::get(&client, &plan.url, &plan.have).await })
            }
            Err(err) => tokio::spawn(async move { Err(err) }),
        };
        jobs.push((id, Fetch(job), claim));
    }
    let mut news = false;
    for (id, mut job, claim) in jobs {
        let answer = job.answer().await;
        let (store, cal) = (store.clone(), cal.clone());
        // The claim is given back once the answer is written.
        let done = blocking(move || {
            let _claim: Claim = claim;
            service::finish_refresh(&store, &cal, &id, answer, clock())
        })
        .await;
        news |= done.unwrap_or(false);
    }
    news
}
