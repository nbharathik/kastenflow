//! Installing from a server on this computer that stands in for GitHub: the
//! pinned hash decides, whatever else arrives; nothing is left behind by a
//! failure; an installed copy lives until a whole new one is ready.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Url;

use super::support::{
    INDEX, Reply, Scratch, block_on, fake_war, local, raw_zip, serve, source_for,
};
use crate::diagrams::extract::{Failure, LIMITS};
use crate::diagrams::install::{
    PARTIAL, Phase, Progress, VERSION_FILE, client, install, release_host,
};
use crate::diagrams::pinned::Source;

type Heard = Arc<Mutex<Vec<Progress>>>;

fn run(
    source: &Source,
    root: &Path,
    cancel: &Arc<AtomicBool>,
    on_progress: impl Fn(Progress) + Send + Sync + 'static,
) -> (Result<(), Failure>, Heard) {
    let heard: Heard = Arc::default();
    let record = Arc::clone(&heard);
    let report: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(move |progress| {
        record.lock().unwrap().push(progress);
        on_progress(progress);
    });
    let result = block_on(async {
        let web = client(local).unwrap();
        install(&web, source, root, LIMITS, Arc::clone(cancel), report).await
    });
    (result, heard)
}

fn quiet(source: &Source, root: &Path) -> Result<(), Failure> {
    run(source, root, &Arc::new(AtomicBool::new(false)), |_| {}).0
}

fn why(result: Result<(), Failure>) -> String {
    match result {
        Err(Failure::Failed(why)) => why,
        other => panic!("expected a failure, got {other:?}"),
    }
}

/// Nothing but what an installed editor leaves: no half-done download, no
/// half-unpacked copy, no copy set aside.
fn tidy(root: &Path) {
    for name in [PARTIAL, "1.0.0.installing", "1.0.0.replaced"] {
        assert!(!root.join(name).exists(), "{name} is left behind");
    }
}

#[test]
fn installs_the_release_it_is_pinned_to() {
    let scratch = Scratch::new();
    let war = fake_war();
    let base = serve(vec![("/draw.war", Reply::body(war.clone()))]);
    let source = source_for(&format!("{base}/draw.war"), &war);
    let root = scratch.path("diagrams");

    let (result, heard) = run(&source, &root, &Arc::new(AtomicBool::new(false)), |_| {});
    result.unwrap();
    let editor = root.join("1.0.0");
    assert_eq!(
        fs::read_to_string(editor.join("index.html")).unwrap(),
        INDEX
    );
    assert_eq!(
        fs::read_to_string(editor.join(VERSION_FILE)).unwrap(),
        "1.0.0"
    );
    assert!(editor.join("js/app.min.js").is_file() && editor.join("legal/NOTICE").is_file());
    assert!(!editor.join("WEB-INF").exists());
    tidy(&root);

    let heard = heard.lock().unwrap();
    let phases: Vec<Phase> = heard.iter().map(|p| p.phase).collect();
    let first = |phase| phases.iter().position(|p| *p == phase).unwrap();
    assert!(first(Phase::Downloading) < first(Phase::Verifying));
    assert!(first(Phase::Verifying) < first(Phase::Extracting));
    let downloaded = heard
        .iter()
        .rfind(|p| p.phase == Phase::Downloading)
        .unwrap();
    assert_eq!(
        (downloaded.done, downloaded.total),
        (war.len() as u64, war.len() as u64)
    );
    let last = heard.last().unwrap();
    assert_eq!((last.phase, last.done), (Phase::Extracting, last.total));
}

#[test]
fn a_download_that_does_not_match_the_pinned_hash_is_refused_before_anything_is_unpacked() {
    let scratch = Scratch::new();
    let war = fake_war();
    // The same size, one byte different: only the hash can tell.
    let mut other = war.clone();
    other[40] ^= 1;
    let base = serve(vec![("/draw.war", Reply::body(other))]);
    let source = source_for(&format!("{base}/draw.war"), &war);
    let root = scratch.path("diagrams");

    let message = why(quiet(&source, &root));
    assert!(message.contains("checksum"), "{message}");
    assert!(!root.join("1.0.0").exists());
    tidy(&root);
}

#[test]
fn an_editor_that_is_installed_stays_when_a_new_download_fails() {
    let scratch = Scratch::new();
    let war = fake_war();
    let good = serve(vec![("/draw.war", Reply::body(war.clone()))]);
    let root = scratch.path("diagrams");
    quiet(&source_for(&format!("{good}/draw.war"), &war), &root).unwrap();

    let mut other = war.clone();
    other[40] ^= 1;
    let bad = serve(vec![("/draw.war", Reply::body(other))]);
    assert!(quiet(&source_for(&format!("{bad}/draw.war"), &war), &root).is_err());
    assert_eq!(
        fs::read_to_string(root.join("1.0.0").join(VERSION_FILE)).unwrap(),
        "1.0.0"
    );
    assert!(root.join("1.0.0/index.html").is_file());
    tidy(&root);
}

#[test]
fn a_download_that_breaks_the_unpacking_rules_installs_nothing_whatever_its_hash() {
    let scratch = Scratch::new();
    let war = raw_zip(&[("index.html", INDEX.as_bytes(), 0), ("../evil.js", b"x", 0)]);
    let base = serve(vec![("/draw.war", Reply::body(war.clone()))]);
    let source = source_for(&format!("{base}/draw.war"), &war);
    let root = scratch.path("diagrams");

    let message = why(quiet(&source, &root));
    assert!(message.contains("unsafe name"), "{message}");
    assert!(!root.join("1.0.0").exists());
    assert!(!scratch.path("evil.js").exists());
    tidy(&root);
}

