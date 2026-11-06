//! What the mailbox's handler needs of the app: the open vault, whether a
//! plugin is on, a build, the window drawing a picture and the shared
//! selection. The real one is the app itself; tests give a stand-in with a
//! fake engine and a fake window.

use std::sync::Arc;
use std::time::Duration;

use kasten_core::Kasten;
use kasten_core::latex::LatexDoc;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::selection::{Share, tell};
use super::window::{self, Failed, Pictures};
use crate::open_vault::OpenVault;
use crate::plugins;
use crate::plugins::latex::commands::{BuildRequest, ended, latex, prepare};
use crate::plugins::latex::preview::{self, Previewed};
use crate::plugins::latex::service::{BuildError, Ended, Outcome};
use crate::plugins::latex::snapshot::Buffer;

/// Said when a build ran out of time while the engine was fetching packages.
pub(crate) const STILL_FETCHING: &str = "The build is still fetching the TeX packages it needs (the first build does, and it can take several minutes). It is still running in the app: ask again in a minute, with a longer timeout_seconds.";

/// Why a build could not start, in words an assistant can pass on. When there
/// is no engine, it is told plainly, and told not to keep trying.
pub(crate) fn told_plainly(err: BuildError) -> String {
    if err.kind == "no-engine" {
        format!(
            "{} No LaTeX engine is installed here, so nothing can be built to check a fix. Tell the person that plainly and do not try to build again: finish from the log you already have.",
            err.message
        )
    } else {
        err.message
    }
}

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
    /// Builds `doc` with `files` (path relative to its folder, whole proposed
    /// text) laid over its own, in a scratch folder: the document's build, its
    /// last good PDF and its files are not touched, and the scratch folder is
    /// gone when this returns. Why not, when it could not be started.
    fn build_preview(
        &self,
        _doc: &LatexDoc,
        _files: Vec<(String, String)>,
        _wait: Duration,
    ) -> Result<Previewed, String> {
        Err("This app cannot build a preview of changes that wait for review".to_owned())
    }
    /// Has the window draw `svg` (cleaned, nothing in it runs or fetches) on
    /// `background` (a CSS colour) as a PNG and waits up to `wait`: the PNG as
    /// base64, as the window said it, or why not. The answer is not trusted yet.
    fn draw_png(&self, svg: &str, background: &str, wait: Duration) -> Result<String, Failed>;
    /// The bytes that came beside request `id` (the deck to draw): taken once.
    fn payload(&self, _id: &str) -> Result<Vec<u8>, String> {
        Err("This app cannot read what comes beside a request".to_owned())
    }
    /// Has the window do the slide `job` (a JSON object without its `id`) and waits up to `wait`:
    /// the answer as the window said it (a PNG as base64, or JSON text), not trusted yet.
    fn ask_slides(&self, _job: Value, _wait: Duration) -> Result<String, Failed> {
        Err(Failed {
            why: "KastenFlow's window is not ready to draw slides".to_owned(),
            answered: false,
        })
    }
    /// Has the window do the code picture `job` (a JSON object without its `id`) under the event
    /// `event` (run it, or ask the person to allow it) and waits up to `wait`: the answer as text,
    /// not trusted yet.
    fn ask_generator(&self, _event: &str, _job: Value, _wait: Duration) -> Result<String, Failed> {
        Err(Failed {
            why: "KastenFlow's window is not ready to run code".to_owned(),
            answered: false,
        })
    }
    /// Whether a person allowed this code (its `hash`) to run in the deck at `deck` (a vault path).
    fn generator_allowed(&self, _deck: &str, _hash: &str) -> bool {
        false
    }
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
            // A first build that fetches packages is waited for, so the build may run as long as the asker waits.
            timeout_secs: Some(wait.as_secs().max(120)),
        };
        // The same checks and engine choice as the window's build; nothing a request says reaches the engine.
        let (folder, job) = prepare(&self.app, &vault, request).map_err(told_plainly)?;
        let seq = latex(&self.app).submit(&folder, job);
        let log = ended(&self.app);
        let event = log.wait(&folder, seq, wait).ok_or_else(|| {
            let said = if log.fetching(&folder, seq) {
                STILL_FETCHING
            } else {
                "The build did not finish in time"
            };
            said.to_owned()
        })?;
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

    fn build_preview(
        &self,
        doc: &LatexDoc,
        files: Vec<(String, String)>,
        wait: Duration,
    ) -> Result<Previewed, String> {
        let vault = self.app.state::<OpenVault>();
        let request = BuildRequest {
            folder: doc.folder.clone(),
            buffers: files
                .into_iter()
                .map(|(rel, text)| Buffer {
                    path: format!("{}/{rel}", doc.folder),
                    text,
                })
                .collect(),
            timeout_secs: Some(wait.as_secs().max(120)),
        };
        let (_, job) = prepare(&self.app, &vault, request).map_err(told_plainly)?;
        Ok(preview::run(job, &|spec| spec))
    }

    fn draw_png(&self, svg: &str, background: &str, wait: Duration) -> Result<String, Failed> {
        let pictures = self.app.try_state::<Pictures>().ok_or_else(|| Failed {
            why: "KastenFlow's window is not ready to draw pictures".to_owned(),
            answered: false,
        })?;
        window::draw(&self.app, &pictures, svg, background, wait)
    }

    fn payload(&self, id: &str) -> Result<Vec<u8>, String> {
        let kasten = self.kasten()?;
        kasten_mcp::bridge::mailbox(kasten.root())
            .map_err(|err| err.to_string())?
            .take_payload(id)
            .ok_or_else(|| "The deck did not come with the request".to_owned())
    }

    fn ask_slides(&self, job: Value, wait: Duration) -> Result<String, Failed> {
        let pictures = self.app.try_state::<Pictures>().ok_or_else(|| Failed {
            why: "KastenFlow's window is not ready to draw slides".to_owned(),
            answered: false,
        })?;
        let make = |id: &str| {
            let mut job = job;
            job["id"] = Value::String(id.to_owned());
            job
        };
        window::ask_window(&self.app, &pictures, window::SLIDES, make, wait)
    }

    fn ask_generator(&self, event: &str, job: Value, wait: Duration) -> Result<String, Failed> {
        let pictures = self.app.try_state::<Pictures>().ok_or_else(|| Failed {
            why: "KastenFlow's window is not ready to run code".to_owned(),
            answered: false,
        })?;
        let make = |id: &str| {
            let mut job = job;
            job["id"] = Value::String(id.to_owned());
            job
        };
        window::ask_window(&self.app, &pictures, event, make, wait)
    }

    fn generator_allowed(&self, deck: &str, hash: &str) -> bool {
        let dir = self.app.path().app_local_data_dir().ok();
        crate::smart::settings::generator_allowed(dir.as_deref(), deck, hash)
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
