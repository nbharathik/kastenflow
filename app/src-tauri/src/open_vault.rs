//! The vault the window works on: `KASTEN_VAULT`, else the one chosen in
//! the app, opened through the engine on a thread of its own. A first
//! open, or one after `.kasten/cache/` went, rebuilds the index, which
//! takes seconds for a large vault, and the window must not stop while it
//! does. The window asks `vault_ready` before anything else;
//! a command asked sooner says the vault is still opening.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use kasten_core::Kasten;

/// How the open went.
struct Opened {
    kasten: Option<Arc<Kasten>>,
    problem: Option<String>,
}

impl Opened {
    fn problem(problem: impl Into<String>) -> Opened {
        Opened {
            kasten: None,
            problem: Some(problem.into()),
        }
    }
}

pub struct OpenVault {
    opened: Arc<OnceLock<Opened>>,
}

impl OpenVault {
    /// Starts opening the vault the app is set to, with the app's settings
    /// in `settings_dir`. `then` sets up around it (the watcher, what the
    /// window may show) before any command sees it.
    pub fn start(
        settings_dir: Option<PathBuf>,
        then: impl FnOnce(&Arc<Kasten>) + Send + 'static,
    ) -> OpenVault {
        let opened = Arc::new(OnceLock::new());
        let slot = Arc::clone(&opened);
        let work = move || {
            let result = open(settings_dir.as_deref());
            if let Some(kasten) = &result.kasten {
                // A slip while setting up must not leave the window waiting.
                let _ = crate::crash::caught(|| {
                    then(kasten);
                    Ok(())
                });
            }
            let _ = slot.set(result);
        };
        let started = std::thread::Builder::new()
            .name("kasten-open".into())
            .stack_size(crate::STACK_BYTES)
            .spawn(work);
        if let Err(err) = started {
            let _ = opened.set(Opened::problem(format!(
                "KastenFlow could not start opening the vault: {err}"
            )));
        }
        OpenVault { opened }
    }

    pub fn kasten(&self) -> Option<Arc<Kasten>> {
        self.opened.get().and_then(|opened| opened.kasten.clone())
    }

    /// The open vault, or why none is open.
    pub(crate) fn require(&self) -> Result<Arc<Kasten>, String> {
        match self.opened.get() {
            None => Err("KastenFlow is still opening the vault".into()),
            Some(opened) => opened
                .kasten
                .clone()
                .ok_or_else(|| opened.problem.clone().unwrap_or_default()),
        }
    }

    pub(crate) fn run<T>(
        &self,
        op: impl FnOnce(&Kasten) -> kasten_core::Result<T>,
    ) -> Result<T, String> {
        let kasten = self.require()?;
        crate::crash::caught(|| op(&kasten).map_err(|err| err.to_string()))
    }

    /// Waits, off the async threads, until the vault is open: Ok, or why
    /// it could not be.
    pub async fn ready(&self) -> Result<(), String> {
        let opened = Arc::clone(&self.opened);
        tauri::async_runtime::spawn_blocking(move || {
            let opened = opened.wait();
            match &opened.kasten {
                Some(_) => Ok(()),
                None => Err(opened.problem.clone().unwrap_or_default()),
            }
        })
        .await
        .map_err(crate::crash::joined)?
    }
}

/// Opens the vault the app is set to: `KASTEN_VAULT`, else the one chosen
/// in the app's settings in `settings_dir`.
fn open(settings_dir: Option<&Path>) -> Opened {
    let Some(vault) = crate::vault_path::chosen(settings_dir) else {
        return Opened::problem("No vault is open yet. Create one or open a folder.");
    };
    if !vault.exists {
        return Opened::problem(format!("No vault folder at {}", vault.resolved));
    }
    // A vault the core cannot open is a problem the window shows, never a
    // crash.
    match crate::crash::caught(|| Kasten::open(&vault.resolved).map_err(|err| err.to_string())) {
        Ok(kasten) => {
            // Scheduled backups go only to the remote confirmed on this
            // computer.
            if let Some(dir) = settings_dir {
                let settings = crate::app_settings::AppSettings::load(dir);
                let folder = kasten.root().display().to_string();
                let confirmed = settings.confirmed_remote(&folder);
                // A GitHub backup that might be public waits for the first
                // look at who can see it (the backup thread's first ticks),
                // so not even one push goes out before that.
                if !crate::git_host::visibility::hold_at_open(&settings, confirmed) {
                    kasten.confirm_remote(confirmed);
                }
            }
            Opened {
                kasten: Some(Arc::new(kasten)),
                problem: None,
            }
        }
        Err(problem) => Opened::problem(problem),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_asked_while_the_vault_opens_says_so() {
        let opening = OpenVault {
            opened: Arc::new(OnceLock::new()),
        };
        assert_eq!(
            opening.require().unwrap_err(),
            "KastenFlow is still opening the vault"
        );
        let failed = OpenVault {
            opened: Arc::new(OnceLock::new()),
        };
        let _ = failed
            .opened
            .set(Opened::problem("No vault folder at /gone"));
        assert_eq!(failed.require().unwrap_err(), "No vault folder at /gone");
        assert_eq!(
            tauri::async_runtime::block_on(failed.ready()).unwrap_err(),
            "No vault folder at /gone"
        );
    }
}
