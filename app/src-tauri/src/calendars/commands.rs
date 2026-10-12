//! The calendar commands the main window calls, and the timer that keeps the
//! copies fresh. Fetching and reading run off the window's thread; the
//! window is told with `calendars-changed` when something it shows changed.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};

use super::fetch::{self, Answer, Validators};
use super::service::{self, CalendarEvents, Calendars, Change, Claim, Info, Refresh};
use super::store::Store;
use crate::chat::commands::ChatState;
use crate::closing::MAIN;

/// What the window listens for.
const CHANGED: &str = "calendars-changed";
/// How long after start-up the first refresh may come.
const FIRST_LOOK: Duration = Duration::from_secs(15);
/// How often the timer looks at whose turn it is.
const TICK: Duration = Duration::from_secs(60);

fn store(app: &AppHandle, chat: &ChatState) -> Result<Store, String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("KastenFlow has no settings folder: {e}"))?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("KastenFlow has no cache folder: {e}"))?;
    Ok(Store::new(config, cache, chat.keys()))
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The client that suits an address: the web's, or the local network's when
/// the person typed such an address.
fn client_for(chat: &ChatState, url: &str) -> Result<reqwest::Client, String> {
    if fetch::is_local(url) {
        chat.local_web()
    } else {
        chat.web()
    }
}

/// Runs work that touches the keychain or the disk off the async threads, and
/// answers with an error instead of a panic.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || crate::crash::caught(work))
        .await
        .map_err(crate::crash::joined)?
}

fn changed(app: &AppHandle) {
    let _ = app.emit_to(MAIN, CHANGED, ());
}

/// Refreshes these calendars side by side. True when the window has
/// something new to show.
async fn refresh_ids(store: &Store, cal: &Calendars, chat: &ChatState, ids: Vec<String>) -> bool {
    let mut jobs = Vec::new();
    for id in ids {
        let Some(claim) = cal.claim(&id) else {
            continue;
        };
        let planned = {
            let (store, id) = (store.clone(), id.clone());
            blocking(move || service::plan_refresh(&store, &id)).await
        };
        let job = match planned {
            Ok(plan) => match client_for(chat, &plan.url) {
                Ok(client) => tauri::async_runtime::spawn(async move {
                    fetch::get(&client, &plan.url, &plan.have).await
                }),
                Err(err) => tauri::async_runtime::spawn(async move { Err(err) }),
            },
            Err(err) => tauri::async_runtime::spawn(async move { Err(err) }),
        };
        jobs.push((id, job, claim));
    }
    let mut news = false;
    for (id, job, claim) in jobs {
        let answer = job.await.unwrap_or_else(|e| Err(crate::crash::joined(e)));
        let (store, cal) = (store.clone(), cal.clone());
        // The claim is given back once the answer is written.
        let done = blocking(move || {
            let _claim: Claim = claim;
            service::finish_refresh(&store, &cal, &id, answer, now())
        })
        .await;
        news |= done.unwrap_or(false);
    }
    news
}

/// The subscriptions, without their addresses.
#[tauri::command]
pub async fn calendars_list(
    app: AppHandle,
    chat: State<'_, ChatState>,
) -> Result<Vec<Info>, String> {
    let store = store(&app, &chat)?;
    blocking(move || service::infos(&store)).await
}

/// Subscribes to the feed at `url`: it is fetched and read once first, so an
/// address that is not a calendar is never kept.
#[tauri::command]
pub async fn calendar_add(
    app: AppHandle,
    chat: State<'_, ChatState>,
    cal: State<'_, Calendars>,
    name: String,
    url: String,
    color: Option<String>,
) -> Result<Info, String> {
    let store = store(&app, &chat)?;
    let cal = cal.inner().clone();
    let new = {
        let store = store.clone();
        blocking(move || service::check_new(&store, &name, &url, color.as_deref().unwrap_or("")))
            .await?
    };
    let client = client_for(&chat, &new.url)?;
    let Answer::Fresh { text, validators } =
        fetch::get(&client, &new.url, &Validators::default()).await?
    else {
        return Err("The calendar's server gave nothing to read".into());
    };
    let info =
        blocking(move || service::save_new(&store, &cal, new, &text, validators, now())).await?;
    changed(&app);
    Ok(info)
}

