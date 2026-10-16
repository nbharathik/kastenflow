//! The calendar commands the main window calls, and the timer that keeps the
//! copies fresh. Fetching and reading run off the window's thread; the
//! window is told with `calendars-changed` when something it shows changed.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

use super::fetch::{self, Answer, Validators};
use super::jobs::{blocking, now, refresh_ids};
use super::service::{self, CalendarEvents, Calendars, Change, Info, Refresh};
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

fn changed(app: &AppHandle) {
    let _ = app.emit_to(MAIN, CHANGED, ());
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
    let client = cal.client_for(&new.url)?;
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
        let client = cal.client_for(&url)?;
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
    if refresh_ids(&store, &cal, ids, now).await {
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
    if !ids.is_empty() && refresh_ids(&store, &cal, ids, now).await {
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
        let handlers = include_str!("../handlers.rs");
        for command in COMMANDS {
            assert!(
                handlers.contains(&format!("calendars::commands::{command},")),
                "{command}"
            );
        }
    }
}
