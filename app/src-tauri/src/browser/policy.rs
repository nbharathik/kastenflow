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
}
