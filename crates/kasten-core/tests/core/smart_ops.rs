//! A person's ops on a smart page's folder: write a file, read it back, take
//! it out (to the trash, never for good) and put it back, set the manifest;
//! the page layout `smart`; search over the words `index.html` shows.

use crate::common::NOW;
use crate::smart_support::{
    PNG, all_files, changed, make_page, open, snapshot, there, tree, undo_last,
};

use kasten_core::Error;
use kasten_core::history::Actor;
use kasten_core::smart::hash_bytes;

const HTML: &[u8] = b"<html><body><h1>Pelican deadlines</h1></body></html>";

fn human() -> Actor {
    Actor::Human
}

#[test]
fn smart_is_a_layout_and_other_layouts_are_still_refused() {
    let (_t, k) = open();
    let p = make_page(&k, "Tracker", None, None);
    let note = k
        .set_meta(&human(), &p.meta.path, "layout", Some("smart"), NOW)
        .unwrap();
    assert!(note.text.contains("\nlayout: smart\n"), "{}", note.text);
    for bad in [
        "post",
        "Smart",
        "smart ",
        "SMART",
        "",
        "smart\nx: 1",
        "sections2",
    ] {
        let refused = k.set_meta(&human(), &p.meta.path, "layout", Some(bad), NOW);
        assert!(matches!(refused, Err(Error::Invalid(_))), "{bad:?}");
    }
    assert_eq!(k.read(&p.meta.path).unwrap().text, note.text);
    let cleared = k
        .set_meta(&human(), &p.meta.path, "layout", None, NOW)
        .unwrap();
    assert!(!cleared.text.contains("layout:"));
}

#[test]
fn a_file_is_written_read_back_and_committed_after_the_quiet_spell() {
    let (t, k) = open();
    let p = make_page(&k, "Tracker", None, None);
    let page = p.meta.path.as_str();
    let dir = "library/tracker.smart";

    let none = k.smart_read(page).unwrap();
    assert!(!none.exists && none.files.is_empty() && none.manifest.is_none());

    let made = k
        .smart_write_file(&human(), page, "index.html", HTML, Some(""), NOW)
        .unwrap();
    assert!(made.created && made.changed);
    assert_eq!(made.path, format!("{dir}/index.html"));
    assert_eq!(snapshot(&t, dir)["index.html"], HTML);
    let read = k.smart_file(page, "index.html").unwrap();
    assert_eq!(
        (read.bytes.as_slice(), read.hash.as_str()),
        (HTML, made.hash.as_str())
    );
    assert_eq!(made.hash, hash_bytes(HTML));

    // Typing is committed after the quiet spell, as one change of that file only.
    assert!(k.pending_edits().contains(&made.path));
    k.commit_edits().unwrap().unwrap();
    assert_eq!(changed(&k), [made.path.clone()].into_iter().collect());

    // Against the hash it was read with, a write goes over it.
    let second = k
        .smart_write_file(
            &human(),
            page,
            "index.html",
            b"<p>Two</p>",
            Some(&made.hash),
            NOW,
        )
        .unwrap();
    assert!(!second.created && second.changed);
    // The old hash is stale now, and "new" is wrong for a file that is there.
    for stale in [Some(made.hash.as_str()), Some("")] {
        let refused = k.smart_write_file(&human(), page, "index.html", b"<p>3</p>", stale, NOW);
        assert!(refused.is_err(), "{stale:?}");
    }
    assert_eq!(snapshot(&t, dir)["index.html"], b"<p>Two</p>");
    // Unchanged bytes write nothing and name no path.
    let same = k
        .smart_write_file(&human(), page, "index.html", b"<p>Two</p>", None, NOW)
        .unwrap();
    assert!(!same.changed && !same.created);
    k.commit_edits().unwrap();
    let before_same = k.log(None, 1).unwrap()[0].id.clone();
    k.smart_write_file(&human(), page, "index.html", b"<p>Two</p>", None, NOW)
        .unwrap();
    assert!(k.commit_edits().unwrap().is_none());
    assert_eq!(k.log(None, 1).unwrap()[0].id, before_same);

    // A picture is bytes, kept as they are.
    k.smart_write_file(&human(), page, "assets/p.png", PNG, Some(""), NOW)
        .unwrap();
    assert_eq!(k.smart_file(page, "assets/p.png").unwrap().bytes, PNG);

    let listing = k.smart_read(page).unwrap();
    assert!(listing.exists);
    let names: Vec<&str> = listing.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(names, ["assets/p.png", "index.html"]);
    assert_eq!(
        listing.total_bytes,
        (PNG.len() + b"<p>Two</p>".len()) as u64
    );
    assert!(listing.files.iter().all(|f| f.allowed));
}

