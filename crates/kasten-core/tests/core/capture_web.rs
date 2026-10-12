//! A web capture from the browser tab: a card tagged `capture` with the page's
//! address and a few properties, in one commit that also makes the tag's
//! database the first time; or a quote added to a page, which never takes
//! anything out of it.

use std::fs;

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::clip::{Target, WebCapture};
use kasten_core::history::Actor;

const URL: &str = "https://example.com/guide/slip-box";
const SELECTION: &str = "<p>One idea per <a href=\"/notes\">note</a>.</p><p>Then <a href=\"javascript:alert(1)\">link</a> it.</p>";
const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";

/// The dev vault as a vault from before the Captures database was a default:
/// without `tags/capture.yaml`, so a first capture has to make it.
fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    fs::remove_file(t.vault.root().join("tags/capture.yaml")).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn selection(html: &str) -> WebCapture {
    WebCapture {
        url: URL.to_owned(),
        title: "Slip-box basics".to_owned(),
        html: Some(html.to_owned()),
        text: None,
        via: "browser".to_owned(),
        tags: Vec::new(),
    }
}

fn changed(k: &Kasten) -> Vec<String> {
    let mut files: Vec<String> = k
        .commit_changes(&k.log(None, 1).unwrap()[0].id)
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect();
    files.sort();
    files
}

