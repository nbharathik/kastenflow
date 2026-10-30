//! A person starts a smart page from files (a starter or a template of their
//! own), turns an ordinary page into one, and keeps one as a template: each is
//! one commit that Undo takes back, and nothing is ever half made.

use crate::common::NOW;
use crate::smart_support::{all_files, changed, make_page, open, undo_last};

use kasten_core::Kasten;
use kasten_core::NewSmartPage;
use kasten_core::history::Actor;

fn agent() -> Actor {
    Actor::Agent {
        client: "claude-code".to_owned(),
        session: "s1".to_owned(),
    }
}

const INDEX: &[u8] = b"<h1>Hi</h1>\r\n<script src=\"app.js\"></script>";
const APP: &[u8] = b"console.log('hi');\n";
const YAML: &[u8] = b"version: 1\ntitle: Starter\nfuture: kept\n";
const BODY: &str = "# Starter\n\nTag a note #tracked.\n";

fn files() -> Vec<(&'static str, &'static [u8])> {
    vec![("index.html", INDEX), ("app.js", APP), ("smart.yaml", YAML)]
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 500).unwrap().len()
}

fn new_page<'a>(title: &'a str, files: &'a [(&'a str, &'a [u8])]) -> NewSmartPage<'a> {
    NewSmartPage {
        title,
        project: None,
        parent: None,
        body: Some(BODY),
        files,
        copy_of: None,
    }
}

fn read(t: &crate::common::TempVault, rel: &str) -> Vec<u8> {
    std::fs::read(t.vault.root().join(rel)).unwrap()
}

#[test]
fn a_starter_makes_the_page_and_its_folder_in_one_commit_that_undo_takes_back() {
    let (t, k) = open();
    let before = all_files(&t);
    let n = commits(&k);
    let f = files();
    let made = k
        .smart_new_page(&Actor::Human, &new_page("My dashboard", &f), NOW)
        .unwrap();
    assert_eq!(commits(&k), n + 1, "one commit");
    assert!(made.page.ends_with("my-dashboard.md"), "{}", made.page);
    assert_eq!(made.files, 3);

    let note = k.read(&made.page).unwrap();
    assert_eq!(note.meta.title, "My dashboard");
    assert!(note.text.contains("layout: smart"), "{}", note.text);
    assert!(
        note.text.ends_with(BODY),
        "the starter's text is the page: {}",
        note.text
    );
    let dir = format!("{}.smart", made.page.strip_suffix(".md").unwrap());
    for (rel, bytes) in &f {
        assert_eq!(
            read(&t, &format!("{dir}/{rel}")),
            *bytes,
            "{rel} byte for byte"
        );
    }
    undo_last(&k);
    let mut after = all_files(&t);
    after.retain(|path, _| !path.starts_with(".trash/"));
    assert_eq!(after, before, "page and folder both gone");
}

#[test]
fn agents_are_refused_and_nothing_is_written() {
    let (t, k) = open();
    let before = all_files(&t);
    let f = files();
    let agent = agent();
    assert!(k.smart_new_page(&agent, &new_page("X", &f), NOW).is_err());
    assert_eq!(all_files(&t), before);
}

#[test]
fn bad_files_are_refused_before_the_page_exists() {
    let (t, k) = open();
    let before = all_files(&t);
    let n = commits(&k);
    let cases: Vec<Vec<(&str, &[u8])>> = vec![
        vec![],
        vec![("app.js", APP)],
        vec![("index.html", INDEX), ("x.exe", b"MZ")],
        vec![("index.html", INDEX), ("../up.js", APP)],
        vec![("index.html", INDEX), ("INDEX.html", INDEX)],
        vec![("index.html", INDEX), ("smart.yaml", b"title: ''\n")],
    ];
    for case in &cases {
        assert!(
            k.smart_new_page(&Actor::Human, &new_page("Bad", case), NOW)
                .is_err()
        );
    }
    let f = files();
    assert!(
        k.smart_new_page(&Actor::Human, &new_page("  ", &f), NOW)
            .is_err()
    );
    assert_eq!(all_files(&t), before, "no page, no folder");
    assert_eq!(commits(&k), n);
}

#[test]
fn a_starter_can_be_made_in_a_project() {
    let (_t, k) = open();
    let f = files();
    let mut request = new_page("Board", &f);
    request.project = Some("photo-organiser");
    let made = k.smart_new_page(&Actor::Human, &request, NOW).unwrap();
    assert!(
        made.page.starts_with("projects/photo-organiser/"),
        "{}",
        made.page
    );
}

