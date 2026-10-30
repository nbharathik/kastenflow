//! What the mailbox's handler needs of the app: the open vault, whether a
//! plugin is on, a build, the window drawing a picture and the shared
//! selection. The real one is the app itself; tests give a stand-in with a
//! fake engine and a fake window.

use std::sync::Arc;
use std::time::Duration;

use kasten_core::Kasten;
use kasten_core::latex::LatexDoc;
use tauri::{AppHandle, Manager};

use super::selection::{Share, tell};
use super::window::{self, Failed, Pictures};
use crate::open_vault::OpenVault;
use crate::plugins;
use crate::plugins::latex::commands::{BuildRequest, ended, latex, prepare};
use crate::plugins::latex::service::{Ended, Outcome};

pub trait Side: Send + Sync + 'static {
    /// The open vault, or why none is.
    fn kasten(&self) -> Result<Arc<Kasten>, String>;
    /// Whether the LaTeX plugin is on, as the window's commands ask: why not,
    /// in a sentence.
    fn latex_on(&self) -> Result<(), String>;
    /// The same for the diagram plugin.
    fn diagrams_on(&self) -> Result<(), String>;
    /// Builds `doc` from its files on disk and waits up to `wait` for the end
    /// of the build; why not, when it could not be started or took too long.
    fn build(&self, doc: &LatexDoc, wait: Duration) -> Result<Outcome, String>;
    /// Has the window draw `svg` (cleaned, nothing in it runs or fetches) on
    /// `background` (a CSS colour) as a PNG and waits up to `wait`: the PNG as
    /// base64, as the window said it, or why not. The answer is not trusted yet.
    fn draw_png(&self, svg: &str, background: &str, wait: Duration) -> Result<String, Failed>;
    /// A client asked for the selection at `now`: it is shared for two minutes
    /// more, and the window is told to publish it.
    fn share_selection(&self, now: u64) -> Result<(), String>;
    /// Whether the window has published the selection since `since`.
    fn selection_published_since(&self, since: u64) -> bool;
}

/// The app itself.
pub struct AppSide {
    app: AppHandle,
    share: Arc<Share>,
}

impl AppSide {
    pub fn new(app: AppHandle, share: Arc<Share>) -> AppSide {
        AppSide { app, share }
    }
}

impl Side for AppSide {
    fn kasten(&self) -> Result<Arc<Kasten>, String> {
        self.app.state::<OpenVault>().require()
    }

    fn latex_on(&self) -> Result<(), String> {
        plugins::require(&self.app, "latex")
    }

    fn diagrams_on(&self) -> Result<(), String> {
        plugins::require(&self.app, "diagrams")
    }

    fn build(&self, doc: &LatexDoc, wait: Duration) -> Result<Outcome, String> {
        let vault = self.app.state::<OpenVault>();
        let request = BuildRequest {
            folder: doc.folder.clone(),
            buffers: Vec::new(),
            timeout_secs: None,
        };
        // The same checks and engine choice as the window's build; nothing a request says reaches the engine.
        let (folder, job) = prepare(&self.app, &vault, request).map_err(|err| err.message)?;
        let seq = latex(&self.app).submit(&folder, job);
        let event = ended(&self.app)
            .wait(&folder, seq, wait)
            .ok_or("The build did not finish in time")?;
        Ok(Outcome {
            ended: match event.state {
                "done" => Ended::Done,
                "cancelled" => Ended::Cancelled,
                _ => Ended::Failed,
            },
            ms: event.ms,
            diagnostics: event.diagnostics,
            pdf: event.pdf,
            error: event.error,
        })
    }

    fn draw_png(&self, svg: &str, background: &str, wait: Duration) -> Result<String, Failed> {
        let pictures = self.app.try_state::<Pictures>().ok_or_else(|| Failed {
            why: "KastenFlow's window is not ready to draw pictures".to_owned(),
            answered: false,
        })?;
        window::draw(&self.app, &pictures, svg, background, wait)
    }

    fn share_selection(&self, now: u64) -> Result<(), String> {
        self.share.sharing.ask(now);
        // Told every time: a window that was reloaded meanwhile learns of it.
        tell(&self.app, true);
        Ok(())
    }

    fn selection_published_since(&self, since: u64) -> bool {
        self.share.sharing.written_since(since)
    }
}