#[test]
fn keeps_a_selection_as_a_tagged_card_in_one_commit() {
    let (t, k) = open();
    let commits = k.log(None, 500).unwrap().len();
    let note = k
        .capture_web(&Actor::Human, &selection(SELECTION), &Target::Inbox, NOW)
        .unwrap();
    assert_eq!(note.meta.path, "inbox/slip-box-basics.md");
    assert_eq!(
        (note.meta.kind.as_str(), note.meta.title.as_str()),
        ("card", "Slip-box basics")
    );
    assert_eq!(note.meta.tags, ["capture"]);
    assert!(
        note.text.contains(&format!("\nurl: {URL}\n")),
        "{}",
        note.text
    );
    assert_eq!(note.meta.props["site"], "example.com");
    assert_eq!(note.meta.props["captured"], "2026-09-24");
    assert_eq!(note.meta.props["via"], "browser");
    assert_eq!(note.meta.props["url"], URL);
    assert!(
        note.text.ends_with(concat!(
            "---\nOne idea per [note](https://example.com/notes).\n\n",
            "Then link it.\n\n",
            "Captured from [example.com](https://example.com/guide/slip-box) on 2026-09-24.\n"
        )),
        "{}",
        note.text
    );
    // One commit, which also made the tag's database.
    let log = k.log(None, 500).unwrap();
    assert_eq!(log.len(), commits + 1);
    assert_eq!(log[0].summary, "capture: Slip-box basics");
    assert_eq!(
        changed(&k),
        ["inbox/slip-box-basics.md", "tags/capture.yaml"]
    );
    assert!(
        !text_of(&t, "inbox/slip-box-basics.md").contains("javascript:"),
        "a script link never reaches the vault"
    );
    // The index knows it: it is found by its words, and listed under its tag.
    assert!(!k.search("slip", 10).unwrap().is_empty());
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

#[test]
fn makes_the_tags_database_once_and_leaves_a_changed_one_alone() {
    let (t, k) = open();
    k.capture_web(&Actor::Human, &selection(SELECTION), &Target::Inbox, NOW)
        .unwrap();
    let schema = text_of(&t, "tags/capture.yaml");
    assert!(schema.starts_with("name: capture\n"), "{schema}");
    for line in [
        "  - {key: url, type: url}\n",
        "  - {key: site, type: text}\n",
        "  - {key: captured, type: date}\n",
        "  - {key: status, type: select, options: [New, Read, Filed]}\n",
        "  - {name: All, type: table, sort: [{key: captured, dir: desc}]}\n",
        "  - {name: By site, type: table, sort: [{key: site, dir: asc}, {key: captured, dir: desc}]}\n",
        "  - {name: This week, type: calendar, date: captured}\n",
        "  - {name: This project, type: table, scope: project, sort: [{key: captured, dir: desc}]}\n",
    ] {
        assert!(schema.contains(line), "{line}\n{schema}");
    }
    // A second capture does not touch it.
    let second = WebCapture {
        title: "Another page".to_owned(),
        url: "https://example.org/other".to_owned(),
        ..selection(SELECTION)
    };
    k.capture_web(&Actor::Human, &second, &Target::Inbox, NOW)
        .unwrap();
    assert_eq!(changed(&k), ["inbox/another-page.md"]);
    assert_eq!(text_of(&t, "tags/capture.yaml"), schema);

    // A database the person made or changed is kept as it is.
    let (t, k) = open();
    let own = "# my captures\nname: capture\ncolor: red\nproperties:\n  - {key: site, type: text}\nviews:\n  - {name: Mine, type: list}\n";
    fs::create_dir_all(t.vault.root().join("tags")).unwrap();
    fs::write(t.vault.root().join("tags/capture.yaml"), own).unwrap();
    k.capture_web(&Actor::Human, &selection(SELECTION), &Target::Inbox, NOW)
        .unwrap();
    assert_eq!(text_of(&t, "tags/capture.yaml"), own);
    assert_eq!(changed(&k), ["inbox/slip-box-basics.md"]);
}

#[test]
fn files_a_capture_into_a_project_or_refuses_one_that_is_not_there() {
    let (t, k) = open();
    let note = k
        .capture_web(
            &Actor::Human,
            &selection(SELECTION),
            &Target::Project("photo-organiser".to_owned()),
            NOW,
        )
        .unwrap();
    assert_eq!(
        note.meta.path,
        "projects/photo-organiser/cards/slip-box-basics.md"
    );
    assert_eq!(note.meta.project.as_deref(), Some("photo-organiser"));
    assert_eq!(note.meta.tags, ["capture"]);

    let (t2, k2) = open();
    let commits = k2.log(None, 500).unwrap().len();
    let err = k2
        .capture_web(
            &Actor::Human,
            &selection(SELECTION),
            &Target::Project("nowhere".to_owned()),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("nowhere"), "{err}");
    assert_eq!(k2.log(None, 500).unwrap().len(), commits);
    assert!(!t2.vault.root().join("tags/capture.yaml").exists());
    drop(t);
}

#[test]
fn quotes_a_selection_into_a_page_and_keeps_the_rest_byte_for_byte() {
    let (t, k) = open();
    let before = text_of(&t, ROADMAP);
    let body_before = before.split_once("---\n# Photo").unwrap().1;
    let note = k
        .capture_web(
            &Actor::Human,
            &selection(SELECTION),
            &Target::Page {
                path: ROADMAP.to_owned(),
                heading: None,
            },
            NOW,
        )
        .unwrap();
    let quote = concat!(
        "> One idea per [note](https://example.com/notes).\n",
        ">\n",
        "> Then link it.\n",
        ">\n",
        "> — [Slip-box basics](https://example.com/guide/slip-box), 2026-09-24\n"
    );
    let body = note.text.split_once("---\n# Photo").unwrap().1;
    assert!(body.starts_with(body_before.trim_end()), "{body}");
    assert!(body.ends_with(&format!("\n\n{quote}")), "{body}");
    assert_eq!(body.len(), body_before.trim_end().len() + 2 + quote.len());
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "append: Photo organiser roadmap"
    );
    assert_eq!(changed(&k), [ROADMAP]);
    assert!(!t.vault.root().join("tags/capture.yaml").exists());
}

