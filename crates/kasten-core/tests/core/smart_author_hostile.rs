//! The person's ops for starting smart pages, tried with hostile names, folders
//! made by hand, the limits, and failures half way through: nothing escapes the
//! vault, nothing is half made, and Undo is byte for byte.

use crate::common::NOW;
use crate::smart_support::{all_files, make_page, open, tree, undo_last};

use kasten_core::history::Actor;
use kasten_core::{Kasten, NewSmartPage};

const INDEX: &[u8] = b"<h1>Hi</h1>";

fn files() -> Vec<(&'static str, &'static [u8])> {
    vec![("index.html", INDEX), ("app.js", b"let x = 1;")]
}

fn page<'a>(title: &'a str, files: &'a [(&'a str, &'a [u8])]) -> NewSmartPage<'a> {
    NewSmartPage {
        title,
        project: None,
        parent: None,
        body: None,
        files,
        copy_of: None,
    }
}

fn smart_page(k: &Kasten, title: &str) -> String {
    let f = files();
    k.smart_new_page(&Actor::Human, &page(title, &f), NOW)
        .unwrap()
        .page
}

/// A file put in a hand-made template: its path and bytes.
type Extra = (String, Vec<u8>);

fn template_dir(t: &crate::common::TempVault, slug: &str) -> std::path::PathBuf {
    let dir = t.vault.root().join("templates/smart").join(slug);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), INDEX).unwrap();
    dir
}

#[test]
fn hostile_titles_stay_inside_the_vault_and_taken_names_get_a_number() {
    let (t, k) = open();
    let f = files();
    let long = "x".repeat(400);
    let titles = [
        "../../evil",
        "..\\..\\evil",
        "/etc/passwd",
        "C:\\Windows\\win",
        "CON",
        "nul",
        "a\0b",
        "tab\tand\nnewline",
        "Board",
        "board",
        "BOARD",
        "Board",
        &long,
    ];
    let mut seen = std::collections::BTreeSet::new();
    for title in titles {
        let before = all_files(&t);
        match k.smart_new_page(&Actor::Human, &page(title, &f), NOW) {
            Ok(made) => {
                assert!(
                    !made.page.contains("..") && !made.page.contains('\\'),
                    "{}",
                    made.page
                );
                assert!(!made.page.starts_with('/'), "{}", made.page);
                assert!(made.page.ends_with(".md"), "{}", made.page);
                assert!(
                    seen.insert(made.page.clone()),
                    "{} was given twice",
                    made.page
                );
                let dir = format!("{}.smart/index.html", made.page.trim_end_matches(".md"));
                assert!(t.vault.root().join(dir).is_file(), "{title:?}");
            }
            Err(_) => assert_eq!(all_files(&t), before, "{title:?} left something behind"),
        }
    }
    for path in all_files(&t).keys() {
        assert!(path.split('/').all(|part| part != ".."), "{path}");
    }
    assert!(
        seen.len() >= 4,
        "the three Boards and the others each got a page: {seen:?}"
    );
}

#[test]
fn a_hostile_project_or_parent_makes_nothing_outside_the_places_pages_go() {
    let (t, k) = open();
    let f = files();
    let before = all_files(&t);
    for project in [
        "../outside",
        "..",
        "a/b",
        ".git",
        ".kasten",
        "projects/../..",
        "C:\\x",
        "",
        "nul",
        "no-such-project",
    ] {
        let mut request = page("Ticket", &f);
        request.project = Some(project);
        if let Ok(made) = k.smart_new_page(&Actor::Human, &request, NOW) {
            assert!(
                made.page.starts_with("projects/") && !made.page.contains(".."),
                "{project:?} made {}",
                made.page
            );
        }
    }
    for parent in [
        "../x.md",
        "/etc/passwd.md",
        "library/none.md",
        ".git/config.md",
        "library/../../x.md",
    ] {
        let mut request = page("Child", &f);
        request.parent = Some(parent);
        assert!(
            k.smart_new_page(&Actor::Human, &request, NOW).is_err(),
            "{parent:?}"
        );
    }
    for path in all_files(&t).keys().filter(|p| !before.contains_key(*p)) {
        assert!(
            !path.starts_with("..") && !path.contains("/../") && !path.starts_with(".git/"),
            "{path}"
        );
    }
}