#[test]
fn reading_a_folder_that_is_not_there_or_a_page_that_is_not_one_says_so() {
    let (t, k) = open();
    assert!(matches!(
        k.smart_read("library/nothing.md"),
        Err(Error::NotFound(_))
    ));
    assert!(k.smart_read("library/x.txt").is_err());
    assert!(k.smart_read("../x.md").is_err());
    assert!(k.smart_read(".trash/x.md").is_err());
    let p = make_page(&k, "Tracker", None, None);
    assert!(matches!(
        k.smart_file(&p.meta.path, "index.html"),
        Err(Error::NotFound(_))
    ));
    // A page inside another page's folder has no folder of its own.
    let inner = t.vault.root().join("library/tracker.smart");
    std::fs::create_dir_all(&inner).unwrap();
    std::fs::write(inner.join("inner.md"), "---\ntitle: Inner\n---\n").unwrap();
    assert!(k.smart_read("library/tracker.smart/inner.md").is_err());
    assert!(
        k.smart_write_file(
            &human(),
            "library/tracker.smart/inner.md",
            "a.js",
            b"x",
            None,
            NOW
        )
        .is_err()
    );
    // What is wrong with a folder is told in plain sentences.
    std::fs::write(inner.join("run.exe"), "MZ").unwrap();
    let listing = k.smart_read(&p.meta.path).unwrap();
    let problems = listing.problems.join(" | ");
    assert!(problems.contains("no index.html"), "{problems}");
    assert!(problems.contains("run.exe"), "{problems}");
    assert!(
        listing
            .files
            .iter()
            .any(|f| f.path == "run.exe" && !f.allowed)
    );
}

#[test]
fn the_manifest_is_checked_and_keeps_keys_it_does_not_know() {
    let (t, k) = open();
    let p = make_page(&k, "Tracker", None, None);
    let page = p.meta.path.as_str();
    let before = all_files(&t);
    for bad in [
        "",
        "title: ''\n",
        "title: [unclosed\n",
        "version: 9\ntitle: X\n",
        "title: X\nqueries:\n  'bad name':\n    tag: t\n",
    ] {
        let refused = k.smart_write_file(&human(), page, "smart.yaml", bad.as_bytes(), None, NOW);
        assert!(matches!(refused, Err(Error::Invalid(_))), "{bad:?}");
    }
    assert!(
        k.smart_write_file(&human(), page, "smart.yaml", &[0xff, 0xfe], None, NOW)
            .is_err()
    );
    assert_eq!(all_files(&t), before, "nothing was written");
    assert!(k.smart_manifest(page).unwrap().is_none());

    // A good one is kept as it was typed, comments and unknown keys too.
    let text = "# my page\nversion: 1\ntitle: Tracker\nfuture: {a: 1}\nqueries:\n  venues:\n    tag: conference\n    later: kept\n";
    k.smart_write_file(&human(), page, "smart.yaml", text.as_bytes(), Some(""), NOW)
        .unwrap();
    assert_eq!(
        snapshot(&t, "library/tracker.smart")["smart.yaml"],
        text.as_bytes()
    );
    let mut manifest = k.smart_manifest(page).unwrap().unwrap();
    assert_eq!(manifest.title, "Tracker");
    assert!(manifest.extra.contains_key("future"));

    // Set from the object: validated, unknown keys at every level survive.
    manifest.title = "Venue tracker".into();
    let base = k.smart_file(page, "smart.yaml").unwrap().hash;
    k.smart_set_manifest(&human(), page, &manifest, Some(&base), NOW)
        .unwrap();
    let written = String::from_utf8(k.smart_file(page, "smart.yaml").unwrap().bytes).unwrap();
    assert!(
        written.contains("Venue tracker")
            && written.contains("future")
            && written.contains("later: kept"),
        "{written}"
    );
    let again = k.smart_manifest(page).unwrap().unwrap();
    assert_eq!(again, manifest);
    assert_eq!(changed(&k).len(), 1);

    manifest.title = "  ".into();
    assert!(
        k.smart_set_manifest(&human(), page, &manifest, None, NOW)
            .is_err()
    );
    // The stale hash is refused here too.
    manifest.title = "Third".into();
    assert!(
        k.smart_set_manifest(&human(), page, &manifest, Some(&base), NOW)
            .is_err()
    );
    assert_eq!(k.smart_manifest(page).unwrap().unwrap(), again);
}

