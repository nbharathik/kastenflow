//! Project setups (Research, Writing, Presentation): a few pages, a board and
//! sometimes a deck added to a new or an existing project as one commit that
//! undo takes back. The preview says exactly what the apply writes, nothing the
//! person has is ever overwritten, and agents cannot apply one.

mod existing;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, SetupTarget, setups, ulid_at};

const NOW: Instant = Instant {
    millis: 1_790_236_800_000,
};
const DAY: &str = "2026-09-24";

struct Fresh {
    dir: PathBuf,
    k: Kasten,
}

impl Drop for Fresh {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn fresh() -> Fresh {
    let dir = std::env::temp_dir().join(format!("kasten-setup-{}", ulid_at(Instant::now().millis)));
    let k = Kasten::init(&dir, "Setups").unwrap();
    Fresh { dir, k }
}

/// Every file of the vault but git's and Kasten's own, by path.
fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn new(title: &str) -> SetupTarget {
    SetupTarget::New {
        title: title.to_owned(),
    }
}

fn existing(folder: &str) -> SetupTarget {
    SetupTarget::Existing {
        folder: folder.to_owned(),
    }
}

fn text(f: &Fresh, path: &str) -> String {
    fs::read_to_string(f.dir.join(path)).unwrap()
}

#[test]
fn offers_research_writing_and_presentation() {
    let all = setups();
    let ids: Vec<&str> = all.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["research", "writing", "presentation"]);
    for s in &all {
        assert!(
            !s.name.is_empty() && !s.summary.is_empty() && !s.icon.is_empty(),
            "{}",
            s.id
        );
    }
    let files = |id: &str| all.iter().find(|s| s.id == id).unwrap().files.clone();
    assert_eq!(
        files("research"),
        [
            "boards/literature-map.canvas",
            "pages/literature-review.md",
            "pages/research-questions.md"
        ]
    );
    assert_eq!(
        files("writing"),
        [
            "boards/structure.canvas",
            "pages/draft.md",
            "pages/outline.md",
            "pages/style-sheet.md"
        ]
    );
    assert_eq!(
        files("presentation"),
        [
            "boards/storyboard.canvas",
            "decks/talk.deck",
            "pages/talk-notes.md"
        ]
    );
    assert_eq!(all[0].tags, ["experiment", "reading"]);
    assert!(all[1].tags.is_empty() && all[2].tags.is_empty());
}

#[test]
fn every_file_in_a_setup_folder_ships_with_it() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("defaults/setups");
    for setup in setups() {
        let mut on_disk: Vec<String> = tree(&base.join(&setup.id))
            .into_keys()
            .filter(|p| p != "setup.json")
            .collect();
        on_disk.sort();
        let mut listed: Vec<String> = setup.files.clone();
        listed.extend(setup.tags.iter().map(|t| format!("vault/tags/{t}.yaml")));
        listed.sort();
        assert_eq!(listed, on_disk, "{}", setup.id);
    }
}

#[test]
fn a_new_project_gets_its_page_and_files_in_one_commit_the_preview_foretold() {
    for setup in setups() {
        let f = fresh();
        let before = tree(&f.dir);
        let last = f.k.log(None, 1).unwrap()[0].id.clone();
        let plan = f.k.preview_setup(&setup.id, &new("My Thesis")).unwrap();
        assert_eq!(
            plan.project_path, "projects/my-thesis/_project.md",
            "{}",
            setup.id
        );
        assert_eq!(plan.props, ["status"]);
        assert_eq!(tree(&f.dir), before, "a preview writes nothing");

        let done =
            f.k.apply_setup(&Actor::Human, &setup.id, &new("My Thesis"), NOW)
                .unwrap();
        assert_eq!(done.project_path, plan.project_path);
        assert_eq!(done.home, plan.home);
        assert_eq!(
            done.written, plan.create,
            "{}: written is what was foretold",
            setup.id
        );
        assert_eq!(done.kept, plan.keep);
        assert!(plan.create.contains(&plan.project_path));
        assert!(
            plan.home.starts_with("projects/my-thesis/") && f.dir.join(&plan.home).is_file(),
            "{}",
            plan.home
        );

        let log = f.k.log(None, 2).unwrap();
        assert_eq!(log[1].id, last, "{}: one commit", setup.id);
        assert_eq!(done.commit.as_deref(), Some(log[0].id.as_str()));
        assert_eq!(
            log[0].summary,
            format!("setup: add {} to My Thesis", setup.name)
        );
        assert!(
            log[0]
                .message
                .contains(&format!("Kasten-Setup: {}", setup.id)),
            "{}",
            log[0].message
        );

        let page = f.k.read(&plan.project_path).unwrap();
        assert_eq!(
            (page.meta.title.as_str(), page.meta.kind.as_str()),
            ("My Thesis", "project")
        );
        assert_eq!(page.meta.props["status"], "Active");
        let problems = f.k.verify().unwrap().problems;
        assert!(problems.is_empty(), "{}: {problems:?}", setup.id);
        // Nothing is left to fill in.
        for path in &done.written {
            let body = text(&f, path);
            assert!(!body.contains("{{"), "{path}: {body}");
        }

        f.k.undo_commit(done.commit.as_deref().unwrap(), NOW)
            .unwrap();
        assert_eq!(
            tree(&f.dir),
            before,
            "{}: undo takes it all back, the project too",
            setup.id
        );
    }
}