#[test]
fn the_limits_hold_for_a_new_page() {
    let (t, k) = open();
    let before = all_files(&t);
    let big = vec![b'a'; 2 * 1024 * 1024 + 1];
    let ok = vec![b'a'; 2 * 1024 * 1024];
    let over: Vec<(&str, &[u8])> = vec![("index.html", INDEX), ("big.js", &big)];
    assert!(
        k.smart_new_page(&Actor::Human, &page("Big", &over), NOW)
            .is_err()
    );

    // Six files of 2 MB are more than the folder may hold in all (10 MB).
    let names: Vec<String> = (0..6).map(|n| format!("f{n}.js")).collect();
    let mut heavy: Vec<(&str, &[u8])> = vec![("index.html", INDEX)];
    heavy.extend(names.iter().map(|n| (n.as_str(), ok.as_slice())));
    assert!(
        k.smart_new_page(&Actor::Human, &page("Heavy", &heavy), NOW)
            .is_err()
    );

    let many_names: Vec<String> = (0..500).map(|n| format!("d/f{n}.js")).collect();
    let mut many: Vec<(&str, &[u8])> = vec![("index.html", INDEX)];
    many.extend(many_names.iter().map(|n| (n.as_str(), b"x" as &[u8])));
    assert_eq!(many.len(), 501);
    assert!(
        k.smart_new_page(&Actor::Human, &page("Many", &many), NOW)
            .is_err()
    );
    assert_eq!(all_files(&t), before, "nothing was written by any of them");

    many.pop();
    assert_eq!(many.len(), 500);
    let made = k
        .smart_new_page(&Actor::Human, &page("Many", &many), NOW)
        .unwrap();
    assert_eq!(made.files, 500);
}

#[test]
fn a_hand_made_template_is_refused_as_a_whole_and_not_offered() {
    let (t, k) = open();
    let big = vec![b'a'; 2 * 1024 * 1024 + 1];
    let two_mb = vec![b'a'; 2 * 1024 * 1024];
    let cases: Vec<(&str, Vec<Extra>)> = vec![
        ("exe", vec![("evil.exe".into(), b"MZ".to_vec())]),
        ("hidden", vec![(".secret.js".into(), b"x".to_vec())]),
        ("hiddendir", vec![(".git/config.js".into(), b"x".to_vec())]),
        ("huge", vec![("big.js".into(), big)]),
        ("deep", vec![("a/b/c/d/e/f/g.js".into(), b"x".to_vec())]),
        ("short", vec![("PROGRA~1.js".into(), b"x".to_vec())]),
        ("wasm", vec![("m.wasm".into(), b"\0asm".to_vec())]),
        (
            "heavy",
            (0..6)
                .map(|n| (format!("f{n}.js"), two_mb.clone()))
                .collect(),
        ),
        (
            "many",
            (0..501)
                .map(|n| (format!("d/f{n}.js"), b"x".to_vec()))
                .collect(),
        ),
    ];
    for (slug, extra) in &cases {
        let dir = template_dir(&t, slug);
        for (rel, bytes) in extra {
            let file = dir.join(rel);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, bytes).unwrap();
        }
    }
    for (slug, _) in &cases {
        assert!(k.smart_template(slug).is_err(), "{slug} was taken");
    }
    assert!(
        k.smart_templates().unwrap().is_empty(),
        "{:?}",
        k.smart_templates().unwrap()
    );

    // A good one next to them is the only one offered; a file manager's leftovers do not spoil it.
    let dir = template_dir(&t, "good");
    std::fs::write(dir.join(".DS_Store"), b"x").unwrap();
    std::fs::write(dir.join("Thumbs.db"), b"x").unwrap();
    let listed = k.smart_templates().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].slug, "good");
    let template = k.smart_template("good").unwrap();
    assert_eq!(template.files.len(), 1);
}

#[test]
fn a_link_inside_a_template_is_never_followed_or_copied() {
    let (t, k) = open();
    let outside = std::env::temp_dir().join(format!(
        "kasten-outside-{}",
        kasten_core::ulid_at(NOW.millis)
    ));
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.js"), b"SECRET").unwrap();
    let dir = template_dir(&t, "linked");
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(outside.join("secret.js"), dir.join("leak.js"));
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(outside.join("secret.js"), dir.join("leak.js"));
    if made.is_ok()
        && let Ok(template) = k.smart_template("linked")
    {
        assert!(
            template
                .files
                .iter()
                .all(|(_, bytes)| !bytes.windows(6).any(|w| w == b"SECRET")),
            "the file behind the link was copied"
        );
    }
    // A template folder that is itself a link is not listed or used.
    let target = outside.join("folder");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("index.html"), b"SECRET").unwrap();
    #[cfg(windows)]
    let made =
        std::os::windows::fs::symlink_dir(&target, t.vault.root().join("templates/smart/jump"));
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&target, t.vault.root().join("templates/smart/jump"));
    if made.is_ok() {
        assert!(k.smart_template("jump").is_err());
        assert!(
            k.smart_templates()
                .unwrap()
                .iter()
                .all(|i| i.slug != "jump")
        );
    }
    std::fs::remove_dir_all(&outside).unwrap();
}

