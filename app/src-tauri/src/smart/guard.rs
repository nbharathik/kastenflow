//! What a smart page's frame may do, which is nothing the window itself may.
//! The frame is a nested page of the main window, so the window's own checks
//! apply to it: it is loaded only from the `smart` scheme (below), it has no
//! window of its own so no command answers it (`may_call` knows only the
//! windows by name), and no capability names it. Besides these, the frame is
//! sandboxed without scripts' escape hatches (see `FRAME_SANDBOX` in the
//! window's code) and the policy of each answer allows no network.

use tauri::Url;

/// Whether `url` is a page or file served by the `smart` scheme: `smart://localhost/…`, or
/// `http://smart.localhost/…` where a web view knows only http and https.
/// It is not one of Kasten's own pages: a webview showing it can call no
/// command, and no capability names it.
pub fn smart_page_on(url: &Url, windows: bool) -> bool {
    let plain = url.port().is_none() && url.username().is_empty() && url.password().is_none();
    match url.scheme() {
        "smart" => !windows && plain && url.host_str() == Some("localhost"),
        "http" => windows && plain && url.host_str() == Some("smart.localhost"),
        _ => false,
    }
}

/// Whether `url` is a smart page on this system.
pub fn smart_page(url: &Url) -> bool {
    smart_page_on(url, cfg!(windows))
}
