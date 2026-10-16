//! Where the browser extension's files are on this computer. The installer
//! carries them as resources of the app (`tauri.conf.json`), so Chrome or Edge
//! can "Load unpacked" from the installed copy; a debug build run from a source
//! checkout (`tauri dev`) finds the repository's own folder instead. Finding
//! the folder reads nothing but the names of two files, and showing it hands the
//! path to the system's file manager, as the vault's folder is shown.

use std::path::{Path, PathBuf};

/// The folder's name inside the app's resources, and in the repository.
const NAME: &str = "browser-extension";

/// An extension folder holds its manifest and the compiled code the manifest's
/// service worker names: one without them could not be loaded.
fn holds_extension(dir: &Path) -> bool {
    dir.join("manifest.json").is_file() && dir.join("dist").join("background-main.js").is_file()
}

/// A path without Windows' `\\?\` prefix, which the file manager and a
/// browser's folder chooser show as it is.
fn plain(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => path,
    }
}

/// The folder the extension is loaded from: the app's resource folder when it
/// holds one, else, in a debug build, the checkout this build was made in
/// (`checkout` is the app crate's folder, `app/src-tauri`).
pub(super) fn find(resources: Option<&Path>, checkout: Option<&Path>) -> Option<PathBuf> {
    let installed = resources.map(|dir| dir.join(NAME));
    let source = checkout
        .and_then(|crate_dir| crate_dir.parent())
        .and_then(Path::parent)
        .map(|root| root.join(NAME));
    [installed, source]
        .into_iter()
        .flatten()
        .find(|dir| holds_extension(dir))
        .map(|dir| plain(dir.canonicalize().unwrap_or(dir)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A folder with the files an extension needs.
    fn extension_in(parent: &Path) -> PathBuf {
        let dir = parent.join(NAME);
        fs::create_dir_all(dir.join("dist")).unwrap();
        fs::write(dir.join("manifest.json"), "{}").unwrap();
        fs::write(dir.join("dist").join("background-main.js"), "").unwrap();
        dir
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kasten-folder-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_installed_apps_resources_come_first() {
        let root = scratch("installed");
        let resources = root.join("resources");
        let installed = extension_in(&resources);
        let checkout = root.join("repo").join("app").join("src-tauri");
        fs::create_dir_all(&checkout).unwrap();
        extension_in(&root.join("repo"));
        let found = find(Some(&resources), Some(&checkout)).unwrap();
        assert_eq!(found, plain(installed.canonicalize().unwrap()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_source_checkout_serves_when_the_resources_have_none() {
        let root = scratch("checkout");
        let checkout = root.join("repo").join("app").join("src-tauri");
        fs::create_dir_all(&checkout).unwrap();
        let source = extension_in(&root.join("repo"));
        let empty = root.join("resources");
        fs::create_dir_all(&empty).unwrap();
        let found = find(Some(&empty), Some(&checkout)).unwrap();
        assert_eq!(found, plain(source.canonicalize().unwrap()));
        // With no resource folder known at all, the checkout still serves.
        assert_eq!(find(None, Some(&checkout)).unwrap(), found);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_without_its_manifest_or_its_compiled_code_is_not_an_extension() {
        let root = scratch("partial");
        let resources = root.join("resources");
        let dir = extension_in(&resources);
        fs::remove_file(dir.join("dist").join("background-main.js")).unwrap();
        assert_eq!(find(Some(&resources), None), None);
        fs::write(dir.join("dist").join("background-main.js"), "").unwrap();
        fs::remove_file(dir.join("manifest.json")).unwrap();
        assert_eq!(find(Some(&resources), None), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_is_found_where_there_is_nothing() {
        assert_eq!(find(None, None), None);
        assert_eq!(find(Some(Path::new("/no/such/folder")), None), None);
    }

    #[test]
    fn windows_verbatim_prefix_is_taken_off_but_a_network_path_is_not_changed() {
        assert_eq!(
            plain(PathBuf::from(
                r"\\?\C:\Program Files\KastenFlow\browser-extension"
            )),
            PathBuf::from(r"C:\Program Files\KastenFlow\browser-extension")
        );
        assert_eq!(
            plain(PathBuf::from("/usr/share/kasten")),
            PathBuf::from("/usr/share/kasten")
        );
        assert_eq!(
            plain(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\?\UNC\server\share")
        );
    }
}