#[test]
fn quotes_under_a_heading_and_touches_no_other_line() {
    let t = dev_vault();
    let notes = "---\ntitle: Reading list\ntype: page\n---\n# Reading list\n\n## Reading\n\n- one\n\n## Later\n\n- two\n";
    fs::write(t.vault.root().join("inbox/reading-list.md"), notes).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let note = k
        .capture_web(
            &Actor::Human,
            &selection("<p>One idea.</p>"),
            &Target::Page {
                path: "inbox/reading-list.md".to_owned(),
                heading: Some("Reading".to_owned()),
            },
            NOW,
        )
        .unwrap();
    let body = note.text.split_once("---\n# Reading list").unwrap().1;
    assert_eq!(
        body,
        concat!(
            "\n\n## Reading\n\n- one\n\n",
            "> One idea.\n>\n> — [Slip-box basics](https://example.com/guide/slip-box), 2026-09-24\n",
            "\n## Later\n\n- two\n"
        )
    );
    assert_eq!(changed(&k), ["inbox/reading-list.md"]);

    // A heading that is not there changes nothing, and neither does a missing page.
    let before = fs::read_to_string(t.vault.root().join("inbox/reading-list.md")).unwrap();
    let commits = k.log(None, 500).unwrap().len();
    for (path, heading) in [
        ("inbox/reading-list.md", Some("No such section")),
        ("inbox/not-there.md", None),
    ] {
        let target = Target::Page {
            path: path.to_owned(),
            heading: heading.map(str::to_owned),
        };
        assert!(
            k.capture_web(&Actor::Human, &selection("<p>x</p>"), &target, NOW)
                .is_err(),
            "{path}"
        );
    }
    assert_eq!(
        fs::read_to_string(t.vault.root().join("inbox/reading-list.md")).unwrap(),
        before
    );
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
}

#[test]
fn a_page_with_only_its_address_is_a_link_card_or_a_link_line() {
    let (_t, k) = open();
    let bare = WebCapture {
        html: None,
        text: None,
        ..selection("")
    };
    let note = k
        .capture_web(&Actor::Human, &bare, &Target::Inbox, NOW)
        .unwrap();
    assert!(
        note.text.ends_with(
            "---\nCaptured from [example.com](https://example.com/guide/slip-box) on 2026-09-24.\n"
        ),
        "{}",
        note.text
    );
    let note = k
        .capture_web(
            &Actor::Human,
            &bare,
            &Target::Page {
                path: ROADMAP.to_owned(),
                heading: None,
            },
            NOW,
        )
        .unwrap();
    assert!(
        note.text
            .ends_with("\n\n[Slip-box basics](https://example.com/guide/slip-box), 2026-09-24\n"),
        "{}",
        note.text
    );
}

#[test]
fn plain_text_cannot_form_a_link_or_a_tag() {
    let (_t, k) = open();
    let text = WebCapture {
        html: None,
        text: Some("See [the docs](https://evil.example) now\r\nsecond line\r\n\r\n<script>x()</script> and <3".to_owned()),
        ..selection("")
    };
    let note = k
        .capture_web(&Actor::Human, &text, &Target::Inbox, NOW)
        .unwrap();
    assert!(
        note.text.contains(
            "See \\[the docs\\](https://evil.example) now  \nsecond line\n\n\\<script>x()\\</script> and <3\n"
        ),
        "{}",
        note.text
    );
}

#[test]
fn refuses_what_is_not_a_web_page_or_is_too_big() {
    let (t, k) = open();
    let commits = k.log(None, 500).unwrap().len();
    for url in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,hi",
        "ftp://example.com/x",
        "https://exa mple.com/",
        "",
        &format!("https://example.com/{}", "a".repeat(5000)),
    ] {
        let bad = WebCapture {
            url: url.to_owned(),
            ..selection(SELECTION)
        };
        assert!(
            k.capture_web(&Actor::Human, &bad, &Target::Inbox, NOW)
                .is_err(),
            "{url}"
        );
    }
    let huge = selection(&format!("<p>{}</p>", "x".repeat(8 << 20)));
    assert!(
        k.capture_web(&Actor::Human, &huge, &Target::Inbox, NOW)
            .is_err()
    );
    let odd = WebCapture {
        via: "Not OK!".to_owned(),
        ..selection(SELECTION)
    };
    assert!(
        k.capture_web(&Actor::Human, &odd, &Target::Inbox, NOW)
            .is_err()
    );
    // A selection that holds nothing is not a capture.
    let empty = selection("<script>x()</script><nav>Menu</nav>");
    assert!(
        k.capture_web(&Actor::Human, &empty, &Target::Inbox, NOW)
            .is_err()
    );
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
    assert!(!t.vault.root().join("tags/capture.yaml").exists());
}

