//! The generic installer with a plugin of its own (a single program file, not
//! a web app): the pinned hash and size decide, whatever else arrives;
//! nothing is left behind by a failure or a cancel; an installed copy lives
//! until a whole new one is ready; an old copy kept by an earlier version of
//! the app is taken in once.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::diagrams::tests::support::{Reply, Scratch, block_on, local, serve, source_for};
use crate::plugins::payload::{
    Failure, PARTIAL, Phase, Progress, Source, Spec, VERSION_FILE, adopt_legacy, client, failed,
    install, installed_version,
};

type Heard = Arc<Mutex<Vec<Progress>>>;

/// A payload that is one file: unpacking puts the download in as `tool.bin`.
fn single_file() -> Spec {
    Spec {
        label: "the test tool".to_owned(),
        required: "tool.bin",
        unpack: Arc::new(|download, into, cancel, progress| {
            if cancel.load(Ordering::Relaxed) {
                return Err(Failure::Cancelled);
            }
            fs::create_dir_all(into).map_err(|e| Failure::Failed(e.to_string()))?;
            fs::copy(download, into.join("tool.bin"))
                .map_err(|e| Failure::Failed(e.to_string()))?;
            progress(1, 1);
            Ok(())
        }),
    }
}

/// A payload whose unpacker always refuses.
fn refusing() -> Spec {
    Spec {
        label: "the test tool".to_owned(),
        required: "tool.bin",
        unpack: Arc::new(|_, _, _, _| failed("The archive breaks the rules")),
    }
}

/// A payload whose unpacker forgets the file a whole copy holds.
fn forgetful() -> Spec {
    Spec {
        label: "the test tool".to_owned(),
        required: "tool.bin",
        unpack: Arc::new(|_, into, _, _| {
            fs::create_dir_all(into).map_err(|e| Failure::Failed(e.to_string()))?;
            fs::write(into.join("other.txt"), "x").map_err(|e| Failure::Failed(e.to_string()))
        }),
    }
}

fn payload() -> Vec<u8> {
    (0..4000u32).map(|n| (n % 251) as u8).collect()
}

fn run(
    source: &Source,
    root: &Path,
    spec: &Spec,
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
        install(&web, source, root, spec, Arc::clone(cancel), report).await
    });
    (result, heard)
}

fn quiet(source: &Source, root: &Path, spec: &Spec) -> Result<(), Failure> {
    run(
        source,
        root,
        spec,
        &Arc::new(AtomicBool::new(false)),
        |_| {},
    )
    .0
}

fn why(result: Result<(), Failure>) -> String {
    match result {
        Err(Failure::Failed(why)) => why,
        other => panic!("expected a failure, got {other:?}"),
    }
}

/// Nothing but what an installed payload leaves: no half-done download, no
/// half-unpacked copy, no copy set aside.
fn tidy(root: &Path) {
    for name in [PARTIAL, "1.0.0.installing", "1.0.0.replaced"] {
        assert!(!root.join(name).exists(), "{name} is left behind");
    }
}

#[test]
fn installs_the_release_into_a_folder_of_its_version() {
    let scratch = Scratch::new();
    let bytes = payload();
    let base = serve(vec![("/tool", Reply::body(bytes.clone()))]);
    let source = source_for(&format!("{base}/tool"), &bytes);
    let root = scratch.path("plugins/latex");

    let (result, heard) = run(
        &source,
        &root,
        &single_file(),
        &Arc::new(AtomicBool::new(false)),
        |_| {},
    );
    result.unwrap();
    let dir = root.join("1.0.0");
    assert_eq!(fs::read(dir.join("tool.bin")).unwrap(), bytes);
    assert_eq!(fs::read_to_string(dir.join(VERSION_FILE)).unwrap(), "1.0.0");
    assert!(installed_version(&dir, "1.0.0", "tool.bin"));
    assert!(!installed_version(&dir, "2.0.0", "tool.bin"));
    assert!(!installed_version(&dir, "1.0.0", "missing"));
    tidy(&root);
    let heard = heard.lock().unwrap();
    let phases: Vec<Phase> = heard.iter().map(|p| p.phase).collect();
    let first = |phase| phases.iter().position(|p| *p == phase).unwrap();
    assert!(first(Phase::Downloading) < first(Phase::Verifying));
    assert!(first(Phase::Verifying) < first(Phase::Extracting));
}

#[test]
fn a_hash_mismatch_is_refused_and_nothing_is_placed() {
    let scratch = Scratch::new();
    let bytes = payload();
    let mut other = bytes.clone();
    other[40] ^= 1;
    let base = serve(vec![("/tool", Reply::body(other))]);
    let source = source_for(&format!("{base}/tool"), &bytes);
    let root = scratch.path("plugins/latex");

    let message = why(quiet(&source, &root, &single_file()));
    assert!(message.contains("damaged or changed"), "{message}");
    assert!(!root.join("1.0.0").exists());
    tidy(&root);
}

