//! A note, or the vault, shown in the system's file manager. Nothing here
//! reads or writes the vault: the path is checked to be a file inside it
//! and handed to the system, as a web address is handed to the browser.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::State;

use crate::open_vault::OpenVault;
use crate::web::run_detached;

/// The kinds of file a person may ask to see: notes, boards, PDFs, tag
/// schemas.
const KINDS: [&str; 4] = [".md", ".canvas", ".pdf", ".yaml"];

/// The system's way to show `target`: selected in its folder where the
/// file manager can do that, else the folder that holds it.
pub(crate) fn reveal(target: &Path, select: bool) -> Command {
    #[cfg(target_os = "macos")]
    let command = {
        let mut command = Command::new("open");
        if select {
            command.arg("-R");
        }
        command.arg(target);
        command
    };
    #[cfg(windows)]
    let command = {
        let mut command = Command::new("explorer");
        if select {
            command.arg("/select,");
        }
        command.arg(target);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let command = {
        // No file manager call selects a file everywhere, so it opens the
        // folder that holds it.
        let mut command = Command::new("xdg-open");
        command.arg(if select {
            target.parent().unwrap_or(target)
        } else {
            target
        });
        command
    };
    command
}

/// Shows the vault file at `path` in its folder, or with no path the
/// vault's own folder.
#[tauri::command(async)]
pub fn reveal_in_folder(state: State<'_, OpenVault>, path: Option<String>) -> Result<(), String> {
    let kasten = state.require()?;
    let (target, select): (PathBuf, bool) = match path.as_deref() {
        None => (kasten.root().to_path_buf(), false),
        Some(rel) => {
            let file = kasten
                .vault()
                .file_of(rel, &KINDS)
                .map_err(|e| e.to_string())?;
            if !file.is_file() {
                return Err(format!("{rel} is not in the vault"));
            }
            (file, true)
        }
    };
    run_detached(reveal(&target, select)).map_err(|e| format!("Could not open the folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hands_the_path_over_as_one_argument() {
        let file = Path::new("/vault/library/a page; rm -rf ~.md");
        let command = reveal(file, true);
        let args: Vec<_> = command.get_args().collect();
        // Never through a shell: the path is its own argument, as it is.
        assert!(
            args.iter()
                .any(|a| Path::new(a) == file || Path::new(a) == file.parent().unwrap()),
            "{args:?}"
        );
        let folder = reveal(Path::new("/vault"), false);
        assert_eq!(folder.get_args().last().unwrap(), "/vault");
    }
}
