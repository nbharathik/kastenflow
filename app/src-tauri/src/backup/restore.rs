//! Restoring a backup into a new folder, from the vault chooser: a git
//! remote (GitHub or any host) or a backup file. The folder must be empty,
//! and the vault is built beside it and moved into place only when whole.
//! Then the remote is confirmed for it on this computer, it becomes the
//! vault that opens, and Kasten restarts on it.

use std::path::PathBuf;

use kasten_core::Kasten;
use kasten_core::history::{self, GitToken, https_origin};
use tauri::{AppHandle, Manager, State};

use crate::app_settings::AppSettings;
use crate::chat::commands::ChatState;
use crate::git_host::github;
use crate::secrets;

fn target(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let folder = crate::commands::vaults::expand(path, app.path().home_dir().ok());
    std::path::absolute(&folder).map_err(|e| e.to_string())
}

/// Clones the backup at `remote` into the empty folder `into`, and names that
/// address as the vault's backup, even if the vault's own settings named
/// another way to reach it.
fn clone_into(
    remote: &str,
    token: Option<&GitToken>,
    into: &std::path::Path,
) -> Result<(), String> {
    history::clone_backup(remote, token, into)
        .map_err(|e| history::redact(&e.to_string(), token))?;
    let kasten = Kasten::open(into).map_err(|e| e.to_string())?;
    let mut config = kasten.config();
    if config.git.remote.as_deref() != Some(remote) {
        config.git.remote = Some(remote.to_owned());
        kasten.set_config(config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Makes the restored vault in `chosen` the one that opens, and confirms
/// `remote` as its backup on this computer.
fn choose_restored(settings: &mut AppSettings, chosen: &str, remote: Option<&str>) {
    settings.choose(chosen);
    if let Some(url) = remote {
        settings.confirm_remote(chosen, Some(url));
    }
}

/// Makes the restored vault the one that opens, with `remote` confirmed
/// for it on this computer, and restarts on it.
fn open_restored(
    app: &AppHandle,
    folder: &std::path::Path,
    remote: Option<&str>,
) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let chosen = folder.display().to_string();
    AppSettings::update(&dir, |s| choose_restored(s, &chosen, remote))
        .map_err(|e| format!("Could not save the choice: {e}"))?;
    crate::closing::restart_when_written(app);
    Ok(())
}

/// Restores the backup at the git address `url` into the empty folder
/// `path`. A token pasted here signs in to that server only and is kept
/// in the keychain; without one, a token already kept for the server (as
/// after "Sign in with GitHub"), an SSH key or git's credential helper.
#[tauri::command]
pub async fn restore_from_git(
    app: AppHandle,
    chat: State<'_, ChatState>,
    url: String,
    path: String,
    username: Option<String>,
    secret: Option<String>,
) -> Result<(), String> {
    let url = url.trim().to_owned();
    let folder = target(&app, &path)?;
    let keys = chat.keys();
    let origin = https_origin(&url);
    let pasted = secret
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    let token = match (&origin, pasted) {
        (Some(origin), Some(secret)) => Some(GitToken {
            username: username
                .map(|u| u.trim().to_owned())
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| {
                    if origin == github::ORIGIN {
                        github::TOKEN_USER
                    } else {
                        "kasten"
                    }
                    .to_owned()
                }),
            origin: origin.clone(),
            secret,
        }),
        (None, Some(_)) => {
            return Err(
                "A token is for an https:// address; an ssh address signs in with an SSH key"
                    .into(),
            );
        }
        (Some(origin), None) => secrets::git_token(keys.as_ref(), origin).ok().flatten(),
        (None, None) => None,
    };
    let into = folder.clone();
    let remote = url.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::crash::caught(|| {
            clone_into(&remote, token.as_ref(), &into)?;
            if let Some(token) = &token {
                // Where the keychain can't keep it, it lasts this run only.
                let _ = secrets::save_git_token(keys.as_ref(), token);
            }
            Ok(())
        })
    })
    .await
    .map_err(crate::crash::joined)??;
    open_restored(&app, &folder, Some(&url))
}

