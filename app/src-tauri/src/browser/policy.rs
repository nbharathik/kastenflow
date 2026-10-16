//! Where the browser tab may go. A page in it is the open web and nothing
//! of Kasten's: it may load web pages (and `about:blank`), never Kasten's own
//! pages or the names the app serves its files from, never a local file, a
//! script or inline data. A server on this computer (`localhost:3000`) is
//! allowed: it is how a person looks at their own work.

use tauri::Url;

/// The label every browser webview has, then the tab's id.
pub const PREFIX: &str = "web-";

/// The tab id a webview's label names, if it is a browser webview.
pub fn id_of(label: &str) -> Option<&str> {
    label.strip_prefix(PREFIX).filter(|id| valid_id(id))
}

/// A tab id fit for a label: letters, digits, `_` and `-`, at most 64.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The id of the one web preview a deck's editor or a presentation opens. It
/// is a browser webview like a tab (same profile, same rules, no commands) but
/// no tab may take its id, so a tab's commands can never act on it.
pub const PREVIEW: &str = "preview";

/// The preview's label.
pub const PREVIEW_LABEL: &str = "web-preview";

/// A tab id: fit for a label, and not the preview's.
pub fn tab_id(id: &str) -> bool {
    valid_id(id) && id != PREVIEW
}

/// The most an address the tab navigates to may hold.
const MAX_URL: usize = 4096;

/// Whether the browser tab may show `url`.
pub fn may_visit(url: &Url) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    if !matches!(url.scheme(), "http" | "https")
        || url.as_str().len() > MAX_URL
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    // The names the app serves itself from (tauri.localhost, ipc.localhost,
    // asset.localhost, diagrams.localhost) and any other name below
    // `localhost`: never a page of the open web.
    if host.ends_with(".localhost") {
        return false;
    }
    // The page this app's window shows while it is being developed.
    if crate::guard::own_page(url) {
        return false;
    }
    // The capture's one-way channel is not a place.
    host != crate::browser::capture::SENTINEL_HOST
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(address: &str) -> bool {
        Url::parse(address.trim()).is_ok_and(|url| may_visit(&url))
    }

    #[test]
    fn the_open_web_and_a_blank_page_are_allowed() {
        for ok in [
            "https://example.com/",
            "http://example.com/a?b=c#d",
            "https://sub.example.co.uk:8443/x",
            "about:blank",
            // A server of the person's own.
            "http://localhost:3000/",
            "http://localhost/",
            "http://127.0.0.1:8080/app",
            "http://[::1]:5173/",
            "https://192.168.1.20/admin",
        ] {
            assert!(allowed(ok), "{ok}");
        }
    }

    #[test]
    fn kastens_own_pages_files_scripts_and_data_are_refused() {
        for bad in [
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/",
            "http://ipc.localhost/",
            "http://asset.localhost/C:/notes/a.png",
            "http://diagrams.localhost/index.html",
            "http://anything.localhost:3000/",
            "http://a.b.localhost/",
            "http://TAURI.LOCALHOST/",
            "http://tauri.localhost./",
            "tauri://localhost/",
            "ipc://localhost/",
            "asset://localhost/x",
            "diagrams://localhost/",
            "file:///C:/Windows/win.ini",
            "file:///etc/passwd",
            "data:text/html,<script>1</script>",
            "javascript:alert(1)",
            "blob:https://example.com/x",
            "ftp://example.com/",
            "view-source:https://example.com/",
            "about:srcdoc",
            "https://user:pass@example.com/",
            "https://user@example.com/",
            "https://kasten-capture.invalid/?n=x&d=y",
            "http://localhost:1420/",
        ] {
            // The dev server's port is Kasten's own page in a debug build only.
            if bad.contains(":1420") && !cfg!(debug_assertions) {
                continue;
            }
            assert!(!allowed(bad), "{bad}");
        }
        assert!(!allowed("not a url"));
        assert!(!allowed(""));
        assert!(!allowed(&format!(
            "https://example.com/{}",
            "a".repeat(5000)
        )));
    }

    #[test]
    fn a_tab_id_makes_a_label_and_the_label_gives_it_back() {
        assert_eq!(id_of("web-t1abc"), Some("t1abc"));
        assert_eq!(id_of("web-a_b-C9"), Some("a_b-C9"));
        for no in [
            "main",
            "capture",
            "presenter",
            "web-",
            "web-a b",
            "web-a/b",
            "web-é",
            "webx",
            "Web-a",
        ] {
            assert_eq!(id_of(no), None, "{no}");
        }
        assert!(!valid_id(&"a".repeat(65)));
        assert!(valid_id(&"a".repeat(64)));
    }

    #[test]
    fn the_preview_is_a_browser_webview_whose_id_no_tab_may_have() {
        assert_eq!(PREVIEW_LABEL, format!("{PREFIX}{PREVIEW}"));
        // Its label names a browser webview, so the guard holds it to the browser's rules.
        assert_eq!(id_of(PREVIEW_LABEL), Some(PREVIEW));
        assert!(valid_id(PREVIEW));
        assert!(!tab_id(PREVIEW));
        // Only that exact name is reserved.
        for tab in ["previews", "preview2", "Preview", "my-preview", "t1abc"] {
            assert!(tab_id(tab), "{tab}");
        }
        assert!(!tab_id(""));
        assert!(!tab_id("a b"));
    }
}
