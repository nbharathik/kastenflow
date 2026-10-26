//! Search over a smart page: the words `index.html` shows, and only those,
//! lead to the page.

use crate::common::NOW;
use crate::smart_support::{make_page, open};

use std::fs;

use kasten_core::history::Actor;

fn human() -> Actor {
    Actor::Human
}

fn pages_found(k: &kasten_core::Kasten, query: &str) -> Vec<String> {
    k.search(query, 10)
        .unwrap()
        .into_iter()
        .map(|h| h.path)
        .collect()
}

#[test]
fn search_finds_the_words_index_html_shows_and_nothing_else_in_the_folder() {
    let (t, k) = open();
    let p = make_page(&k, "Tracker", None, None);
    let page = p.meta.path.as_str();
    let html = "<!doctype html><html><head><title>zebratitle</title><style>.zebrastyle{}</style></head>\
        <body><h1>Pelican deadlines</h1><p>Paper due &amp; poster</p><!-- zebracomment -->\
        <script>var zebrascript = 1;</script></body></html>";
    for (rel, text) in [
        ("index.html", html),
        ("app.js", "var zebraapp = 'x';"),
        ("data/venues.json", "{\"zebradata\": 1}"),
        ("assets/pin.svg", "<svg><text>zebrasvg</text></svg>"),
        ("other.html", "<p>zebraother</p>"),
        ("notes.txt", "zebranotes"),
        ("smart.yaml", "title: Tracker\nzebrayaml: 1\n"),
    ] {
        k.smart_write_file(&human(), page, rel, text.as_bytes(), Some(""), NOW)
            .unwrap();
    }
    // What the page shows is found, with a snippet, leading to the page.
    let hits = k.search("pelican", 10).unwrap();
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(
        (hits[0].path.as_str(), hits[0].title.as_str()),
        (page, "Tracker")
    );
    assert!(
        hits[0].snippet.contains("Pelican deadlines"),
        "{}",
        hits[0].snippet
    );
    assert_eq!(pages_found(&k, "poster due"), [page]);
    // Everything else in the folder is not.
    for hidden in [
        "zebratitle",
        "zebrastyle",
        "zebracomment",
        "zebrascript",
        "zebraapp",
        "zebradata",
        "zebrasvg",
        "zebraother",
        "zebranotes",
        "zebrayaml",
        "zebra",
    ] {
        assert!(pages_found(&k, hidden).is_empty(), "{hidden}");
    }
    // Every word has to be there.
    assert!(pages_found(&k, "pelican zanzibar").is_empty());
    // A change shows at once, with no reindex.
    let base = k.smart_file(page, "index.html").unwrap().hash;
    k.smart_write_file(
        &human(),
        page,
        "index.html",
        b"<p>Zanzibar spice</p>",
        Some(&base),
        NOW,
    )
    .unwrap();
    assert_eq!(pages_found(&k, "zanzibar"), [page]);
    assert!(pages_found(&k, "pelican").is_empty());
    // A filter in the query is the notes' business.
    assert!(pages_found(&k, "zanzibar type:card").is_empty());
    // The page's own text is found as ever, and the page is listed once.
    let body = format!(
        "{}\nKumquat and Zanzibar notes.\n",
        k.read(page).unwrap().text
    );
    fs::write(t.vault.root().join(page), body).unwrap();
    k.reindex().unwrap();
    assert_eq!(pages_found(&k, "zanzibar"), [page]);
    assert_eq!(pages_found(&k, "kumquat"), [page]);
    // The limit holds.
    assert!(k.search("zanzibar", 0).unwrap().is_empty());
    // A page in the trash is not found; its words come back with it.
    let trashed = k.trash(&human(), page, NOW).unwrap();
    assert!(pages_found(&k, "zanzibar").is_empty());
    k.restore_trashed(&human(), &trashed).unwrap();
    assert!(!pages_found(&k, "zanzibar").is_empty());
}

#[test]
fn a_stray_index_html_is_not_a_page() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    // Not beside a page, in a template folder, at the top, or not named index.html.
    for (rel, text) in [
        ("library/nopage.smart/index.html", "<p>strayword</p>"),
        ("templates/x.smart/index.html", "<p>templateword</p>"),
        ("index.html", "<p>topword</p>"),
        ("library/tracker.smart/other.html", "<p>otherword</p>"),
        ("library/tracker.smart/myindex.html", "<p>myindexword</p>"),
        ("library/tracker.smart/sub/index.html", "<p>subword</p>"),
    ] {
        let file = t.vault.root().join(rel);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    }
    fs::write(
        t.vault.root().join("templates/x.md"),
        "---\ntitle: X\n---\n",
    )
    .unwrap();
    for word in [
        "strayword",
        "templateword",
        "topword",
        "otherword",
        "myindexword",
        "subword",
    ] {
        assert!(pages_found(&k, word).is_empty(), "{word}");
    }
}
