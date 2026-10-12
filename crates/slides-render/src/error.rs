//! What can go wrong, each in a sentence that says what to do about it.

use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// No Chrome, Chromium or Edge could be found. `notes` are settings that name a browser that is not there.
    NoBrowser { notes: Vec<String> },
    /// This build carries no render page and none was found beside it.
    NoPage,
    /// The browser could not be started.
    Launch(String),
    /// The browser stopped, or stopped answering, while it was working.
    Browser(String),
    /// The request cannot be done as asked (a slide that is not in the deck): a sentence for the person.
    Request(String),
    /// A file or folder the renderer needs could not be used.
    Io(String),
    /// The render host has been shut down.
    Closed,
}

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NoBrowser { notes } => {
                write!(
                    f,
                    "Drawing slides needs Chrome or Chromium, and none was found. Install one, or set CHROMIUM_PATH to the browser's program (for example CHROMIUM_PATH=/usr/bin/chromium). Looked at CHROMIUM_PATH and CHROME, then for chromium, chromium-browser, google-chrome, google-chrome-stable and microsoft-edge on PATH, and in Playwright's browser folder."
                )?;
                for note in notes {
                    write!(f, " {note}")?;
                }
                Ok(())
            }
            Error::NoPage => f.write_str(
                "This build of KastenFlow Slides does not carry the page it draws slides with. Build it with `node scripts/build-render-page.mjs` and build again, or set SLIDES_RENDER_PAGE to the folder it was built into.",
            ),
            Error::Launch(m) => write!(f, "The browser could not be started: {m}"),
            Error::Browser(m) => write!(f, "The browser failed while drawing: {m}"),
            Error::Request(m) | Error::Io(m) => f.write_str(m),
            Error::Closed => f.write_str("The render host was shut down."),
        }
    }
}

impl std::error::Error for Error {}

impl From<slides_core::Error> for Error {
    fn from(e: slides_core::Error) -> Error {
        Error::Request(e.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Error {
        Error::Io(e.to_string())
    }
}

impl From<chromiumoxide::error::CdpError> for Error {
    fn from(e: chromiumoxide::error::CdpError) -> Error {
        Error::Browser(cdp_message(&e))
    }
}

/// A browser error as one line: a page's exception says what threw, the rest say what failed.
pub fn cdp_message(e: &chromiumoxide::error::CdpError) -> String {
    use chromiumoxide::error::CdpError;
    match e {
        CdpError::JavascriptException(details) => {
            let text = details
                .exception
                .as_ref()
                .and_then(|o| {
                    o.description
                        .clone()
                        .or_else(|| o.value.as_ref().map(ToString::to_string))
                })
                .unwrap_or_else(|| details.text.clone());
            first_line(&text)
        }
        CdpError::Timeout => "the browser did not answer in time".to_owned(),
        other => other.to_string(),
    }
}

/// The first line of an exception's description, without the `Error: ` in front: what the page said, not where.
pub fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or(text).trim();
    line.strip_prefix("Error: ").unwrap_or(line).to_owned()
}