#[test]
fn a_download_bigger_or_smaller_than_the_pinned_size_is_refused() {
    let scratch = Scratch::new();
    let war = fake_war();
    let base = serve(vec![("/draw.war", Reply::body(war.clone()))]);
    let root = scratch.path("diagrams");

    let mut smaller_pin = source_for(&format!("{base}/draw.war"), &war);
    smaller_pin.size -= 10;
    assert!(why(quiet(&smaller_pin, &root)).contains("bigger"));
    tidy(&root);

    let mut bigger_pin = source_for(&format!("{base}/draw.war"), &war);
    bigger_pin.size += 10;
    assert!(why(quiet(&bigger_pin, &root)).contains("Only"));
    tidy(&root);
    assert!(!root.join("1.0.0").exists());
}

#[test]
fn a_server_that_says_no_is_told_plainly() {
    let scratch = Scratch::new();
    let base = serve(vec![("/draw.war", Reply::Status(404))]);
    let source = source_for(&format!("{base}/draw.war"), b"x");
    let message = why(quiet(&source, &scratch.path("diagrams")));
    assert!(message.contains("404"), "{message}");
    // A server that is not there at all.
    let gone = source_for("http://127.0.0.1:9/draw.war", b"x");
    assert!(why(quiet(&gone, &scratch.path("diagrams"))).contains("Could not download"));
}

#[test]
fn a_redirect_is_followed_only_to_an_address_the_download_may_come_from() {
    let scratch = Scratch::new();
    let war = fake_war();
    let base = serve(vec![
        ("/draw.war", Reply::Redirect("/real.war".to_owned())),
        ("/real.war", Reply::body(war.clone())),
        (
            "/away.war",
            Reply::Redirect("http://example.invalid/draw.war".to_owned()),
        ),
        ("/loop.war", Reply::Redirect("/loop.war".to_owned())),
    ]);
    let root = scratch.path("diagrams");
    // Within the allowed address: followed.
    quiet(&source_for(&format!("{base}/draw.war"), &war), &root).unwrap();
    assert!(root.join("1.0.0/index.html").is_file());
    // Elsewhere, or forever: refused, and nothing new is installed.
    let other = scratch.path("other");
    for path in ["away.war", "loop.war"] {
        let message = why(quiet(&source_for(&format!("{base}/{path}"), &war), &other));
        assert!(message.contains("redirect"), "{path}: {message}");
        assert!(!other.join("1.0.0").exists());
    }
}

#[test]
fn cancelling_stops_the_download_and_leaves_nothing() {
    let scratch = Scratch::new();
    let war = fake_war();
    let base = serve(vec![(
        "/draw.war",
        Reply::Body {
            bytes: war.clone(),
            piece: 60,
            pause: Duration::from_millis(30),
        },
    )]);
    let source = source_for(&format!("{base}/draw.war"), &war);
    let root = scratch.path("diagrams");
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&cancel);
    let (result, heard) = run(&source, &root, &cancel, move |_| {
        stop.store(true, Ordering::Relaxed)
    });
    assert_eq!(result, Err(Failure::Cancelled));
    assert!(heard.lock().unwrap().len() < 5, "it stopped early");
    assert!(!root.join("1.0.0").exists());
    tidy(&root);
}

#[test]
fn a_second_install_replaces_the_first() {
    let scratch = Scratch::new();
    let root = scratch.path("diagrams");
    let first = fake_war();
    let a = serve(vec![("/draw.war", Reply::body(first.clone()))]);
    quiet(&source_for(&format!("{a}/draw.war"), &first), &root).unwrap();
    fs::write(root.join("1.0.0/stray.txt"), "left by the first").unwrap();

    let second = raw_zip(&[("index.html", b"<title>second</title>", 0)]);
    let b = serve(vec![("/draw.war", Reply::body(second.clone()))]);
    quiet(&source_for(&format!("{b}/draw.war"), &second), &root).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("1.0.0/index.html")).unwrap(),
        "<title>second</title>"
    );
    assert!(
        !root.join("1.0.0/stray.txt").exists(),
        "the whole copy is replaced, not mixed"
    );
    tidy(&root);
}

#[test]
fn the_download_may_come_only_from_github() {
    let url = |s: &str| Url::parse(s).unwrap();
    for yes in [
        "https://github.com/jgraph/drawio/releases/download/v32.2.0/draw.war",
        "https://objects.githubusercontent.com/github-production-release-asset/1",
        "https://release-assets.githubusercontent.com/x",
        "https://githubusercontent.com/x",
    ] {
        assert!(release_host(&url(yes)), "{yes}");
    }
    for no in [
        "http://github.com/x",
        "https://github.com.evil.example/x",
        "https://evilgithub.com/x",
        "https://notgithubusercontent.com/x",
        "https://githubusercontent.com.evil.example/x",
        "https://user@github.com/x",
        "https://127.0.0.1/x",
        "ftp://github.com/x",
        "file:///etc/passwd",
    ] {
        assert!(!release_host(&url(no)), "{no}");
    }
    assert!(client(release_host).is_ok());
}

#[test]
fn the_pinned_release_is_the_one_checked() {
    use crate::diagrams::pinned::{SHA256, SIZE, Source, URL, VERSION};
    let pinned = Source::pinned();
    assert_eq!(
        (
            pinned.version.as_str(),
            pinned.url.as_str(),
            pinned.sha256.as_str(),
            pinned.size
        ),
        (VERSION, URL, SHA256, SIZE)
    );
    assert_eq!(SHA256.len(), 64);
    assert!(SHA256.bytes().all(|b| b.is_ascii_hexdigit()));
    assert!(release_host(&Url::parse(URL).unwrap()));
    assert!(URL.contains(&format!("v{VERSION}")));
}
