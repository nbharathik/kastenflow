//! The app's side of the mailbox the MCP server asks through (kasten-core's
//! `bridge`): while a vault is open, a loop answers what an agent's tools ask
//! of the app. Things only the app can do: build a LaTeX document now (its
//! engine, its sandbox rules; `handle`), keep the built PDF in the document's
//! folder (an agent op, so the agent modes hold and it is one change in the
//! agent's session), draw a diagram as a PNG (the window's canvas; `diagram`,
//! `window`) and share what the person has selected with a client that asked
//! (`selection`). The loop starts when the vault is open and stops, saying the
//! app is gone, when the app closes.
//!
//! What the handler needs of the app is the `Side` trait, so it is tested with
//! a stand-in that builds with the tests' fake engine and draws with a fake window.

mod diagram;
mod handle;
mod pages;
mod report;
pub(crate) mod selection;
mod side;
pub(crate) mod window;

use std::sync::{Arc, Mutex};

use kasten_core::Kasten;
use kasten_core::bridge::{Handler, Server, serve};
use tauri::{AppHandle, Manager};

pub use side::{AppSide, Side};

#[cfg(test)]
mod tests;

/// The running loop, kept in the app's state so it can be ended.
pub struct Running {
    server: Mutex<Option<Server>>,
    ticker: Mutex<Option<selection::Ticker>>,
}

impl Running {
    /// Ends the loop; the app's alive file goes with it.
    pub fn stop(&self) {
        let ticker = self.ticker.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(ticker) = ticker {
            ticker.stop();
        }
        let server = self.server.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(mut server) = server {
            server.stop();
        }
    }
}

/// Starts answering the mailbox of `kasten`'s vault with `side`.
pub fn start(kasten: &Arc<Kasten>, side: Arc<dyn Side>) -> Result<Running, String> {
    let mailbox = kasten_mcp::bridge::mailbox(kasten.root()).map_err(|err| err.to_string())?;
    let handler: Handler = Arc::new(move |request, call| handle::handle(&*side, request, call));
    let server = serve(mailbox, kasten_core::VERSION, handler).map_err(|err| err.to_string())?;
    Ok(Running {
        server: Mutex::new(Some(server)),
        ticker: Mutex::new(None),
    })
}

/// Starts the loop for the vault the app has open and keeps it in the app's state.
pub fn start_for_app(app: &AppHandle, kasten: &Arc<Kasten>) {
    let share = match kasten_mcp::bridge::mailbox(kasten.root()) {
        Ok(mailbox) => Arc::new(selection::Share::new(mailbox)),
        Err(why) => {
            eprintln!("Agents cannot ask the app for anything: {why}");
            return;
        }
    };
    app.manage(window::Pictures::default());
    app.manage(Arc::clone(&share));
    match start(
        kasten,
        Arc::new(AppSide::new(app.clone(), Arc::clone(&share))),
    ) {
        Ok(running) => {
            *running.ticker.lock().unwrap_or_else(|e| e.into_inner()) =
                selection::spawn_ticker(app.clone(), share);
            app.manage(running);
        }
        Err(why) => eprintln!("Agents cannot ask the app to build or keep a PDF: {why}"),
    }
}

/// The app is closing: the loop ends, nothing is shared and the app says it is gone.
pub fn stop(app: &AppHandle) {
    if let Some(running) = app.try_state::<Running>() {
        running.stop();
    }
    if let Some(share) = app.try_state::<Arc<selection::Share>>() {
        share.stop();
    }
}
