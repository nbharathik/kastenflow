use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

/// A folder of its own under the system's temporary folder.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "slides-render-{name}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
        Scratch(dir)
    }

    /// A file that can be run, at `tail` under the folder.
    fn program(&self, tail: &str) -> PathBuf {
        let path = self.0.join(tail);
        fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))
            .unwrap_or_else(|e| panic!("{e}"));
        fs::write(&path, "#!/bin/sh\n").unwrap_or_else(|e| panic!("{e}"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                .unwrap_or_else(|e| panic!("{e}"));
        }
        path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn search(vars: &[(&str, &Path)]) -> Search {
    let vars: Vec<(String, OsString)> = vars
        .iter()
        .map(|(k, v)| ((*k).to_owned(), v.as_os_str().to_owned()))
        .collect();
    Search::from_lookup(move |name| vars.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()))
}

fn found(search: &Search) -> PathBuf {
    search.find().unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn chromium_path_comes_first() {
    let dir = Scratch::new("order");
    let chosen = dir.program("mine/browser");
    dir.program("bin/chromium");
    let path = dir.0.join("bin");
    let s = search(&[
        ("CHROMIUM_PATH", &chosen),
        ("CHROME", &dir.program("other/chrome")),
        ("PATH", &path),
        ("PLAYWRIGHT_BROWSERS_PATH", &dir.0.join("none")),
    ]);
    assert_eq!(found(&s), chosen);
}

#[test]
fn chrome_is_used_when_chromium_path_is_not_set() {
    let dir = Scratch::new("chrome-var");
    let chosen = dir.program("other/chrome");
    let s = search(&[
        ("CHROME", &chosen),
        ("PLAYWRIGHT_BROWSERS_PATH", &dir.0.join("none")),
    ]);
    assert_eq!(found(&s), chosen);
}

#[test]
fn a_setting_that_names_nothing_is_passed_over_and_told_of_when_nothing_is_found() {
    let dir = Scratch::new("bad-var");
    let missing = dir.0.join("not-there");
    let on_path = dir.program("bin/google-chrome");
    let path = dir.0.join("bin");
    let with_path = search(&[
        ("CHROMIUM_PATH", &missing),
        ("PATH", &path),
        ("PLAYWRIGHT_BROWSERS_PATH", &dir.0.join("none")),
    ]);
    assert_eq!(found(&with_path), on_path, "the browser on PATH is used");

    let mut without = search(&[
        ("CHROMIUM_PATH", &missing),
        ("PLAYWRIGHT_BROWSERS_PATH", &dir.0.join("none")),
    ]);
    // The places browsers are installed are looked in too, and this machine may have one there.
    without.places.clear();
    let Err(Error::NoBrowser { notes }) = without.find() else {
        panic!("nothing should be found");
    };
    assert_eq!(notes.len(), 1);
    assert!(
        notes[0].contains("CHROMIUM_PATH") && notes[0].contains("not-there"),
        "{notes:?}"
    );
    let message = without
        .find()
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(
        message.contains("needs Chrome or Chromium")
            && message.contains("CHROMIUM_PATH")
            && message.contains("not-there"),
        "{message}"
    );
}

#[test]
fn names_on_path_are_tried_in_order_whatever_folder_they_are_in() {
    let dir = Scratch::new("names");
    dir.program("first/google-chrome");
    let chromium = dir.program("second/chromium");
    let joined = std::env::join_paths([dir.0.join("first"), dir.0.join("second")])
        .unwrap_or_else(|e| panic!("{e}"));
    let s = search(&[
        ("PATH", Path::new(&joined)),
        ("PLAYWRIGHT_BROWSERS_PATH", &dir.0.join("none")),
    ]);
    assert_eq!(found(&s), chromium, "chromium comes before google-chrome");
}

#[test]
fn a_file_that_cannot_be_run_is_not_a_browser() {
    let dir = Scratch::new("not-exec");
    let file = dir.0.join("bin/chromium");
    fs::create_dir_all(dir.0.join("bin")).unwrap_or_else(|e| panic!("{e}"));
    fs::write(&file, "text").unwrap_or_else(|e| panic!("{e}"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644))
            .unwrap_or_else(|e| panic!("{e}"));
        let path = dir.0.join("bin");
        let mut s = search(&[
            ("PATH", &path),
            ("PLAYWRIGHT_BROWSERS_PATH", &dir.0.join("none")),
        ]);
        // Not the browser this machine may have installed in the usual places.
        s.places.clear();
        assert!(matches!(s.find(), Err(Error::NoBrowser { .. })));
    }
}

#[test]
fn the_newest_playwright_browser_is_used() {
    let dir = Scratch::new("playwright");
    dir.program("cache/chromium-900/chrome-linux/chrome");
    let newest = dir.program("cache/chromium-1194/chrome-linux/chrome");
    dir.program("cache/chromium_headless_shell-2000/chrome-linux/headless_shell");
    dir.program("cache/chromium-abc/chrome-linux/chrome");
    let cache = dir.0.join("cache");
    let s = search(&[("PLAYWRIGHT_BROWSERS_PATH", &cache)]);
    assert_eq!(found(&s), newest);
}

#[test]
fn playwright_layouts_of_other_versions_and_systems_are_found() {
    let dir = Scratch::new("playwright-layouts");
    let newer = dir.program("cache/chromium-1200/chrome-linux64/chrome");
    let cache = dir.0.join("cache");
    assert_eq!(
        found(&search(&[("PLAYWRIGHT_BROWSERS_PATH", &cache)])),
        newer
    );
    let mac = Scratch::new("playwright-mac");
    let program =
        mac.program("cache/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium");
    let cache = mac.0.join("cache");
    assert_eq!(
        found(&search(&[("PLAYWRIGHT_BROWSERS_PATH", &cache)])),
        program
    );
}

#[test]
fn playwright_browsers_path_names_the_only_folder_looked_in() {
    let dir = Scratch::new("playwright-only");
    let elsewhere = dir.0.join("elsewhere");
    fs::create_dir_all(&elsewhere).unwrap_or_else(|e| panic!("{e}"));
    let s = search(&[("PLAYWRIGHT_BROWSERS_PATH", &elsewhere), ("HOME", &dir.0)]);
    assert_eq!(s.playwright, [elsewhere]);
    let zero = search(&[("PLAYWRIGHT_BROWSERS_PATH", Path::new("0"))]);
    assert!(
        zero.playwright.is_empty(),
        "0 means the browsers are not in a folder"
    );
    let default = search(&[("HOME", Path::new("/home/someone"))]);
    assert!(
        default
            .playwright
            .contains(&PathBuf::from("/opt/pw-browsers"))
    );
    assert!(
        default
            .playwright
            .contains(&PathBuf::from("/home/someone/.cache/ms-playwright"))
    );
}

#[test]
fn empty_settings_count_as_not_set() {
    let s = search(&[("CHROMIUM_PATH", Path::new("")), ("CHROME", Path::new(""))]);
    assert!(s.variables.is_empty());
}

#[test]
fn nothing_found_says_where_it_looked_and_what_to_do() {
    let dir = Scratch::new("nothing");
    let s = Search {
        variables: vec![],
        path: vec![dir.0.clone()],
        playwright: vec![dir.0.clone()],
        places: vec![],
    };
    let message = s.find().err().map(|e| e.to_string()).unwrap_or_default();
    for word in [
        "Chrome or Chromium",
        "CHROMIUM_PATH",
        "chromium-browser",
        "google-chrome-stable",
        "microsoft-edge",
        "Playwright",
    ] {
        assert!(message.contains(word), "{word} in {message}");
    }
}