/// Restores a backup file into the empty folder `path`.
#[tauri::command]
pub async fn restore_from_file(app: AppHandle, file: String, path: String) -> Result<(), String> {
    let bundle = target(&app, &file)?;
    let folder = target(&app, &path)?;
    let into = folder.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::crash::caught(|| {
            history::restore_from_bundle(&bundle, &into).map_err(|e| e.to_string())?;
            Ok(())
        })
    })
    .await
    .map_err(crate::crash::joined)??;
    // A backup file carries the address its vault backed up to. It is
    // confirmed here only when this computer already backs up there for
    // another vault: any other address waits for the person, as always.
    let named = Kasten::open(&folder)
        .ok()
        .and_then(|restored| restored.config().git.remote);
    let known = app
        .path()
        .app_config_dir()
        .map(|dir| remote_to_confirm(&AppSettings::load(&dir), named.as_deref()))
        .unwrap_or(None);
    open_restored(&app, &folder, known.as_deref())
}

/// The address of a restored backup file's vault to confirm on this computer:
/// `named` when it matches one confirmed here for a vault, otherwise none.
pub(crate) fn remote_to_confirm(settings: &AppSettings, named: Option<&str>) -> Option<String> {
    let named = named?.trim();
    settings
        .remotes
        .values()
        .any(|confirmed| confirmed.trim() == named)
        .then(|| named.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with(remote: &str) -> AppSettings {
        let mut settings = AppSettings::default();
        settings.confirm_remote("/notes/a", Some(remote));
        settings
    }

    fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_dir(&entry.path(), &target);
            } else {
                std::fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    /// A folder of its own under the system temp folder, removed at the end.
    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            // Only this test's own folder.
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_restore_from_a_git_remote_names_it_the_backup_and_confirms_it() {
        let scratch = Scratch(std::env::temp_dir().join(format!(
            "kasten-restore-test-{}",
            kasten_core::ulid_at(kasten_core::Instant::now().millis)
        )));
        // A local remote: a vault with history, which git clones like any other.
        let remote = scratch.0.join("remote");
        copy_dir(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault"),
            &remote,
        );
        let source = Kasten::open(&remote).unwrap();
        source.start_history().unwrap();
        let url = remote.display().to_string();

        let into = scratch.0.join("restored");
        clone_into(&url, None, &into).unwrap();
        let restored = Kasten::open(&into).unwrap();
        assert_eq!(
            restored.log(None, 1000).unwrap(),
            source.log(None, 1000).unwrap()
        );
        assert_eq!(restored.config().git.remote.as_deref(), Some(url.as_str()));

        // The address is then confirmed for the new vault, and it is the one that opens.
        let mut settings = AppSettings::default();
        let chosen = into.display().to_string();
        choose_restored(&mut settings, &chosen, Some(&url));
        assert_eq!(settings.confirmed_remote(&chosen), Some(url.as_str()));
        assert_eq!(settings.vault.as_deref(), Some(chosen.as_str()));
        // A restore with no address to confirm leaves the vault unconfirmed.
        let mut other = AppSettings::default();
        choose_restored(&mut other, &chosen, None);
        assert_eq!(other.confirmed_remote(&chosen), None);
    }

    #[test]
    fn a_restore_never_goes_into_a_folder_with_something_in_it() {
        let scratch = Scratch(std::env::temp_dir().join(format!(
            "kasten-restore-busy-{}",
            kasten_core::ulid_at(kasten_core::Instant::now().millis)
        )));
        let into = scratch.0.join("busy");
        std::fs::create_dir_all(&into).unwrap();
        std::fs::write(into.join("keep.md"), "mine\n").unwrap();
        assert!(
            clone_into(
                &scratch.0.join("nothing").display().to_string(),
                None,
                &into
            )
            .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(into.join("keep.md")).unwrap(),
            "mine\n"
        );
    }

    #[test]
    fn a_restored_file_confirms_only_an_address_already_confirmed_here() {
        let settings = settings_with("https://github.com/ada/notes.git");
        assert_eq!(
            remote_to_confirm(&settings, Some("https://github.com/ada/notes.git")).as_deref(),
            Some("https://github.com/ada/notes.git")
        );
        assert_eq!(
            remote_to_confirm(&settings, Some(" https://github.com/ada/notes.git ")).as_deref(),
            Some("https://github.com/ada/notes.git")
        );
    }

    #[test]
    fn an_address_nobody_confirmed_here_stays_unconfirmed() {
        let settings = settings_with("https://github.com/ada/notes.git");
        assert_eq!(
            remote_to_confirm(&settings, Some("https://evil.example/ada/notes.git")),
            None
        );
        assert_eq!(remote_to_confirm(&settings, None), None);
        assert_eq!(
            remote_to_confirm(
                &AppSettings::default(),
                Some("https://github.com/ada/notes.git")
            ),
            None
        );
    }
}