#[test]
fn keeping_a_page_as_a_template_is_one_commit_and_undo_takes_it_back_byte_for_byte() {
    let (t, k) = open();
    let source = smart_page(&k, "Board");
    let before = tree(&t);
    let files_before = all_files(&t);
    k.smart_save_template(&Actor::Human, &source, "Mine", NOW)
        .unwrap();
    assert!(
        t.vault
            .root()
            .join("templates/smart/mine/index.html")
            .is_file()
    );
    undo_last(&k);
    assert_eq!(tree(&t), before, "the history is back where it was");
    let mut after = all_files(&t);
    after.retain(|path, _| !path.starts_with(".trash/"));
    assert_eq!(after, files_before, "and so is every file");
}

#[test]
fn a_page_with_its_own_page_txt_is_not_kept_as_a_template() {
    let (t, k) = open();
    let source = smart_page(&k, "Board");
    let dir = format!("{}.smart", source.trim_end_matches(".md"));
    k.smart_write_file(&Actor::Human, &source, "page.txt", b"mine", Some(""), NOW)
        .unwrap();
    let before = all_files(&t);
    assert!(
        k.smart_save_template(&Actor::Human, &source, "Mine", NOW)
            .is_err()
    );
    assert_eq!(all_files(&t), before, "nothing was written");
    assert!(t.vault.root().join(dir).is_dir());
}

#[test]
fn a_failure_after_the_layout_was_set_puts_the_page_back_as_it_was() {
    let (t, k) = open();
    // A page with no id, written by hand, and a folder whose index.html is a folder.
    let text = "---\ntitle: No id\n---\nWords.\r\n";
    std::fs::write(t.vault.root().join("library/no-id.md"), text).unwrap();
    std::fs::create_dir_all(t.vault.root().join("library/no-id.smart/index.html")).unwrap();
    k.commit_external().unwrap();
    let before = all_files(&t);
    let n = k.log(None, 500).unwrap().len();
    let f = files();
    assert!(
        k.smart_turn_into(&Actor::Human, "library/no-id.md", &f, NOW)
            .is_err()
    );
    assert_eq!(
        all_files(&t),
        before,
        "the page has its bytes and the folder nothing new"
    );
    assert_eq!(k.log(None, 500).unwrap().len(), n, "no commit");
    assert!(
        t.vault
            .root()
            .join("library/no-id.smart/index.html")
            .is_dir()
    );
}

#[test]
fn a_page_cannot_be_turned_into_a_smart_page_inside_another_smart_pages_folder() {
    let (t, k) = open();
    let source = smart_page(&k, "Outer");
    let dir = source.trim_end_matches(".md");
    std::fs::write(
        t.vault.root().join(format!("{dir}.smart/inner.md")),
        "---\ntitle: Inner\n---\n",
    )
    .unwrap();
    let before = all_files(&t);
    let f = files();
    assert!(
        k.smart_turn_into(&Actor::Human, &format!("{dir}.smart/inner.md"), &f, NOW)
            .is_err()
    );
    assert_eq!(all_files(&t), before);
    // And a sub-page of a page in a folder is refused as a parent.
    let mut request = page("Child", &f);
    let parent = format!("{dir}.smart/inner.md");
    request.parent = Some(&parent);
    assert!(k.smart_new_page(&Actor::Human, &request, NOW).is_err());
    assert_eq!(all_files(&t), before);
}

#[test]
fn turning_a_page_into_a_smart_one_twice_changes_nothing_the_second_time() {
    let (t, k) = open();
    let source = make_page(&k, "Plain", None, None);
    let f = files();
    k.smart_turn_into(&Actor::Human, &source.meta.path, &f, NOW)
        .unwrap();
    let before = all_files(&t);
    let n = k.log(None, 500).unwrap().len();
    let again = k
        .smart_turn_into(&Actor::Human, &source.meta.path, &f, NOW)
        .unwrap();
    assert_eq!(again.files, 0);
    assert_eq!(all_files(&t), before);
    assert_eq!(
        k.log(None, 500).unwrap().len(),
        n,
        "no second commit for no change"
    );
}
