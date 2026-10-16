//! Files pasted or dropped into a page go to `assets/` and are linked
//! relatively.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake image bytes";

#[test]
fn keeps_a_file_in_assets_as_one_commit() {
    let (t, k) = open();
    let commits = k.log(None, 500).unwrap().len();
    let path = k
        .save_asset(
            &Actor::Human,
            "Screenshot 2026-09-24 at 10.12.png",
            PNG,
            NOW,
        )
        .unwrap();
    assert_eq!(path, "assets/screenshot-2026-09-24-at-10-12.png");
    assert_eq!(fs::read(t.vault.root().join(&path)).unwrap(), PNG);
    let log = k.log(None, 500).unwrap();
    assert_eq!(log.len(), commits + 1);
    assert!(
        log[0]
            .summary
            .contains("screenshot-2026-09-24-at-10-12.png"),
        "{}",
        log[0].summary
    );
}

#[test]
fn reuses_the_same_bytes_and_finds_a_free_name_for_others() {
    let (_t, k) = open();
    let first = k
        .save_asset(&Actor::Human, "diagram.PNG", PNG, NOW)
        .unwrap();
    let commits = k.log(None, 500).unwrap().len();
    assert_eq!(
        k.save_asset(&Actor::Human, "diagram.png", PNG, NOW)
            .unwrap(),
        first
    );
    assert_eq!(
        k.log(None, 500).unwrap().len(),
        commits,
        "the same file makes no commit"
    );
    let other = k
        .save_asset(&Actor::Human, "diagram.png", b"other bytes", NOW)
        .unwrap();
    assert_eq!(other, "assets/diagram-2.png");
}

#[test]
fn keeps_documents_and_media_but_nothing_that_runs_or_opens_as_a_page() {
    let (_t, k) = open();
    assert_eq!(
        k.save_asset(&Actor::Human, "Trip budget.xlsx", b"sheet", NOW)
            .unwrap(),
        "assets/trip-budget.xlsx"
    );
    assert_eq!(
        k.save_asset(&Actor::Human, "../../etc/notes.pdf", b"pdf", NOW)
            .unwrap(),
        "assets/notes.pdf"
    );
    for name in [
        "diagram.svg",
        "Clip.MP4",
        "song.m4a",
        "board.excalidraw",
        "data.csv",
    ] {
        assert!(
            k.save_asset(&Actor::Human, name, b"x", NOW).is_ok(),
            "{name}"
        );
    }
    for name in [
        "setup.exe",
        "run.sh",
        "page.html",
        "page.HTM",
        "script.js",
        "shortcut.lnk",
        "launcher.desktop",
        "app.hta",
        "settings.reg",
        "budget.xlsm",
        "no-extension",
        ".png",
        "x.toolongextension",
    ] {
        assert!(
            k.save_asset(&Actor::Human, name, b"x", NOW).is_err(),
            "{name}"
        );
    }
    assert!(k.save_asset(&Actor::Human, "empty.png", b"", NOW).is_err());
    let huge = vec![0u8; kasten_core::MAX_ASSET_BYTES + 1];
    assert!(k.save_asset(&Actor::Human, "huge.png", &huge, NOW).is_err());
}

#[test]
fn reads_back_a_picture_kept_in_assets() {
    let (_t, k) = open();
    let path = k.save_asset(&Actor::Human, "figure.png", PNG, NOW).unwrap();
    assert_eq!(k.read_asset(&path).unwrap(), PNG);
}

#[test]
fn reading_a_picture_is_limited_to_pictures_under_assets() {
    let (t, k) = open();
    fs::create_dir_all(t.vault.root().join("assets")).unwrap();
    fs::write(t.vault.root().join("assets/notes.txt"), b"text").unwrap();
    for path in [
        "assets/../projects/x.png",
        "assets/notes.txt",
        "notes/welcome.md",
        ".git/config",
        "/etc/passwd",
        "assets\\figure.png",
        "figure.png",
        "assets/",
        "",
    ] {
        assert!(k.read_asset(path).is_err(), "{path} should be refused");
    }
}

#[test]
fn a_picture_that_is_not_there_is_not_found() {
    let (_t, k) = open();
    let err = k.read_asset("assets/missing.png").unwrap_err();
    assert!(matches!(err, kasten_core::Error::NotFound(_)), "{err:?}");
}

#[test]
fn reads_a_picture_whatever_the_case_of_its_extension() {
    let (t, k) = open();
    fs::create_dir_all(t.vault.root().join("assets/2026")).unwrap();
    for name in [
        "IMG_0001.JPG",
        "Scan.PNG",
        "Photo.Jpeg",
        "logo.SVG",
        "Frame.WebP",
        "2026/IMG_0002.JPG",
    ] {
        let bytes = format!("bytes of {name}").into_bytes();
        fs::write(t.vault.root().join("assets").join(name), &bytes).unwrap();
        assert_eq!(
            k.read_asset(&format!("assets/{name}")).unwrap(),
            bytes,
            "{name}"
        );
    }
}

#[test]
fn a_picture_is_read_in_any_case_and_still_only_a_picture_under_assets() {
    let (t, k) = open();
    let assets = t.vault.root().join("assets");
    fs::create_dir_all(assets.join(".hidden")).unwrap();
    fs::create_dir_all(assets.join("folder.PNG")).unwrap();
    for name in [
        "x.png.exe",
        "x.JPG.exe",
        "x.png.html",
        "NOTES.TXT",
        "page.HTML",
        "run.SH",
        ".PNG",
        ".hidden/x.exe",
    ] {
        fs::write(assets.join(name), b"not a picture").unwrap();
    }
    for path in [
        "assets/x.png.exe",
        "assets/x.JPG.exe",
        "assets/x.png.html",
        "assets/NOTES.TXT",
        "assets/page.HTML",
        "assets/run.SH",
        "assets/.PNG",
        "assets/.hidden/x.exe",
        // A folder that looks like a picture is not one.
        "assets/folder.PNG",
        "assets/../projects/x.PNG",
        "assets/..%2Fx.PNG",
        "projects/x.PNG",
        ".git/x.PNG",
        ".kasten/x.PNG",
        "/etc/x.PNG",
        "assets\\x.PNG",
        "assets/x.PNG\0",
        "assets/x.PNG/",
    ] {
        assert!(k.read_asset(path).is_err(), "{path} should be refused");
    }
    // Nothing there yet is still just not found.
    assert!(matches!(
        k.read_asset("assets/Missing.JPG").unwrap_err(),
        kasten_core::Error::NotFound(_)
    ));
}

#[cfg(unix)]
#[test]
fn a_link_named_like_a_picture_is_not_followed_in_any_case() {
    let (t, k) = open();
    let outside = std::env::temp_dir().join(format!("kasten-outside-{}.png", std::process::id()));
    fs::write(&outside, b"outside the vault").unwrap();
    fs::create_dir_all(t.vault.root().join("assets")).unwrap();
    // Two names, not one in two cases: a Mac's disk takes `Link.PNG` for `link.png`.
    for name in ["link.png", "Other.PNG"] {
        std::os::unix::fs::symlink(&outside, t.vault.root().join("assets").join(name)).unwrap();
        assert!(k.read_asset(&format!("assets/{name}")).is_err(), "{name}");
    }
}
