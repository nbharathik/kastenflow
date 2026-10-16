//! Starting the browser: the program and its flags, a profile folder of its own, and its sandbox.
//!
//! The browser decodes the pictures a deck names, and a deck can come from an agent, so its sandbox is what stands
//! between a hostile picture and this user's files. It is on unless the person switches it off on purpose
//! (`SLIDES_RENDER_NO_SANDBOX=1`, for a container that is itself the boundary they trust); it is never switched off
//! because something failed, and a browser that will not start with it says so and names the setting.

use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::error::CdpError;

use crate::bundle;
use crate::error::{Error, Result, cdp_message};
use crate::profile::{self, SLOTS, Slot};

/// How to start a browser.
#[derive(Clone)]
pub struct Config {
    pub browser: PathBuf,
    pub page: bundle::Page,
    /// Where to keep profiles before the usual places (see [`profile::bases`]).
    pub profiles: Option<PathBuf>,
    /// How long one call to the browser may take.
    pub timeout: Duration,
    pub sandbox: Sandbox,
}

/// Whether the browser runs in its sandbox.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sandbox {
    On,
    Off,
}

/// The setting that switches the sandbox off.
pub const NO_SANDBOX: &str = "SLIDES_RENDER_NO_SANDBOX";

/// What is said, once in a program, when the sandbox is off.
const UNSANDBOXED: &str = "warning: SLIDES_RENDER_NO_SANDBOX is set, so the browser that draws slides runs without its sandbox: a hostile picture in a deck could take it over. Use this only where the container or machine is the boundary you trust.";

/// Whether the sandbox is on for a launch. It is unless `explicit` (what the program that uses this crate says) or,
/// when that says nothing, the setting `SLIDES_RENDER_NO_SANDBOX=1` switches it off. As the administrator the browser
/// cannot use its sandbox, and the person is told so instead of the sandbox being dropped for them.
pub fn sandbox_for(
    explicit: Option<bool>,
    variable: Option<&OsStr>,
    root: bool,
) -> std::result::Result<Sandbox, String> {
    let off = explicit.unwrap_or_else(|| variable == Some(OsStr::new("1")));
    if off {
        Ok(Sandbox::Off)
    } else if root {
        Err(format!(
            "it will not run its sandbox as the administrator (root), and the sandbox is what keeps a damaged or hostile picture in a deck from taking over the browser, so KastenFlow Slides does not switch it off for you. Run as an ordinary user; in a container or on a machine that is itself the boundary you trust, set {NO_SANDBOX}=1 to run the browser without its sandbox."
        ))
    } else {
        Ok(Sandbox::On)
    }
}

/// Says `UNSANDBOXED` through `out`, the first time this is called with `said`.
fn say_once(said: &AtomicBool, out: impl FnOnce(&str)) {
    if !said.swap(true, Ordering::Relaxed) {
        out(UNSANDBOXED);
    }
}

/// Tells the person, once in this program, that a browser is about to run without its sandbox.
pub fn warn_unsandboxed() {
    static SAID: AtomicBool = AtomicBool::new(false);
    say_once(&SAID, |line| eprintln!("{line}"));
}

/// Why a browser that stopped before it was ready did, as an error. A complaint about the sandbox is answered with
/// the setting that would switch it off, and never by switching it off. So is a stop without a word with the sandbox
/// on: a browser that stops at once can be gone before what it wrote is read, and the sandbox is the likely reason.
pub fn launch_failure(sandbox_on: bool, status: &str, stderr: &[u8]) -> Error {
    let text = String::from_utf8_lossy(stderr).to_lowercase();
    if sandbox_on && (text.contains("sandbox") || text.contains("as root")) {
        return Error::Launch(format!(
            "its sandbox could not start here (it said: {}). KastenFlow Slides does not run the browser without its sandbox unless you say so: in a container or on a machine that is itself the boundary you trust, set {NO_SANDBOX}=1.",
            said(stderr)
        ));
    }
    if sandbox_on && said(stderr).is_empty() {
        return Error::Launch(format!(
            "it stopped ({status}) before it was ready, without saying why. If its sandbox could not start here: KastenFlow Slides does not run the browser without its sandbox unless you say so; in a container or on a machine that is itself the boundary you trust, set {NO_SANDBOX}=1."
        ));
    }
    Error::Launch(format!(
        "it stopped ({status}) before it was ready. It said: {}",
        said(stderr)
    ))
}