#[test]
fn placeholders_are_filled_with_the_project_its_folder_and_fresh_ids() {
    let f = fresh();
    let done =
        f.k.apply_setup(&Actor::Human, "research", &new("Sleep and memory"), NOW)
            .unwrap();
    let questions = text(&f, "projects/sleep-and-memory/pages/research-questions.md");
    assert!(
        questions.contains("The questions behind Sleep and memory,"),
        "{questions}"
    );
    let review = text(&f, "projects/sleep-and-memory/pages/literature-review.md");
    assert!(review.contains("![[tags/reading.yaml#This project]]"));
    let ids: Vec<&str> = [&questions, &review]
        .iter()
        .map(|t| t.lines().find_map(|l| l.strip_prefix("id: ")).unwrap())
        .collect();
    assert!(
        ids.iter().all(|id| id.len() == 26) && ids[0] != ids[1],
        "{ids:?}"
    );
    assert!(
        done.written.contains(&"tags/reading.yaml".to_owned()),
        "{:?}",
        done.written
    );
    // The embed's view is in the tag's schema.
    assert!(text(&f, "tags/reading.yaml").contains("name: This project,"));
}

#[test]
fn a_project_name_with_quotes_makes_valid_decks_and_boards() {
    let f = fresh();
    let title = "The \"Big\" Talk \\ 2";
    let done =
        f.k.apply_setup(&Actor::Human, "presentation", &new(title), NOW)
            .unwrap();
    let deck_path = done.written.iter().find(|p| p.ends_with(".deck")).unwrap();
    let deck = text(&f, deck_path);
    let head = kasten_core::deck::head_of(&deck).unwrap();
    assert_eq!(head.title.as_deref(), Some("The \"Big\" Talk \\ 2 talk"));
    assert_eq!(head.slides, 1);
    let value: serde_json::Value = serde_json::from_str(&deck).unwrap();
    let id = value["id"].as_str().unwrap();
    assert!(
        id.starts_with("d-")
            && id.len() == 10
            && id[2..]
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
        "{id}"
    );
    assert_eq!(f.k.decks().unwrap().len(), 1);
    // Two projects made from it get decks with ids of their own.
    let other =
        f.k.apply_setup(&Actor::Human, "presentation", &new("Another"), NOW)
            .unwrap();
    let second: serde_json::Value = serde_json::from_str(&text(
        &f,
        other.written.iter().find(|p| p.ends_with(".deck")).unwrap(),
    ))
    .unwrap();
    assert_eq!(f.k.decks().unwrap().len(), 2);
    assert!(second["id"].as_str().unwrap().starts_with("d-"));
    assert_ne!(second["id"], value["id"]);
    for board in done.written.iter().filter(|p| p.ends_with(".canvas")) {
        assert!(
            serde_json::from_str::<serde_json::Value>(&text(&f, board)).is_ok(),
            "{board}"
        );
    }
}

#[test]
fn a_second_project_of_the_same_name_takes_the_next_folder() {
    let f = fresh();
    f.k.apply_setup(&Actor::Human, "writing", &new("Essay"), NOW)
        .unwrap();
    let plan = f.k.preview_setup("writing", &new("Essay")).unwrap();
    assert_eq!(plan.project_path, "projects/essay-2/_project.md");
    let done =
        f.k.apply_setup(&Actor::Human, "writing", &new("Essay"), NOW)
            .unwrap();
    assert_eq!(done.project_path, "projects/essay-2/_project.md");
    assert!(
        f.dir.join("projects/essay/pages/outline.md").is_file()
            && f.dir.join("projects/essay-2/pages/outline.md").is_file()
    );
}