#[test]
fn an_ordinary_page_turns_into_a_smart_one_and_keeps_its_text() {
    let (t, k) = open();
    let page = make_page(&k, "Notes", None, None);
    k.save_body(
        &Actor::Human,
        &page.meta.path,
        "Words I wrote.\r\n\r\n- one\r\n- two",
        &page.hash,
        NOW,
    )
    .unwrap();
    let before = k.read(&page.meta.path).unwrap();
    let body_of = |text: &str| {
        text.split_once("---\n")
            .map(|_| text.rsplit("---").next().unwrap().to_owned())
    };
    let f = files();
    let made = k
        .smart_turn_into(&Actor::Human, &page.meta.path, &f, NOW)
        .unwrap();
    assert_eq!(made.files, 3);
    let dir = format!("{}.smart", page.meta.path.trim_end_matches(".md"));
    let paths = changed(&k);
    assert!(paths.contains(&page.meta.path), "{paths:?}");
    assert!(
        paths.contains(&format!("{dir}/index.html")),
        "page and folder in the same commit: {paths:?}"
    );
    let after = k.read(&page.meta.path).unwrap();
    assert!(after.text.contains("layout: smart"));
    assert_eq!(
        body_of(&after.text),
        body_of(&before.text),
        "the text is as it was"
    );
    assert_eq!(
        read(
            &t,
            &format!(
                "{}.smart/index.html",
                page.meta.path.trim_end_matches(".md")
            )
        ),
        INDEX
    );
    undo_last(&k);
    assert_eq!(
        k.read(&page.meta.path).unwrap().text,
        before.text,
        "the page is back byte for byte"
    );
    assert!(
        !t.vault
            .root()
            .join(format!("{}.smart", page.meta.path.trim_end_matches(".md")))
            .exists()
    );
}

#[test]
fn turning_a_page_with_a_folder_into_a_smart_page_only_flips_the_layout() {
    let (t, k) = open();
    let page = make_page(&k, "Again", None, None);
    let f = files();
    k.smart_turn_into(&Actor::Human, &page.meta.path, &f, NOW)
        .unwrap();
    // Back to a normal page: the layout key goes, the folder stays.
    k.set_meta(&Actor::Human, &page.meta.path, "layout", None, NOW)
        .unwrap();
    let dir = format!("{}.smart", page.meta.path.trim_end_matches(".md"));
    assert_eq!(read(&t, &format!("{dir}/app.js")), APP);
    assert!(
        !k.read(&page.meta.path)
            .unwrap()
            .text
            .contains("layout: smart")
    );
    // Turn into again with other files: the folder as it is wins, nothing is replaced.
    let other: Vec<(&str, &[u8])> = vec![("index.html", b"<p>other</p>")];
    let made = k
        .smart_turn_into(&Actor::Human, &page.meta.path, &other, NOW)
        .unwrap();
    assert_eq!(made.files, 0, "no file written");
    assert_eq!(read(&t, &format!("{dir}/index.html")), INDEX);
    assert!(
        k.read(&page.meta.path)
            .unwrap()
            .text
            .contains("layout: smart")
    );
}

#[test]
fn a_page_the_window_already_made_smart_is_not_written_again() {
    let (t, k) = open();
    let page = make_page(&k, "Open page", None, None);
    k.set_meta(&Actor::Human, &page.meta.path, "layout", Some("smart"), NOW)
        .unwrap();
    let before = read(&t, &page.meta.path);
    let f = files();
    let made = k
        .smart_turn_into(&Actor::Human, &page.meta.path, &f, NOW)
        .unwrap();
    assert_eq!(made.files, 3);
    assert_eq!(
        read(&t, &page.meta.path),
        before,
        "the page file is untouched"
    );
    let paths = changed(&k);
    assert!(!paths.contains(&page.meta.path), "{paths:?}");
    assert!(
        paths.iter().any(|p| p.ends_with(".smart/index.html")),
        "{paths:?}"
    );
}

#[test]
fn turning_into_refuses_agents_missing_pages_and_bad_files() {
    let (t, k) = open();
    let page = make_page(&k, "Plain", None, None);
    let before = all_files(&t);
    let f = files();
    let agent = agent();
    assert!(k.smart_turn_into(&agent, &page.meta.path, &f, NOW).is_err());
    assert!(
        k.smart_turn_into(&Actor::Human, "library/none.md", &f, NOW)
            .is_err()
    );
    let bad: Vec<(&str, &[u8])> = vec![("app.js", APP)];
    assert!(
        k.smart_turn_into(&Actor::Human, &page.meta.path, &bad, NOW)
            .is_err()
    );
    assert_eq!(all_files(&t), before);
}

fn smart_page(k: &Kasten, title: &str) -> String {
    let f = files();
    k.smart_new_page(&Actor::Human, &new_page(title, &f), NOW)
        .unwrap()
        .page
}