/// What the browser is started with: nothing to phone home, nothing to show, the same text layout everywhere.
const ARGS: &[&str] = &[
    "disable-gpu",
    "disable-dev-shm-usage",
    "disable-background-networking",
    "disable-background-timer-throttling",
    "disable-backgrounding-occluded-windows",
    "disable-renderer-backgrounding",
    "disable-breakpad",
    "disable-client-side-phishing-detection",
    "disable-component-update",
    "disable-default-apps",
    "disable-domain-reliability",
    "disable-hang-monitor",
    "disable-ipc-flooding-protection",
    "disable-popup-blocking",
    "disable-prompt-on-repost",
    "disable-sync",
    "font-render-hinting=none",
    "force-color-profile=srgb",
    "metrics-recording-only",
    "no-first-run",
    "no-default-browser-check",
    "no-proxy-server",
    "password-store=basic",
    "use-mock-keychain",
    "lang=en-US",
    "host-resolver-rules=MAP * ~NOTFOUND",
    "disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication",
];

/// What a browser that would not start said, boiled down: its last few lines, without the noise of a machine that has no bus.
fn said(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.contains("dbus") && !l.contains("DBus"))
        .collect();
    let start = lines.len().saturating_sub(3);
    lines[start..].join(" / ")
}

pub async fn start(config: &Config) -> Result<(Browser, chromiumoxide::Handler, Slot)> {
    let mut bases: Vec<PathBuf> = config.profiles.iter().cloned().collect();
    bases.extend(profile::bases(&profile::BROWSER, |name| {
        std::env::var_os(name)
    }));
    let mut skip: Vec<usize> = Vec::new();
    if config.sandbox == Sandbox::Off {
        warn_unsandboxed();
    }
    for _ in 0..SLOTS.min(8) {
        let slot = profile::claim(&profile::BROWSER, &bases, &skip)
            .map_err(|e| Error::Launch(format!("no place to keep the browser's profile: {e}")))?;
        let mut builder = BrowserConfig::builder()
            .chrome_executable(&config.browser)
            .user_data_dir(&slot.dir)
            .new_headless_mode()
            .disable_default_args()
            .viewport(None)
            .launch_timeout(Duration::from_secs(30))
            .request_timeout(config.timeout)
            .args(ARGS.iter().copied());
        if config.sandbox == Sandbox::Off {
            builder = builder.no_sandbox();
        }
        let launch = builder.build().map_err(Error::Launch)?;
        let (status, stderr) = match Browser::launch(launch).await {
            Ok((browser, handler)) => return Ok((browser, handler, slot)),
            Err(CdpError::LaunchExit(status, stderr)) => (status.to_string(), stderr),
            // A browser that stops at once can also show as its output ending before it said where to reach it;
            // it is the same stop, and what it said is answered the same way.
            Err(CdpError::LaunchIo(error, stderr)) => {
                (format!("its output ended: {error}"), stderr)
            }
            Err(CdpError::LaunchTimeout(stderr)) => {
                return Err(Error::Launch(format!(
                    "it did not get ready in time. It said: {}",
                    said(stderr.as_slice())
                )));
            }
            Err(e) => return Err(Error::Launch(cdp_message(&e))),
        };
        let text = String::from_utf8_lossy(stderr.as_slice()).to_lowercase();
        if text.contains("existing browser session")
            || text.contains("profile appears to be in use")
            || text.contains("singletonlock")
        {
            // A browser this program started earlier and lost still holds that profile: use another.
            skip.push(slot.number);
        } else {
            return Err(launch_failure(
                config.sandbox == Sandbox::On,
                &status,
                stderr.as_slice(),
            ));
        }
    }
    Err(Error::Launch(
        "every place the browser could keep its profile is in use by a browser that will not start"
            .to_owned(),
    ))
}

#[cfg(test)]
mod tests;
