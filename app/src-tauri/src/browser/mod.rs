//! The browser tab: a web page of its own inside Kasten, shown by a native
//! webview laid over the tab's placeholder. It is off until the person turns
//! it on in Settings. The page inside is the open web and nothing of
//! Kasten's: it has its own browsing profile, can call no command, hears no
//! event, may visit only what `policy` allows, and is read only when the
//! person clicks Capture, through a one-time nonce (`capture`).
//!
//! Webviews are made from async commands (a window made from a synchronous
//! command can deadlock on Windows), at most four live at once, and a command
//! acts only on a webview this module made.

mod capture;
pub(crate) mod flow;
pub(crate) mod policy;
#[cfg(test)]
mod rules;
mod script;
mod state;
mod view;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use serde::Deserialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, State, Url, Webview};
use tokio::sync::oneshot;

use crate::app_settings::AppSettings;
use crate::closing::MAIN;
use capture::{Answer, Kind, Previews, Refused, Sessions, Titled};
use state::Registry;
use view::{Bounds, Event, tell};

type Waiter = oneshot::Sender<Result<(Answer, Kind), Refused>>;

/// The browser's state, managed by the app.
#[derive(Default)]
pub struct Browser {
    on: AtomicBool,
    registry: Mutex<Registry>,
    sessions: Mutex<Sessions>,
    waiters: Mutex<HashMap<String, Waiter>>,
    previews: Mutex<Previews>,
}

fn held<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl Browser {
    fn require_on(&self) -> Result<(), String> {
        if self.on.load(Ordering::Relaxed) {
            Ok(())
        } else {
            Err("The browser is off. Turn it on in Settings, under Browser".to_owned())
        }
    }

    /// Runs `f` on the registry; nothing outside calls a webview while it runs.
    fn reg<T>(&self, f: impl FnOnce(&mut Registry) -> T) -> T {
        f(&mut held(&self.registry))
    }

    fn went(&self, id: &str, url: &str) {
        self.reg(|r| r.went(id, url));
    }

    fn titled(&self, label: &str, title: &str, now: Instant) -> Titled {
        held(&self.sessions).titled(label, title, now)
    }

    fn sentinel(
        &self,
        label: &str,
        url: &Url,
        now: Instant,
    ) -> Option<Result<(Answer, Kind), Refused>> {
        held(&self.sessions).sentinel(label, url, now)
    }

    /// The script's own result came back for tab `label`.
    fn answer(&self, label: &str, bytes: &[u8], now: Instant) {
        let result = held(&self.sessions).accept(label, bytes, now);
        self.deliver(label, result);
    }

    /// Gives a capture's waiting command what came back. A refusal that left the
    /// request alive (junk, a wrong nonce) is not an answer: the request goes on.
    fn deliver(&self, label: &str, result: Result<(Answer, Kind), Refused>) {
        if result.is_err() && held(&self.sessions).waiting(label) {
            return;
        }
        if let Some(waiter) = held(&self.waiters).remove(label) {
            let _ = waiter.send(result);
        }
    }
}

/// Reads the saved switch when the app starts.
pub fn start(app: &AppHandle) {
    let on = app
        .path()
        .app_config_dir()
        .map(|dir| AppSettings::load(&dir).browser_on())
        .unwrap_or(false);
    app.state::<Browser>().on.store(on, Ordering::Relaxed);
}

/// A navigation in a browser webview that is a capture's answer: read, then
/// always cancelled. False for any other navigation.
pub fn answered<R: Runtime>(webview: &Webview<R>, url: &Url) -> bool {
    if !capture::is_sentinel(url) || policy::id_of(webview.label()).is_none() {
        return false;
    }
    if let Some(browser) = webview.try_state::<Browser>() {
        let label = webview.label().to_owned();
        if let Some(result) = browser.sentinel(&label, url, Instant::now()) {
            let _ = webview.eval(script::seen());
            browser.deliver(&label, result);
        }
    }
    true
}

