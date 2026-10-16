//! Tauri commands for project bundles: what exporting a project would put in a
//! bundle, and the export into a folder outside the vault. Importing a bundle is the
//! Import view's `plan_import` and `import_notes` (a folder with a bundle's manifest).

use std::path::PathBuf;

use kasten_core::Instant;
use kasten_core::bundle::{BundleExported, BundlePlan};
use tauri::State;

use super::notes::OpenVault;

/// A folder as a person types or pastes it: quotes round it left off.
fn folder(dest: &str) -> PathBuf {
    PathBuf::from(dest.trim().trim_matches(['"', '\'']))
}

/// What exporting the project in `projects/<project>/` would put in a bundle.
#[tauri::command(async)]
pub fn plan_export(state: State<'_, OpenVault>, project: String) -> Result<BundlePlan, String> {
    state.run(|k| k.plan_export(&project))
}

/// Writes the project's bundle into `dest`, a new or empty folder outside the vault.
#[tauri::command(async)]
pub fn export_project(
    state: State<'_, OpenVault>,
    project: String,
    dest: String,
) -> Result<BundleExported, String> {
    state.run(|k| k.export_project(&project, &folder(&dest), Instant::now()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pasted_folder_loses_its_quotes() {
        assert_eq!(
            folder(" \"D:/Exports/trip\" "),
            PathBuf::from("D:/Exports/trip")
        );
        assert_eq!(folder("'/tmp/x'"), PathBuf::from("/tmp/x"));
        assert_eq!(folder("/tmp/y"), PathBuf::from("/tmp/y"));
    }
}
