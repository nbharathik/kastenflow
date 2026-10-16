//! The deck preview: a web page shown beside a slide, or over a presentation,
//! by a native webview the editor places over a box of its own. It is a
//! browser webview like a tab's (the browser's profile, its policy, no command
//! and no event of Kasten's) with the one id `preview`, which no tab may have.
//! There is one at a time and it counts among the four webviews that may be
//! alive. What it does (an address, a title, loading) is told to the main
//! window like a tab's, under that id.

use std::time::Instant;

use tauri::{AppHandle, Manager, State, Url, Webview};

use super::policy::{PREVIEW, PREVIEW_LABEL};
use super::view::Bounds;
use super::{Browser, Nav, create_view, keys, text, visit};

/// The address the preview may open: a web page the browser's policy allows.
/// A blank page is no page to preview.
fn address(address: &str) -> Result<Url, String> {
    let url = visit(address)?;
    if url.as_str() == "about:blank" {
        return Err("There is no page to preview".to_owned());
    }
    Ok(url)
}

/// The live webview of the preview, when the browser is on and it is open.
fn live(app: &AppHandle, browser: &Browser) -> Result<Webview, String> {
    browser.require_on()?;
    if !browser.reg(|r| r.contains(PREVIEW)) {
        return Err("The web preview is not open".to_owned());
    }
    app.get_webview(PREVIEW_LABEL).ok_or_else(|| {
        browser.reg(|r| r.forget(PREVIEW));
        keys::refresh(app);
        "The web preview went away".to_owned()
    })
}

/// Shows `url` at `bounds` (physical pixels of the window): opens the preview, or
/// moves the one that is open and takes it to `url`. Gives the address it shows.
#[tauri::command(async)]
pub fn preview_open(
    app: AppHandle,
    browser: State<'_, Browser>,
    url: String,
    bounds: Bounds,
) -> Result<String, String> {
    browser.require_on()?;
    let wanted = address(&url)?;
    if browser.reg(|r| r.contains(PREVIEW)) {
        if let Some(view) = app.get_webview(PREVIEW_LABEL) {
            view.set_bounds(bounds.rect()).map_err(text)?;
            if view.url().is_ok_and(|now| now != wanted) {
                view.navigate(wanted.clone()).map_err(text)?;
            }
            view.show().map_err(text)?;
            browser.reg(|r| {
                r.touch(PREVIEW, true);
                r.went(PREVIEW, wanted.as_str());
            });
            keys::refresh(&app);
            return Ok(wanted.to_string());
        }
        browser.reg(|r| r.forget(PREVIEW));
    }
    let shown = create_view(&app, &browser, PREVIEW, wanted, bounds)?;
    keys::refresh(&app);
    Ok(shown)
}

/// Moves and sizes the preview.
#[tauri::command(async)]
pub fn preview_bounds(
    app: AppHandle,
    browser: State<'_, Browser>,
    bounds: Bounds,
) -> Result<(), String> {
    let view = live(&app, &browser)?;
    view.set_bounds(bounds.rect()).map_err(text)?;
    browser.reg(|r| r.touch(PREVIEW, true));
    Ok(())
}

/// Back, forward, reload, or another address.
#[tauri::command(async)]
pub fn preview_nav(app: AppHandle, browser: State<'_, Browser>, nav: Nav) -> Result<(), String> {
    let view = live(&app, &browser)?;
    let done = match nav {
        Nav::Back => view.eval("history.back()"),
        Nav::Forward => view.eval("history.forward()"),
        Nav::Reload => view.reload(),
        Nav::Url { url } => view.navigate(address(&url)?),
    };
    done.map_err(text)
}

/// Takes the preview off the screen (something of the editor's is open over it).
#[tauri::command(async)]
pub fn preview_hide(app: AppHandle, browser: State<'_, Browser>) -> Result<(), String> {
    let view = live(&app, &browser)?;
    view.hide().map_err(text)?;
    browser.reg(|r| r.hidden(PREVIEW, Instant::now()));
    keys::refresh(&app);
    Ok(())
}

/// Puts the preview back on the screen.
#[tauri::command(async)]
pub fn preview_show(app: AppHandle, browser: State<'_, Browser>) -> Result<(), String> {
    let view = live(&app, &browser)?;
    view.show().map_err(text)?;
    browser.reg(|r| r.touch(PREVIEW, true));
    keys::refresh(&app);
    Ok(())
}

/// Closes the preview for good.
#[tauri::command(async)]
pub fn preview_close(app: AppHandle, browser: State<'_, Browser>) -> Result<(), String> {
    if browser.reg(|r| r.contains(PREVIEW)) {
        super::drop_view(&app, &browser, PREVIEW, false);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_opens_a_web_page_and_a_server_of_the_persons_own() {
        for ok in [
            "https://example.com/talk",
            "http://example.com/a?b=c#d",
            " https://example.com/ ",
            "http://localhost:3000/",
            "http://127.0.0.1:8080/demo",
        ] {
            assert!(address(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn an_address_the_browser_refuses_fails_the_preview_with_a_reason() {
        for bad in [
            "file:///C:/Windows/win.ini",
            "http://tauri.localhost/index.html",
            "tauri://localhost/",
            "http://ipc.localhost/",
            "http://asset.localhost/x",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "https://user:pw@example.com/",
            "https://kasten-capture.invalid/?n=x&d=y",
            "ftp://example.com/",
        ] {
            let why = address(bad).unwrap_err();
            assert!(why.contains("web pages only"), "{bad}: {why}");
        }
        assert!(
            address("not a url")
                .unwrap_err()
                .contains("not a web address")
        );
        assert!(address("").unwrap_err().contains("not a web address"));
        // Nothing to look at.
        assert!(address("about:blank").unwrap_err().contains("no page"));
    }

    #[test]
    fn the_previews_commands_are_named_apart_from_a_tabs() {
        // A tab's commands are `browser_*`; the preview's are `preview_*`, and a
        // tab's id can never be the preview's, so neither set reaches the other.
        assert_eq!(PREVIEW_LABEL, "web-preview");
        assert!(super::super::label_of(PREVIEW).is_err());
        assert!(super::super::label_of("t1abc").is_ok());
    }
}