fn label_of(id: &str) -> Result<String, String> {
    if policy::valid_id(id) {
        Ok(format!("{}{id}", policy::PREFIX))
    } else {
        Err("That is not a browser tab".to_owned())
    }
}

fn text(err: tauri::Error) -> String {
    err.to_string()
}

/// A web address the tab may visit, or why not.
fn visit(address: &str) -> Result<Url, String> {
    let url = Url::parse(address.trim())
        .map_err(|_| format!("“{}” is not a web address", address.trim()))?;
    if policy::may_visit(&url) {
        Ok(url)
    } else {
        Err("The browser opens web pages only, never KastenFlow's own or a file".to_owned())
    }
}

/// The live webview of tab `id`, when this module made it and the browser is on.
fn live<R: Runtime>(app: &AppHandle<R>, browser: &Browser, id: &str) -> Result<Webview<R>, String> {
    browser.require_on()?;
    let label = label_of(id)?;
    if !browser.reg(|r| r.contains(id)) {
        return Err("That browser tab is not open".to_owned());
    }
    app.get_webview(&label).ok_or_else(|| {
        browser.reg(|r| r.forget(id));
        "That browser tab went away".to_owned()
    })
}

/// Closes a webview of ours; `evicted` keeps its tab's address.
fn drop_view(app: &AppHandle, browser: &Browser, id: &str, evicted: bool) {
    let label = format!("{}{id}", policy::PREFIX);
    if let Some(view) = app.get_webview(&label) {
        let _ = view.close();
    }
    held(&browser.sessions).cancel(&label);
    held(&browser.waiters).remove(&label);
    if evicted {
        browser.reg(|r| r.evicted(id));
        tell(app, Event::new(id, "closed"));
    } else {
        browser.reg(|r| r.forget(id));
    }
}

/// Shows tab `id`'s page at `bounds` (physical pixels of the window), making
/// its webview if there is none (the least recently used goes when four are
/// alive). Gives the address it shows.
#[tauri::command(async)]
pub fn browser_open(
    app: AppHandle,
    browser: State<'_, Browser>,
    id: String,
    url: String,
    bounds: Bounds,
) -> Result<String, String> {
    browser.require_on()?;
    let label = label_of(&id)?;
    let known = browser.reg(|r| r.url_of(&id));
    let wanted = if url.trim().is_empty() {
        known.unwrap_or_else(|| "about:blank".to_owned())
    } else {
        url
    };
    let wanted = visit(&wanted)?;
    if browser.reg(|r| r.contains(&id)) {
        if let Some(view) = app.get_webview(&label) {
            view.set_bounds(bounds.rect()).map_err(text)?;
            view.show().map_err(text)?;
            browser.reg(|r| r.touch(&id, true));
            return Ok(view
                .url()
                .map_or_else(|_| wanted.to_string(), |u| u.to_string()));
        }
        browser.reg(|r| r.forget(&id));
    }
    let old = browser.reg(|r| r.room_for_one());
    if let Some(old) = old {
        drop_view(&app, &browser, &old, true);
    }
    let window = app.get_window(MAIN).ok_or("The window is not there")?;
    let b = bounds.clamped();
    let made = view::builder(&app, &id, wanted.clone(), view::profile_dir(&app)?);
    window
        .add_child(
            made,
            PhysicalPosition::new(b.x, b.y),
            PhysicalSize::new(b.width, b.height),
        )
        .map_err(|e| format!("The browser could not start: {e}"))?;
    browser.reg(|r| r.add(&id, wanted.as_str()));
    Ok(wanted.to_string())
}

/// Moves and sizes tab `id`'s webview.
#[tauri::command(async)]
pub fn browser_bounds(
    app: AppHandle,
    browser: State<'_, Browser>,
    id: String,
    bounds: Bounds,
) -> Result<(), String> {
    let view = live(&app, &browser, &id)?;
    view.set_bounds(bounds.rect()).map_err(text)?;
    browser.reg(|r| r.touch(&id, true));
    Ok(())
}