#[test]
fn a_long_title_is_cut_and_a_whole_page_keeps_its_article() {
    let (_t, k) = open();
    let page = "<html><head><title>x</title></head><body><nav>Menu</nav><article><h1>Heading</h1><p>Body text.</p></article><footer>Copyright</footer></body></html>";
    let long = WebCapture {
        title: format!("{} [draft] #1", "word ".repeat(60)),
        ..selection(page)
    };
    let note = k
        .capture_web(&Actor::Human, &long, &Target::Inbox, NOW)
        .unwrap();
    assert!(
        note.meta.title.chars().count() <= 101,
        "{}",
        note.meta.title
    );
    assert!(
        !note.meta.title.contains(['[', ']', '#']),
        "{}",
        note.meta.title
    );
    assert!(
        note.text.contains("# Heading\n\nBody text.\n"),
        "{}",
        note.text
    );
    assert!(!note.text.contains("Menu") && !note.text.contains("Copyright"));
}

#[test]
fn a_card_carries_the_tags_it_is_given_beside_capture() {
    let (_t, k) = open();
    let tagged = WebCapture {
        tags: ["#reading", "Rust/async", "reading", "CAPTURE", " later_on "]
            .map(str::to_owned)
            .to_vec(),
        ..selection(SELECTION)
    };
    let note = k
        .capture_web(&Actor::Human, &tagged, &Target::Inbox, NOW)
        .unwrap();
    assert_eq!(
        note.meta.tags,
        ["capture", "reading", "Rust/async", "later_on"]
    );
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "capture: Slip-box basics"
    );
}

#[test]
fn a_tag_that_cannot_be_one_refuses_the_capture_and_writes_nothing() {
    let (t, k) = open();
    let commits = k.log(None, 500).unwrap().len();
    let many: Vec<String> = (0..9).map(|n| format!("tag{n}")).collect();
    for bad in [
        vec!["two words".to_owned()],
        vec!["a,b".to_owned()],
        vec!["[x]".to_owned()],
        vec!["x: y".to_owned()],
        vec!["a".repeat(41)],
        vec!["new\nline".to_owned()],
        many,
    ] {
        let capture = WebCapture {
            tags: bad.clone(),
            ..selection(SELECTION)
        };
        assert!(
            k.capture_web(&Actor::Human, &capture, &Target::Inbox, NOW)
                .is_err(),
            "{bad:?}"
        );
    }
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
    assert!(!t.vault.root().join("tags/capture.yaml").exists());
}

#[test]
fn tags_are_not_added_to_a_page_a_quote_goes_into() {
    let (_t, k) = open();
    let before = k.read(ROADMAP).unwrap().meta.tags;
    let tagged = WebCapture {
        tags: vec!["reading".to_owned()],
        ..selection(SELECTION)
    };
    let note = k
        .capture_web(
            &Actor::Human,
            &tagged,
            &Target::Page {
                path: ROADMAP.to_owned(),
                heading: None,
            },
            NOW,
        )
        .unwrap();
    assert_eq!(note.meta.tags, before);
}

#[test]
fn a_vault_that_already_has_the_captures_database_keeps_it_as_it_is() {
    // A vault made now is given `tags/capture.yaml` with the other defaults.
    let t = dev_vault();
    let file = t.vault.root().join("tags/capture.yaml");
    let shipped = fs::read_to_string(&file).unwrap();
    assert!(shipped.starts_with("name: capture\n"), "{shipped}");
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    k.capture_web(&Actor::Human, &selection(SELECTION), &Target::Inbox, NOW)
        .unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), shipped);
    assert_eq!(changed(&k), ["inbox/slip-box-basics.md"]);
}