#[test]
fn a_file_taken_out_goes_to_the_trash_and_comes_back() {
    let (t, k) = open();
    let p = make_page(&k, "Tracker", None, None);
    let page = p.meta.path.as_str();
    for (rel, bytes) in [
        ("index.html", HTML),
        ("app.js", b"let x = 1;\r\n"),
        ("assets/p.png", PNG),
    ] {
        k.smart_write_file(&human(), page, rel, bytes, Some(""), NOW)
            .unwrap();
    }
    k.commit_edits().unwrap();
    let before = tree(&t);
    let dir = "library/tracker.smart";

    let gone = k
        .smart_delete_file(&human(), page, "assets/p.png", NOW)
        .unwrap();
    assert_eq!(gone.from, format!("{dir}/assets/p.png"));
    assert!(!there(&t, &gone.from));
    assert_eq!(
        std::fs::read(t.vault.root().join(&gone.trashed)).unwrap(),
        PNG
    );
    assert!(gone.trashed.ends_with("library/tracker.smart/assets/p.png"));
    assert_eq!(
        changed(&k),
        [gone.from.clone(), gone.trashed.clone()]
            .into_iter()
            .collect()
    );
    // The page's list shows it gone; the trash of pages does not list it.
    assert!(
        k.smart_read(page)
            .unwrap()
            .files
            .iter()
            .all(|f| f.path != "assets/p.png")
    );
    assert!(k.list_trash().unwrap().is_empty());
    let listed = k.smart_trashed(page).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].path.as_str(), listed[0].trashed.as_str()),
        ("assets/p.png", gone.trashed.as_str())
    );

    // Undo puts it back, byte for byte.
    undo_last(&k);
    assert_eq!(tree(&t), before);
    assert_eq!(std::fs::read(t.vault.root().join(&gone.from)).unwrap(), PNG);

    // Or put it back from the trash.
    let again = k
        .smart_delete_file(&human(), page, "assets/p.png", NOW)
        .unwrap();
    let back = k.smart_restore_file(&human(), &again.trashed, NOW).unwrap();
    assert_eq!(back, gone.from);
    assert_eq!(tree(&t), before);
    assert!(k.smart_trashed(page).unwrap().is_empty());
    assert!(
        !there(&t, ".trash")
            || std::fs::read_dir(t.vault.root().join(".trash"))
                .unwrap()
                .count()
                == 0
    );

    // It never replaces a file, and never reaches outside the trash.
    let third = k.smart_delete_file(&human(), page, "app.js", NOW).unwrap();
    k.smart_write_file(&human(), page, "app.js", b"new", Some(""), NOW)
        .unwrap();
    assert!(k.smart_restore_file(&human(), &third.trashed, NOW).is_err());
    assert_eq!(
        std::fs::read(t.vault.root().join("library/tracker.smart/app.js")).unwrap(),
        b"new"
    );
    for bad in [
        "library/tracker.smart/index.html",
        ".trash/../library/tracker.smart/index.html",
        ".trash/x/library/tracker.md",
        ".trash/x.y/library/tracker.smart/a.js",
        ".trash/20261023T080000Z/library/tracker.smart/../index.html",
    ] {
        assert!(k.smart_restore_file(&human(), bad, NOW).is_err(), "{bad}");
    }
    // A file that is not there cannot be taken out.
    assert!(matches!(
        k.smart_delete_file(&human(), page, "nope.js", NOW),
        Err(Error::NotFound(_))
    ));
    assert!(k.smart_delete_file(&human(), page, "../x.md", NOW).is_err());
}

#[test]
fn two_files_taken_out_in_the_same_second_both_come_back() {
    let (t, k) = open();
    let p = make_page(&k, "Tracker", None, None);
    let page = p.meta.path.as_str();
    for rel in ["a.js", "b.js"] {
        k.smart_write_file(&human(), page, rel, rel.as_bytes(), Some(""), NOW)
            .unwrap();
    }
    let a = k.smart_delete_file(&human(), page, "a.js", NOW).unwrap();
    let b = k.smart_delete_file(&human(), page, "b.js", NOW).unwrap();
    assert_ne!(a.trashed, b.trashed);
    k.smart_restore_file(&human(), &b.trashed, NOW).unwrap();
    k.smart_restore_file(&human(), &a.trashed, NOW).unwrap();
    assert_eq!(snapshot(&t, "library/tracker.smart")["a.js"], b"a.js");
    assert_eq!(snapshot(&t, "library/tracker.smart")["b.js"], b"b.js");
}

#[test]
fn an_agent_actor_cannot_use_the_person_ops() {
    let (t, k) = open();
    let p = make_page(&k, "Tracker", None, None);
    let page = p.meta.path.as_str();
    k.smart_write_file(&human(), page, "app.js", b"x", Some(""), NOW)
        .unwrap();
    let before = all_files(&t);
    for actor in [
        Actor::Agent {
            client: "c".into(),
            session: "s".into(),
        },
        Actor::Approved {
            client: "c".into(),
            session: "s".into(),
            by: "me".into(),
        },
    ] {
        assert!(
            k.smart_write_file(&actor, page, "app.js", b"y", None, NOW)
                .is_err()
        );
        assert!(k.smart_delete_file(&actor, page, "app.js", NOW).is_err());
        assert!(
            k.smart_restore_file(&actor, ".trash/x/library/tracker.smart/app.js", NOW)
                .is_err()
        );
        let manifest = kasten_core::smart::parse_manifest("title: T\n").unwrap();
        assert!(
            k.smart_set_manifest(&actor, page, &manifest, None, NOW)
                .is_err()
        );
    }
    assert_eq!(all_files(&t), before);
}