/// Hides tab `id`'s webview (a menu is over it, or another tab is shown).
#[tauri::command(async)]
pub fn browser_hide(app: AppHandle, browser: State<'_, Browser>, id: String) -> Result<(), String> {
    let view = live(&app, &browser, &id)?;
    view.hide().map_err(text)?;
    browser.reg(|r| r.hidden(&id));
    Ok(())
}

/// Shows tab `id`'s webview again.
#[tauri::command(async)]
pub fn browser_show(app: AppHandle, browser: State<'_, Browser>, id: String) -> Result<(), String> {
    let view = live(&app, &browser, &id)?;
    view.show().map_err(text)?;
    browser.reg(|r| r.touch(&id, true));
    Ok(())
}

/// Closes tab `id`'s webview for good (its tab is closed).
#[tauri::command(async)]
pub fn browser_close(
    app: AppHandle,
    browser: State<'_, Browser>,
    id: String,
) -> Result<(), String> {
    label_of(&id)?;
    if browser.reg(|r| r.contains(&id)) {
        drop_view(&app, &browser, &id, false);
    }
    Ok(())
}

/// What a tab's bar asks the page to do.
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Nav {
    Back,
    Forward,
    Reload,
    Url { url: String },
}

/// Back, forward, reload, or an address.
#[tauri::command(async)]
pub fn browser_nav(
    app: AppHandle,
    browser: State<'_, Browser>,
    id: String,
    nav: Nav,
) -> Result<(), String> {
    let view = live(&app, &browser, &id)?;
    let done = match nav {
        Nav::Back => view.eval("history.back()"),
        Nav::Forward => view.eval("history.forward()"),
        Nav::Reload => view.reload(),
        Nav::Url { url } => view.navigate(visit(&url)?),
    };
    done.map_err(text)
}

/// Whether the browser is on (the saved switch).
#[tauri::command(async)]
pub fn browser_enabled(app: AppHandle) -> Result<bool, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(AppSettings::load(&dir).browser_on())
}

/// Turns the browser on or off. Off closes every browser webview.
#[tauri::command(async)]
pub fn set_browser_enabled(
    app: AppHandle,
    browser: State<'_, Browser>,
    on: bool,
) -> Result<bool, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    AppSettings::update(&dir, |s| s.browser = Some(on)).map_err(|e| e.to_string())?;
    browser.on.store(on, Ordering::Relaxed);
    if !on {
        for id in browser.reg(|r| r.ids()) {
            drop_view(&app, &browser, &id, false);
        }
        *held(&browser.previews) = Previews::default();
    }
    Ok(on)
}

/// Forgets the browser's cookies, history and cache: its own profile, never
/// the app's. A webview is needed to ask; with none alive a blank one is made
/// for the moment.
#[tauri::command(async)]
pub fn browser_clear_data(app: AppHandle, browser: State<'_, Browser>) -> Result<(), String> {
    browser.require_on()?;
    let first = browser.reg(|r| r.ids().into_iter().next());
    if let Some(id) = first
        && let Some(view) = app.get_webview(&format!("{}{id}", policy::PREFIX))
    {
        return view.clear_all_browsing_data().map_err(text);
    }
    let window = app.get_window(MAIN).ok_or("The window is not there")?;
    let blank = Url::parse("about:blank").map_err(|e| e.to_string())?;
    let made = view::builder(&app, "clearing", blank, view::profile_dir(&app)?);
    let view = window
        .add_child(
            made,
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1u32, 1u32),
        )
        .map_err(|e| format!("The browser's data could not be reached: {e}"))?;
    let _ = view.hide();
    let cleared = view.clear_all_browsing_data().map_err(text);
    let _ = view.close();
    cleared
}