#[test]
fn a_size_mismatch_either_way_is_refused_and_nothing_is_placed() {
    let scratch = Scratch::new();
    let bytes = payload();
    let base = serve(vec![("/tool", Reply::body(bytes.clone()))]);
    let root = scratch.path("plugins/latex");

    let mut smaller_pin = source_for(&format!("{base}/tool"), &bytes);
    smaller_pin.size -= 10;
    let message = why(quiet(&smaller_pin, &root, &single_file()));
    assert!(message.contains("bigger"), "{message}");
    tidy(&root);

    let mut bigger_pin = source_for(&format!("{base}/tool"), &bytes);
    bigger_pin.size += 10;
    let message = why(quiet(&bigger_pin, &root, &single_file()));
    assert!(
        message.contains("Only") && message.contains("the test tool"),
        "{message}"
    );
    tidy(&root);
    assert!(!root.join("1.0.0").exists());
}

#[test]
fn a_cancel_mid_download_leaves_no_partial_folder_or_file() {
    let scratch = Scratch::new();
    let bytes = payload();
    let base = serve(vec![(
        "/tool",
        Reply::Body {
            bytes: bytes.clone(),
            piece: 60,
            pause: Duration::from_millis(30),
        },
    )]);
    let source = source_for(&format!("{base}/tool"), &bytes);
    let root = scratch.path("plugins/latex");
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&cancel);
    let (result, heard) = run(&source, &root, &single_file(), &cancel, move |_| {
        stop.store(true, Ordering::Relaxed)
    });
    assert_eq!(result, Err(Failure::Cancelled));
    assert!(heard.lock().unwrap().len() < 5, "it stopped early");
    assert!(!root.join("1.0.0").exists());
    tidy(&root);
}

#[test]
fn an_installed_copy_stays_when_a_new_download_fails_or_unpacks_badly() {
    let scratch = Scratch::new();
    let bytes = payload();
    let good = serve(vec![("/tool", Reply::body(bytes.clone()))]);
    let root = scratch.path("plugins/latex");
    quiet(
        &source_for(&format!("{good}/tool"), &bytes),
        &root,
        &single_file(),
    )
    .unwrap();

    // The new download does not match.
    let mut other = bytes.clone();
    other[40] ^= 1;
    let bad = serve(vec![("/tool", Reply::body(other))]);
    let pinned = source_for(&format!("{bad}/tool"), &bytes);
    assert!(quiet(&pinned, &root, &single_file()).is_err());
    // The new download matches but its archive is refused, or is not whole.
    let pinned = source_for(&format!("{good}/tool"), &bytes);
    assert!(why(quiet(&pinned, &root, &refusing())).contains("rules"));
    assert!(why(quiet(&pinned, &root, &forgetful())).contains("tool.bin"));

    assert_eq!(fs::read(root.join("1.0.0/tool.bin")).unwrap(), bytes);
    assert!(installed_version(&root.join("1.0.0"), "1.0.0", "tool.bin"));
    tidy(&root);
}

#[test]
fn a_second_install_replaces_the_first_whole() {
    let scratch = Scratch::new();
    let root = scratch.path("plugins/latex");
    let first = payload();
    let a = serve(vec![("/tool", Reply::body(first.clone()))]);
    quiet(
        &source_for(&format!("{a}/tool"), &first),
        &root,
        &single_file(),
    )
    .unwrap();
    fs::write(root.join("1.0.0/stray.txt"), "left by the first").unwrap();

    let second = b"second release".to_vec();
    let b = serve(vec![("/tool", Reply::body(second.clone()))]);
    quiet(
        &source_for(&format!("{b}/tool"), &second),
        &root,
        &single_file(),
    )
    .unwrap();
    assert_eq!(fs::read(root.join("1.0.0/tool.bin")).unwrap(), second);
    assert!(!root.join("1.0.0/stray.txt").exists());
    tidy(&root);
}

#[test]
fn an_unreachable_server_is_told_in_the_plugins_words() {
    let scratch = Scratch::new();
    let gone = source_for("http://127.0.0.1:9/tool", b"x");
    let message = why(quiet(&gone, &scratch.path("plugins/latex"), &single_file()));
    assert!(
        message.contains("Could not download the test tool"),
        "{message}"
    );
}

#[test]
fn the_folder_an_earlier_version_kept_is_taken_in_once() {
    let scratch = Scratch::new();
    let old = scratch.path("diagrams");
    let new = scratch.path("plugins/diagrams");
    fs::create_dir_all(old.join("32.2.0")).unwrap();
    fs::write(old.join("32.2.0/index.html"), "<title>kept</title>").unwrap();
    fs::write(old.join("32.2.0").join(VERSION_FILE), "32.2.0").unwrap();

    assert!(adopt_legacy(&old, &new));
    assert!(!old.exists());
    assert!(installed_version(
        &new.join("32.2.0"),
        "32.2.0",
        "index.html"
    ));
    // Once: nothing is there to move now, and a copy already there is left.
    assert!(!adopt_legacy(&old, &new));
    fs::create_dir_all(&old).unwrap();
    fs::write(old.join("note.txt"), "x").unwrap();
    assert!(!adopt_legacy(&old, &new));
    assert!(old.join("note.txt").is_file());
    assert!(new.join("32.2.0/index.html").is_file());
}