/// Changes a subscription's name, colour, refresh time, shown or hidden, or
/// its address (fetched and read first, like a new one).
#[tauri::command]
pub async fn calendar_edit(
    app: AppHandle,
    chat: State<'_, ChatState>,
    cal: State<'_, Calendars>,
    id: String,
    change: Change,
) -> Result<Info, String> {
    let store = store(&app, &chat)?;
    let cal = cal.inner().clone();
    if let Some(typed) = change.url.clone().filter(|u| !u.trim().is_empty()) {
        let url = fetch::address(&typed)?;
        let client = client_for(&chat, &url)?;
        let Answer::Fresh { text, validators } =
            fetch::get(&client, &url, &Validators::default()).await?
        else {
            return Err("The calendar's server gave nothing to read".into());
        };
        let (store, cal, id) = (store.clone(), cal.clone(), id.clone());
        blocking(move || service::replace_feed(&store, &cal, &id, &url, &text, validators, now()))
            .await?;
    }
    let info = blocking(move || service::edit(&store, &id, &change)).await?;
    changed(&app);
    Ok(info)
}

/// Removes a subscription, its copy and its address in the keychain.
#[tauri::command]
pub async fn calendar_remove(
    app: AppHandle,
    chat: State<'_, ChatState>,
    cal: State<'_, Calendars>,
    id: String,
) -> Result<Vec<Info>, String> {
    let store = store(&app, &chat)?;
    let cal = cal.inner().clone();
    let removed = {
        let store = store.clone();
        blocking(move || service::remove(&store, &cal, &id)).await
    };
    changed(&app);
    removed?;
    blocking(move || service::infos(&store)).await
}

/// Refreshes one calendar, or every shown one; with `max_age_minutes`, only
/// those not asked for that recently. Answers with the subscriptions as they
/// are after.
#[tauri::command]
pub async fn calendar_refresh(
    app: AppHandle,
    chat: State<'_, ChatState>,
    cal: State<'_, Calendars>,
    id: Option<String>,
    max_age_minutes: Option<u32>,
) -> Result<Vec<Info>, String> {
    let store = store(&app, &chat)?;
    let cal = cal.inner().clone();
    let ids = match id {
        Some(id) => vec![id],
        None => {
            let which = max_age_minutes.map_or(Refresh::Always, Refresh::OlderThan);
            let store = store.clone();
            blocking(move || service::to_refresh(&store, now(), which)).await?
        }
    };
    if refresh_ids(&store, &cal, &chat, ids).await {
        changed(&app);
    }
    blocking(move || service::infos(&store)).await
}

/// The events of the shown calendars on the days from `from` to `to`
/// (`2026-10-12`, both included, at most about 400 days), on the clock of the
/// time zone named `zone` (the window's own).
#[tauri::command]
pub async fn calendar_events(
    app: AppHandle,
    chat: State<'_, ChatState>,
    cal: State<'_, Calendars>,
    from: String,
    to: String,
    zone: Option<String>,
) -> Result<CalendarEvents, String> {
    let store = store(&app, &chat)?;
    let cal = cal.inner().clone();
    blocking(move || service::events(&store, &cal, &from, &to, zone.as_deref())).await
}

/// Refreshes the calendars whose time has come.
async fn tick(app: &AppHandle) {
    let chat = app.state::<ChatState>();
    let cal = app.state::<Calendars>();
    let Ok(store) = store(app, &chat) else {
        return;
    };
    let ids = {
        let store = store.clone();
        blocking(move || service::to_refresh(&store, now(), Refresh::Due))
            .await
            .unwrap_or_default()
    };
    if !ids.is_empty() && refresh_ids(&store, &cal, &chat, ids).await {
        changed(app);
    }
}

/// Keeps the copies fresh while the app runs: every calendar is looked at on
/// its own refresh time, and nothing is fetched when there are none.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_LOOK).await;
        loop {
            tick(&app).await;
            tokio::time::sleep(TICK).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use crate::guard::may_call;

    const COMMANDS: &[&str] = &[
        "calendars_list",
        "calendar_add",
        "calendar_edit",
        "calendar_remove",
        "calendar_refresh",
        "calendar_events",
    ];

    #[test]
    fn only_the_main_window_may_call_the_calendar_commands() {
        for command in COMMANDS {
            assert!(may_call("main", command), "{command}");
            assert!(!may_call("capture", command), "{command}");
            assert!(!may_call("presenter", command), "{command}");
            assert!(!may_call("somewhere-else", command), "{command}");
        }
    }

    #[test]
    fn the_commands_are_registered_and_none_is_missing() {
        let lib = include_str!("../lib.rs");
        for command in COMMANDS {
            assert!(
                lib.contains(&format!("calendars::commands::{command},")),
                "{command}"
            );
        }
    }
}
