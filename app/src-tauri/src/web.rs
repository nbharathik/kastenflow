//! The web outside the app: links open in the system's browser, since the
//! window itself opens none. Nothing here reads or writes the vault.

use std::process::Command;

/// Longer addresses are not links a person follows.
const MAX_URL: usize = 4096;

/// `url` when it is a web or mail address the browser may open: never a
/// file, a script or anything else a crafted page could slip in.
fn web_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let web =
        url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:");
    if !web || url.len() > MAX_URL || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("“{url}” is not a web address KastenFlow opens"));
    }
    Ok(if url.starts_with("mailto:") {
        mail_url(url)
    } else {
        url.to_owned()
    })
}

/// A mail link with only the fields a message needs: who it goes to, its
/// subject and its text. Mail apps have taken others, such as `attach`, as
/// files from this computer to send along.
fn mail_url(url: &str) -> String {
    let (to, query) = url.split_once('?').unwrap_or((url, ""));
    let kept: Vec<&str> = query
        .split('&')
        .filter(|field| {
            let name = field.split('=').next().unwrap_or("").to_ascii_lowercase();
            matches!(name.as_str(), "to" | "cc" | "bcc" | "subject" | "body")
        })
        .collect();
    if kept.is_empty() {
        to.to_owned()
    } else {
        format!("{to}?{}", kept.join("&"))
    }
}

/// The system's own way to open an address, run without a shell.
fn opener(url: &str) -> Command {
    #[cfg(target_os = "macos")]
    let command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(windows)]
    let command = {
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    command
}

/// Opens a web or mail address in the system's browser or mail app.
#[tauri::command(async)]
pub fn open_url(url: String) -> Result<(), String> {
    let url = web_url(&url)?;
    run_detached(opener(&url)).map_err(|e| format!("Could not open {url}: {e}"))
}

/// Starts `command` and lets it run on its own.
pub(crate) fn run_detached(mut command: Command) -> std::io::Result<()> {
    let mut child = command.spawn()?;
    // Reaped when it is done, so no process is left behind. A thread that
    // cannot start leaves it to the system, never a panic.
    let _ = std::thread::Builder::new()
        .name("kasten-opener".into())
        .spawn(move || {
            let _ = child.wait();
        });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_web_and_mail_addresses_only() {
        assert_eq!(
            web_url(" https://kasten.app/a?b=c#d ").unwrap(),
            "https://kasten.app/a?b=c#d"
        );
        assert!(web_url("http://example.com").is_ok());
        assert!(web_url("mailto:me@example.com").is_ok());
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "example.com",
            "https://a b",
            "https://a\nb",
            "",
        ] {
            assert!(web_url(bad).is_err(), "{bad}");
        }
        assert!(web_url(&format!("https://{}", "a".repeat(MAX_URL))).is_err());
    }

    #[test]
    fn a_mail_link_keeps_only_the_message() {
        assert_eq!(
            web_url("mailto:me@example.com?subject=Hi&attach=/etc/passwd&Body=Text&%61ttach=x")
                .unwrap(),
            "mailto:me@example.com?subject=Hi&Body=Text"
        );
        assert_eq!(
            web_url("mailto:me@example.com?attachment=~/.ssh/id_rsa").unwrap(),
            "mailto:me@example.com"
        );
        assert_eq!(
            web_url("mailto:a@example.com?cc=b@example.com&bcc=c@example.com").unwrap(),
            "mailto:a@example.com?cc=b@example.com&bcc=c@example.com"
        );
    }
}
