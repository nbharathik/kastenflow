//! The Conference Atlas fixture vault (`fixtures/smart`): a copy of it opens,
//! verifies clean, holds 18 venue notes under a `conference` tag, and its smart
//! page keeps to the smart limits.

use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::smart::check_listed;
use kasten_core::{Instant, Kasten, ulid_at};

const PAGE: &str = "projects/research/pages/conference-tracker.md";
const DIR: &str = "projects/research/pages/conference-tracker.smart";

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// A private copy of the fixture, removed when the test ends (never the fixture).
struct Copy {
    dir: PathBuf,
}

impl Drop for Copy {
    fn drop(&mut self) {
        // Only the test's own copy under the system temp folder.
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn copy_of_fixture() -> Copy {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/smart");
    let dir = std::env::temp_dir().join(format!(
        "kasten-smart-fixture-{}",
        ulid_at(Instant::now().millis)
    ));
    copy_dir(&source, &dir);
    // macOS reaches its temporary folder through a link; the engine resolves the folder it opens.
    #[cfg(unix)]
    let dir = kasten_core::local_paths::resolve_root(&dir).unwrap();
    Copy { dir }
}

#[test]
fn the_fixture_opens_and_verifies_clean_on_a_copy() {
    let copy = copy_of_fixture();
    let k = Kasten::open(&copy.dir).unwrap();
    k.start_history().unwrap();
    let report = k.verify().unwrap();
    assert!(report.problems.is_empty(), "{:?}", report.problems);
    // 18 venues, the project and the smart page.
    assert_eq!(report.notes, 20);
    assert!(report.git_objects > 0);
}

#[test]
fn the_fixture_has_eighteen_venues_under_one_tag_schema() {
    let copy = copy_of_fixture();
    let venues: Vec<String> = fs::read_dir(copy.dir.join("library"))
        .unwrap()
        .map(|e| fs::read_to_string(e.unwrap().path()).unwrap())
        .collect();
    assert_eq!(venues.len(), 18);
    assert!(venues.iter().all(|v| v.contains("tags: [conference]")));
    let estimates = venues
        .iter()
        .filter(|v| v.contains("deadline_status: est"))
        .count();
    assert!(estimates >= 3, "{estimates}");
    assert!(venues.iter().all(|v| v.contains("example.org")));
    let schema = fs::read_to_string(copy.dir.join("tags/conference.yaml")).unwrap();
    for key in [
        "abstract_deadline",
        "paper_deadline",
        "deadline_status",
        "city",
        "lat",
        "lon",
        "area",
        "url",
    ] {
        assert!(schema.contains(&format!("key: {key},")), "{key}");
    }
}

#[test]
fn the_smart_page_has_its_folder_and_keeps_to_the_limits() {
    let copy = copy_of_fixture();
    let k = Kasten::open(&copy.dir).unwrap();
    let listing = k.smart_read(PAGE).unwrap();
    assert!(listing.exists);
    assert!(listing.problems.is_empty(), "{:?}", listing.problems);
    assert!(listing.manifest.is_some(), "smart.yaml reads");
    let mut names: Vec<&str> = listing.files.iter().map(|f| f.path.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, ["app.js", "index.html", "smart.yaml"]);
    assert!(listing.files.iter().all(|f| f.allowed));
    let full: Vec<(String, u64)> = listing
        .files
        .iter()
        .map(|f| (format!("{DIR}/{}", f.path), f.size))
        .collect();
    check_listed(full.iter().map(|(p, n)| (p.as_str(), *n))).unwrap();
    // The page itself says it is a smart page.
    let page = fs::read_to_string(copy.dir.join(PAGE)).unwrap();
    assert!(page.contains("\nlayout: smart\n"));
}