#[test]
fn a_page_is_kept_as_a_template_and_a_page_is_made_from_it() {
    let (t, k) = open();
    let page = smart_page(&k, "Reading list");
    let n = commits(&k);
    let saved = k
        .smart_save_template(&Actor::Human, &page, "My reading list", NOW)
        .unwrap();
    assert_eq!(saved.slug, "my-reading-list");
    assert_eq!(commits(&k), n + 1, "one commit");
    for (rel, bytes) in files() {
        assert_eq!(
            read(&t, &format!("templates/smart/my-reading-list/{rel}")),
            bytes
        );
    }
    let list = k.smart_templates().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].slug, "my-reading-list");
    assert_eq!(list[0].name, "Starter", "named by its smart.yaml");

    let template = k.smart_template("my-reading-list").unwrap();
    assert_eq!(template.body.as_deref(), Some(BODY));
    assert_eq!(template.files.len(), 3);
    let pairs: Vec<(&str, &[u8])> = template
        .files
        .iter()
        .map(|(p, b)| (p.as_str(), b.as_slice()))
        .collect();
    let again = k
        .smart_new_page(
            &Actor::Human,
            &NewSmartPage {
                body: template.body.as_deref(),
                ..new_page("From mine", &pairs)
            },
            NOW,
        )
        .unwrap();
    assert_eq!(
        read(
            &t,
            &format!("{}.smart/app.js", again.page.trim_end_matches(".md"))
        ),
        APP
    );

    undo_last(&k);
    // The last commit was the new page; the template is still there.
    assert_eq!(k.smart_templates().unwrap().len(), 1);
}

#[test]
fn a_template_name_that_is_taken_gets_a_number_and_nothing_there_is_touched() {
    let (t, k) = open();
    let page = smart_page(&k, "Board");
    k.smart_save_template(&Actor::Human, &page, "Same", NOW)
        .unwrap();
    let first = read(&t, "templates/smart/same/app.js");
    let second = k
        .smart_save_template(&Actor::Human, &page, "Same", NOW)
        .unwrap();
    assert_eq!(second.slug, "same-2");
    assert_eq!(read(&t, "templates/smart/same/app.js"), first);
}

#[test]
fn hostile_template_names_and_pages_are_refused() {
    let (t, k) = open();
    let page = smart_page(&k, "Board");
    let before = all_files(&t);
    for name in ["", "   ", "///", "..", "../../etc", "CON", "nul", "😀"] {
        let got = k.smart_save_template(&Actor::Human, &page, name, NOW);
        // A name that makes a plain slug is fine, and stays inside templates/smart/.
        if let Ok(saved) = got {
            assert!(
                saved.slug.chars().all(|c| c.is_alphanumeric() || c == '-'),
                "{}",
                saved.slug
            );
            assert!(
                t.vault
                    .root()
                    .join("templates/smart")
                    .join(&saved.slug)
                    .is_dir()
            );
        }
    }
    let after = all_files(&t);
    assert!(
        after
            .keys()
            .all(|p| before.contains_key(p) || p.starts_with("templates/smart/")),
        "nothing escaped templates/smart"
    );
    let agent = agent();
    assert!(k.smart_save_template(&agent, &page, "Agent", NOW).is_err());
    // Not a smart page / not there.
    assert!(
        k.smart_save_template(&Actor::Human, "library/none.md", "Gone", NOW)
            .is_err()
    );
    let plain = make_page(&k, "Plain", None, None);
    assert!(
        k.smart_save_template(&Actor::Human, &plain.meta.path, "Plain", NOW)
            .is_err()
    );
}

#[test]
fn a_template_that_is_not_a_plain_name_cannot_be_read() {
    let (_t, k) = open();
    for slug in ["../x", "a/b", "", "A B", "CON", "x\\y"] {
        assert!(k.smart_template(slug).is_err(), "{slug}");
    }
}

#[test]
fn a_hand_made_template_with_programs_in_it_is_not_used_whole() {
    let (t, k) = open();
    let dir = t.vault.root().join("templates/smart/handmade");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), INDEX).unwrap();
    std::fs::write(dir.join("evil.exe"), b"MZ").unwrap();
    std::fs::write(dir.join(".DS_Store"), b"x").unwrap();
    // A program in a template spoils the whole of it: it is neither used in part nor offered.
    assert!(k.smart_template("handmade").is_err());
    assert!(k.smart_templates().unwrap().is_empty());
    std::fs::remove_file(dir.join("evil.exe")).unwrap();
    let template = k.smart_template("handmade").unwrap();
    let names: Vec<&str> = template.files.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(
        names,
        vec!["index.html"],
        "a file manager's leftover is not a fault"
    );
    // A template folder with no index.html is no template.
    std::fs::create_dir_all(t.vault.root().join("templates/smart/empty")).unwrap();
    assert!(k.smart_template("empty").is_err());
    assert!(
        k.smart_templates()
            .unwrap()
            .iter()
            .all(|i| i.slug != "empty")
    );
}

#[test]
fn templates_are_not_notes() {
    let (_t, k) = open();
    let page = smart_page(&k, "Board");
    k.smart_save_template(&Actor::Human, &page, "Mine", NOW)
        .unwrap();
    let notes = k.list().unwrap();
    assert!(
        notes
            .iter()
            .all(|n| !n.path.starts_with("templates/smart/")),
        "the body is kept as page.txt, so no template folder file reads as a template note"
    );
}
