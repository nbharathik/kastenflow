//! `kasten init`: a new vault with Kasten's folders, default templates and
//! tags, a config, and history from the first minute.

use std::fs;

use kasten_core::config::FORMAT;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, ulid_at};

#[test]
fn creates_a_ready_to_use_vault_and_never_overwrites() {
    let dir = std::env::temp_dir().join(format!("kasten-init-{}", ulid_at(Instant::now().millis)));
    let k = Kasten::init(&dir, "My notes").unwrap();
    for folder in [
        "inbox",
        "journal",
        "projects",
        "library",
        "sources",
        "chats",
        "templates",
        "tags",
        "assets",
        ".kasten/proposals",
    ] {
        assert!(dir.join(folder).is_dir(), "{folder}");
    }
    for template in [
        "page",
        "card",
        "journal",
        "paper",
        "project",
        "meeting",
        "reading",
        "experiment",
        "travel",
        "weekly-review",
        "goals",
        "lecture",
        "decision",
    ] {
        assert!(
            dir.join(format!("templates/{template}.md")).is_file(),
            "{template}"
        );
    }
    for tag in ["task", "paper", "experiment", "meeting", "capture"] {
        assert!(dir.join(format!("tags/{tag}.yaml")).is_file(), "{tag}");
    }
    assert_eq!(k.config().name, "My notes");
    assert!(k.has_history());
    assert_eq!(k.log(None, 5).unwrap()[0].summary, "init: My notes");
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty().unwrap());
    // A new vault is blank: templates wait in templates/, and no page is
    // made until someone writes one.
    let pages: Vec<String> = k
        .list()
        .unwrap()
        .into_iter()
        .filter(|n| n.kind != "template")
        .map(|n| n.path)
        .collect();
    assert!(pages.is_empty(), "{pages:?}");

    // A second init keeps what is there.
    fs::write(dir.join("templates/travel.md"), "mine\n").unwrap();
    let again = Kasten::init(&dir, "Other name").unwrap();
    assert_eq!(
        fs::read_to_string(dir.join("templates/travel.md")).unwrap(),
        "mine\n"
    );
    assert_eq!(again.config().name, "My notes");
    drop(again);
    drop(k);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_tour_page_is_added_only_when_asked() {
    let dir = std::env::temp_dir().join(format!("kasten-tour-{}", ulid_at(Instant::now().millis)));
    let k = Kasten::init(&dir, "Tour").unwrap();
    assert!(k.list().unwrap().iter().all(|n| n.kind == "template"));

    let path = k.add_tour(&Actor::Human, Instant::now()).unwrap();
    assert_eq!(path, "library/welcome-to-kasten.md");
    let tour = k.read(&path).unwrap();
    assert_eq!(tour.meta.title, "Welcome to KastenFlow");
    assert!(
        tour.text.contains("Organise when you are ready"),
        "{}",
        tour.text
    );
    assert!(
        tour.text.contains("\nKastenFlow is a quiet place"),
        "{}",
        tour.text
    );
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "tour: Welcome to KastenFlow"
    );
    assert!(k.dirty().unwrap().is_empty());

    // Asking again opens the same page and changes nothing, even after edits.
    let edited = format!("{}\nMy own line.\n", tour.text);
    fs::write(dir.join(&path), &edited).unwrap();
    k.outside_changes(std::slice::from_ref(&path), Instant::now().millis);
    assert_eq!(k.add_tour(&Actor::Human, Instant::now()).unwrap(), path);
    assert_eq!(fs::read_to_string(dir.join(&path)).unwrap(), edited);
    drop(k);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_vault_names_its_format_and_a_newer_one_is_left_alone() {
    let dir =
        std::env::temp_dir().join(format!("kasten-format-{}", ulid_at(Instant::now().millis)));
    let k = Kasten::init(&dir, "My notes").unwrap();
    assert_eq!(k.config().format, FORMAT);
    let config = dir.join(".kasten/config.yaml");
    let text = fs::read_to_string(&config).unwrap();
    assert!(text.contains(&format!("format: {FORMAT}")), "{text}");
    drop(k);

    // A vault from a newer Kasten is refused with the reason, untouched.
    fs::remove_dir_all(dir.join(".kasten/cache")).ok();
    fs::write(
        &config,
        text.replace(
            &format!("format: {FORMAT}"),
            &format!("format: {}", FORMAT + 1),
        ),
    )
    .unwrap();
    let err = Kasten::open(&dir).expect_err("refused").to_string();
    assert!(err.contains("newer version of KastenFlow"), "{err}");
    assert!(err.contains("Update KastenFlow to open it"), "{err}");
    assert!(!dir.join(".kasten/cache").exists(), "nothing written");

    // Vaults made before formats were numbered are the first format.
    fs::write(&config, "name: Older notes\n").unwrap();
    assert_eq!(Kasten::open(&dir).unwrap().config().format, 1);
    let _ = fs::remove_dir_all(&dir);
}
