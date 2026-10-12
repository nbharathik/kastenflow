//! Unpacking a WAR: only the web app, only inside its folder, within limits.

use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};

use super::support::{INDEX, Scratch, fake_war, raw_zip};
use crate::diagrams::extract::{Failure, LIMITS, Limits, extract};

fn run(
    scratch: &Scratch,
    war: &[u8],
    limits: &Limits,
) -> (
    Result<crate::diagrams::extract::Unpacked, Failure>,
    std::path::PathBuf,
) {
    let file = scratch.path("download.war");
    fs::write(&file, war).unwrap();
    let into = scratch.path("unpacked");
    let result = extract(&file, &into, limits, &AtomicBool::new(false), &|_, _| {});
    (result, into)
}

fn why(result: Result<crate::diagrams::extract::Unpacked, Failure>) -> String {
    match result {
        Err(Failure::Failed(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn unpacks_the_web_app_and_leaves_the_server_behind() {
    let scratch = Scratch::new();
    let (result, into) = run(&scratch, &fake_war(), &LIMITS);
    let unpacked = result.unwrap();
    assert_eq!((unpacked.files, unpacked.skipped), (7, 3));
    assert_eq!(fs::read_to_string(into.join("index.html")).unwrap(), INDEX);
    assert_eq!(
        fs::read(into.join("js/app.min.js")).unwrap(),
        b"window.stub = true;"
    );
    assert!(into.join("styles/grapheditor.css").is_file());
    assert!(into.join("images/logo.png").is_file());
    assert!(into.join("resources/dia.txt").is_file());
    // Licence and notice stay with the copy, flattened into one folder.
    assert_eq!(
        fs::read(into.join("legal/META-INF-LICENSE")).unwrap(),
        b"Apache License"
    );
    assert_eq!(
        fs::read(into.join("legal/NOTICE")).unwrap(),
        b"draw.io notice"
    );
    // Nothing of the server.
    assert!(!into.join("WEB-INF").exists());
    assert!(!into.join("META-INF").exists());
}

/// With the real release, which is not in the repository: put `draw.war` at `target/draw.war` (or give its path in
/// `KASTEN_DRAWIO_WAR`) and run `cargo test -p kasten-app --lib real_release -- --ignored`. It is the pinned file, and it
/// unpacks, by the rules above, to a web app with every piece the editor loads.
#[test]
#[ignore = "needs the real draw.war"]
fn the_real_release_is_what_the_pin_says_and_unpacks_to_the_editor() {
    use crate::diagrams::pinned;

    let war = std::env::var_os("KASTEN_DRAWIO_WAR").map_or_else(
        || std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/draw.war"),
        std::path::PathBuf::from,
    );
    let bytes = fs::read(&war).unwrap_or_else(|err| panic!("{}: {err}", war.display()));
    assert_eq!(bytes.len() as u64, pinned::SIZE);
    assert_eq!(super::support::sha256(&bytes), pinned::SHA256);

    let scratch = Scratch::new();
    let (result, into) = run(&scratch, &bytes, &LIMITS);
    let unpacked = result.unwrap();
    assert!(unpacked.files > 2500, "{unpacked:?}");
    for file in [
        "index.html",
        "js/app.min.js",
        "js/PreConfig.js",
        "js/PostConfig.js",
        "js/bootstrap.js",
        "js/main.js",
        "js/shapes-14-6-5.min.js",
        "js/stencils.min.js",
        "js/extensions.min.js",
        "styles/grapheditor.css",
        "resources/dia.txt",
        "templates/index.xml",
        "images/github-logo-white.svg",
    ] {
        assert!(into.join(file).is_file(), "{file}");
    }
    // The licences the release carries, one in each folder of assets, kept beside the editor.
    for kept in [
        "img-LICENSE",
        "shapes-LICENSE",
        "stencils-LICENSE",
        "templates-LICENSE",
        "js-libavoid-js-LICENSE",
    ] {
        assert!(into.join("legal").join(kept).is_file(), "legal/{kept}");
    }
    assert!(!into.join("WEB-INF").exists() && !into.join("META-INF").exists());
    println!("unpacked {unpacked:?}");
}

#[test]
fn a_web_app_inside_a_webapp_folder_is_found_there() {
    let scratch = Scratch::new();
    let war = raw_zip(&[
        ("webapp/index.html", INDEX.as_bytes(), 0),
        ("webapp/js/app.js", b"x", 0),
        ("webapp/WEB-INF/web.xml", b"<x/>", 0),
        ("server/Main.java", b"class Main {}", 0),
        ("README.md", b"outside the web app", 0),
    ]);
    let (result, into) = run(&scratch, &war, &LIMITS);
    let unpacked = result.unwrap();
    assert_eq!((unpacked.files, unpacked.skipped), (2, 3));
    assert!(into.join("index.html").is_file() && into.join("js/app.js").is_file());
    assert!(!into.join("server").exists() && !into.join("README.md").exists());
}

#[test]
fn the_licence_files_of_the_folders_of_the_web_app_are_kept_with_it_and_those_of_the_server_are_not()
 {
    let scratch = Scratch::new();
    // The real release has no licence at its top: its folders of pictures, shapes
    // and templates each have one (some without an extension).
    let war = raw_zip(&[
        ("index.html", INDEX.as_bytes(), 0),
        ("img/LICENSE", b"images", 0),
        ("shapes/LICENSE.txt", b"shapes", 0),
        ("js/libavoid-js/LICENSE", b"routing", 0),
        ("js/libavoid-js/readme.exe", b"x", 0),
        ("WEB-INF/LICENSE", b"server", 0),
        ("tools/license.exe", b"MZ", 0),
    ]);
    let (result, into) = run(&scratch, &war, &LIMITS);
    let unpacked = result.unwrap();
    assert_eq!((unpacked.files, unpacked.skipped), (4, 3));
    for (kept, text) in [
        ("img-LICENSE", "images"),
        ("shapes-LICENSE.txt", "shapes"),
        ("js-libavoid-js-LICENSE", "routing"),
    ] {
        assert_eq!(
            fs::read_to_string(into.join("legal").join(kept)).unwrap(),
            text,
            "{kept}"
        );
    }
    // Not where the web app serves its files from, and nothing of the server's.
    assert!(!into.join("img").exists() && !into.join("WEB-INF").exists());
    assert!(!into.join("legal/WEB-INF-LICENSE").exists());
}

#[test]
fn only_the_kinds_of_file_a_web_app_is_made_of_are_kept() {
    let scratch = Scratch::new();
    let war = raw_zip(&[
        ("index.html", INDEX.as_bytes(), 0),
        ("run.exe", b"MZ", 0),
        ("tool.jsp", b"<% %>", 0),
        ("Thing.class", b"\xca\xfe", 0),
        ("lib/native.dll", b"MZ", 0),
        ("noextension", b"x", 0),
        ("fonts/a.WOFF2", b"font", 0),
    ]);
    let (result, into) = run(&scratch, &war, &LIMITS);
    let unpacked = result.unwrap();
    assert_eq!((unpacked.files, unpacked.skipped), (2, 5));
    assert!(into.join("fonts/a.WOFF2").is_file());
    for gone in [
        "run.exe",
        "tool.jsp",
        "Thing.class",
        "lib/native.dll",
        "noextension",
    ] {
        assert!(!into.join(gone).exists(), "{gone}");
    }
}

#[test]
fn a_name_that_could_leave_the_folder_refuses_the_whole_download() {
    for name in [
        "../evil.js",
        "js/../../evil.js",
        "/abs/evil.js",
        "a\\b.js",
        "..\\evil.js",
        "C:/evil.js",
        "js/c:evil.js",
        "js//a.js",
        "js/./a.js",
        "js/a.js.",
        "js/a.js ",
        "con.js",
        "js/NUL",
        "js/com1.txt",
        "",
    ] {
        let scratch = Scratch::new();
        let war = raw_zip(&[("index.html", INDEX.as_bytes(), 0), (name, b"x", 0)]);
        let (result, into) = run(&scratch, &war, &LIMITS);
        let message = why(result);
        assert!(message.contains("unsafe name"), "{name:?}: {message}");
        assert!(
            !into.exists(),
            "{name:?}: nothing is unpacked before every name is checked"
        );
        assert!(!scratch.path("evil.js").exists());
    }
}

#[test]
fn a_link_in_the_archive_is_refused() {
    let scratch = Scratch::new();
    // A Unix symbolic link: mode 0o120777.
    let war = raw_zip(&[
        ("index.html", INDEX.as_bytes(), 0),
        ("js/link.js", b"/etc/passwd", 0o120_777),
    ]);
    let (result, into) = run(&scratch, &war, &LIMITS);
    assert!(why(result).contains("link"));
    assert!(!into.exists());
}

#[test]
fn an_archive_with_no_web_app_is_refused() {
    let scratch = Scratch::new();
    let war = raw_zip(&[("WEB-INF/web.xml", b"<x/>", 0), ("page.html", b"x", 0)]);
    let (result, _) = run(&scratch, &war, &LIMITS);
    assert!(why(result).contains("index.html"));
    let (result, _) = run(&scratch, b"this is not a zip", &LIMITS);
    assert!(why(result).contains("not a ZIP"));
}

#[test]
fn too_many_entries_or_too_many_bytes_are_refused() {
    let scratch = Scratch::new();
    let war = fake_war();
    let few = Limits {
        entries: 9,
        ..LIMITS
    };
    let message = why(run(&scratch, &war, &few).0);
    assert!(
        message.contains("10 files") && message.contains("9"),
        "{message}"
    );
    let small = Limits {
        bytes: 40,
        ..LIMITS
    };
    assert!(why(run(&scratch, &war, &small).0).contains("unpacks to"));
    // Exactly at the limits is fine.
    let exact = Limits {
        entries: 10,
        ..LIMITS
    };
    assert!(run(&scratch, &war, &exact).0.is_ok());
}

#[test]
fn a_limit_under_what_the_archive_declares_stops_before_anything_is_written() {
    let scratch = Scratch::new();
    let tight = Limits {
        bytes: 60,
        ..LIMITS
    };
    let (result, into) = run(&scratch, &fake_war(), &tight);
    assert!(why(result).contains("unpacks to"));
    assert!(!into.exists());
}

#[test]
fn cancelling_stops_the_unpacking() {
    let scratch = Scratch::new();
    let file = scratch.path("download.war");
    fs::write(&file, fake_war()).unwrap();
    let cancel = AtomicBool::new(false);
    let result = extract(
        &file,
        &scratch.path("unpacked"),
        &LIMITS,
        &cancel,
        &|done, _| {
            if done == 2 {
                cancel.store(true, Ordering::Relaxed);
            }
        },
    );
    assert_eq!(result, Err(Failure::Cancelled));
}

#[test]
fn progress_counts_up_to_the_total() {
    let scratch = Scratch::new();
    let file = scratch.path("download.war");
    fs::write(&file, fake_war()).unwrap();
    let seen = std::sync::Mutex::new(Vec::new());
    extract(
        &file,
        &scratch.path("unpacked"),
        &LIMITS,
        &AtomicBool::new(false),
        &|done, total| {
            seen.lock().unwrap().push((done, total));
        },
    )
    .unwrap();
    let seen = seen.into_inner().unwrap();
    assert_eq!(seen.first(), Some(&(0, 10)));
    assert_eq!(seen.last(), Some(&(10, 10)));
}
