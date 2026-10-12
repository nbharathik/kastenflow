//! Find and replace across a page and its sub-pages: a preview that writes
//! nothing, then one commit that changes every page or none, never the
//! frontmatter, links or code the way prose is changed, and that undoes to
//! the exact bytes. What it refuses is in `replace_refusals`.

use crate::common;

use std::fs;

use common::{NOW, TempVault, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{
    Expected, FindSpec, Kasten, NoteMatches, ReplaceRequest, content_hash, frontmatter::split,
};

pub(crate) const TOP: &str = "---\nid: TOP\ntitle: Trip plan\ntags: [paris]\nsummary: paris in spring\n---\nWe fly to Paris on Monday.\nSee [[Paris]] and [paris](https://paris.example/paris) and `paris` here.\n<summary>Paris summary</summary>\n> [!tip] Paris tip\n";
pub(crate) const MID: &str = "\u{feff}---\r\nid: MID\r\ntitle: Paris notes\r\nparent: TOP\r\n---\r\nparis cafes  \r\n\tParis museums\r\nlast paris";
pub(crate) const LOW: &str = "---\nid: LOW\ntitle: Low\nparent: MID\n---\nParis again, paris!\n";
const OTHER: &str = "---\nid: OTHER\ntitle: Other\n---\nparis elsewhere\n";
pub(crate) const FILES: [(&str, &str); 4] = [
    ("library/top.md", TOP),
    ("library/mid.md", MID),
    ("library/low.md", LOW),
    ("library/other.md", OTHER),
];

pub(crate) fn open_with(files: &[(&str, &str)]) -> (TempVault, Kasten) {
    let t = dev_vault();
    for (path, text) in files {
        fs::write(t.vault.root().join(path), text).unwrap();
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

pub(crate) fn open() -> (TempVault, Kasten) {
    open_with(&FILES)
}

pub(crate) fn spec(query: &str) -> FindSpec {
    FindSpec::new(query)
}

pub(crate) fn bytes(t: &TempVault, path: &str) -> Vec<u8> {
    fs::read(t.vault.root().join(path)).unwrap()
}

pub(crate) fn text(t: &TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

/// A request that replaces what the preview found.
pub(crate) fn request(
    root: &str,
    spec: &FindSpec,
    with: &str,
    preview: &[NoteMatches],
) -> ReplaceRequest {
    ReplaceRequest {
        root: root.to_owned(),
        spec: spec.clone(),
        with: with.to_owned(),
        expect: preview
            .iter()
            .map(|n| Expected {
                path: n.path.clone(),
                hash: n.hash.clone(),
                count: n.count,
            })
            .collect(),
    }
}

pub(crate) fn commits(k: &Kasten) -> usize {
    k.log(None, 1000).unwrap().len()
}

#[test]
fn previews_each_page_with_its_hash_count_and_samples_and_writes_nothing() {
    let (t, k) = open();
    let before = commits(&k);
    let found = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let paths: Vec<&str> = found.iter().map(|n| n.path.as_str()).collect();
    // The page, then the pages below it by path; not the page beside it.
    assert_eq!(
        paths,
        ["library/top.md", "library/low.md", "library/mid.md"]
    );
    let counts: Vec<usize> = found.iter().map(|n| n.count).collect();
    // Not the `[[Paris]]` target or the address, but the link text, the code
    // span, the text between tags and the callout title.
    assert_eq!(counts, [5, 2, 3]);
    assert_eq!(found[0].hash, content_hash(TOP));
    assert_eq!(found[2].hash, content_hash(MID));
    assert_eq!(found[0].title, "Trip plan");
    assert!(!found[0].title_hit && !found[0].locked);
    assert!(found[2].title_hit, "Paris notes is titled by the word");
    let first = &found[0].samples[0];
    assert_eq!(
        (first.line, first.before.as_str(), first.text.as_str()),
        (0, "We fly to ", "Paris")
    );
    assert_eq!(first.after, " on Monday.");
    assert!(found[0].samples.len() <= 3);
    assert_eq!(commits(&k), before);
    assert_eq!(text(&t, "library/top.md"), TOP);
}

#[test]
fn the_root_is_an_id_or_a_path_and_the_count_of_notes_is_capped() {
    let (_t, k) = open();
    let by_id = k.find_under("MID", &spec("paris"), 50).unwrap();
    let by_path = k.find_under("library/mid.md", &spec("paris"), 50).unwrap();
    assert_eq!(by_id, by_path);
    assert_eq!(by_id.len(), 2);
    assert_eq!(k.find_under("TOP", &spec("paris"), 2).unwrap().len(), 2);
    assert!(k.find_under("NOPE", &spec("paris"), 50).is_err());
    assert!(k.find_under(".trash/x.md", &spec("paris"), 50).is_err());
    // A page whose title holds the text is listed though its text has none.
    let only_title = k.find_under("MID", &spec("notes"), 50).unwrap();
    assert_eq!(only_title.len(), 1);
    assert_eq!((only_title[0].count, only_title[0].title_hit), (0, true));
    assert!(k.find_under("TOP", &spec(""), 50).is_err());
}

#[test]
fn options_reach_the_preview() {
    let (_t, k) = open();
    let exact = FindSpec {
        match_case: true,
        ..spec("Paris")
    };
    let counts: Vec<usize> = k
        .find_under("TOP", &exact, 50)
        .unwrap()
        .iter()
        .map(|n| n.count)
        .collect();
    // top: "Paris" in prose, in the summary and in the callout; low: one;
    // mid: one.
    assert_eq!(counts, [3, 1, 1]);
    let word = FindSpec {
        whole_word: true,
        ..spec("pari")
    };
    assert!(k.find_under("TOP", &word, 50).unwrap().is_empty());
}

#[test]
fn replaces_in_every_page_in_one_commit_and_undoes_to_the_exact_bytes() {
    let (t, k) = open();
    let paths = [
        "library/top.md",
        "library/mid.md",
        "library/low.md",
        "library/other.md",
    ];
    let before: Vec<Vec<u8>> = paths.iter().map(|p| bytes(&t, p)).collect();
    let log = commits(&k);
    let found = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let done = k
        .replace_under(
            &Actor::Human,
            &request("TOP", &spec("paris"), "Rome", &found),
            NOW,
        )
        .unwrap();
    assert_eq!(done.total, 10);
    let mut notes = done.notes.clone();
    notes.sort();
    assert_eq!(
        notes,
        [
            ("library/low.md".to_owned(), 2),
            ("library/mid.md".to_owned(), 3),
            ("library/top.md".to_owned(), 5)
        ]
    );
    assert_eq!(commits(&k), log + 1);
    let commit = done.commit.clone().expect("a commit");
    let newest = &k.log(None, 1).unwrap()[0];
    assert_eq!(newest.id, commit);
    assert_eq!(newest.summary, "replace: “paris” → “Rome” in 3 pages");

    // Frontmatter, the link target and address stay; the rest changes.
    assert_eq!(
        text(&t, "library/top.md"),
        "---\nid: TOP\ntitle: Trip plan\ntags: [paris]\nsummary: paris in spring\n---\nWe fly to Rome on Monday.\nSee [[Paris]] and [Rome](https://paris.example/paris) and `Rome` here.\n<summary>Rome summary</summary>\n> [!tip] Rome tip\n"
    );
    // Byte order mark, CRLF, trailing spaces, a tab and a missing final
    // line break are all kept.
    assert_eq!(
        bytes(&t, "library/mid.md"),
        "\u{feff}---\r\nid: MID\r\ntitle: Paris notes\r\nparent: TOP\r\n---\r\nRome cafes  \r\n\tRome museums\r\nlast Rome".as_bytes()
    );
    assert_eq!(
        text(&t, "library/low.md"),
        "---\nid: LOW\ntitle: Low\nparent: MID\n---\nRome again, Rome!\n"
    );
    // The page beside them is not under the root.
    assert_eq!(text(&t, "library/other.md"), OTHER);

    // The index follows.
    let hits: Vec<String> = k
        .search("rome", 20)
        .unwrap()
        .into_iter()
        .map(|h| h.path)
        .collect();
    for path in ["library/top.md", "library/mid.md", "library/low.md"] {
        assert!(hits.contains(&path.to_owned()), "{path}: {hits:?}");
    }
    assert!(!hits.contains(&"library/other.md".to_owned()));
    let old: Vec<String> = k
        .search("paris", 20)
        .unwrap()
        .into_iter()
        .map(|h| h.path)
        .collect();
    assert!(old.contains(&"library/other.md".to_owned()));
    assert!(!old.contains(&"library/low.md".to_owned()), "{old:?}");

    // Undone, every page is as it was, byte for byte.
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert_eq!(undone.reverted, [commit]);
    assert!(undone.conflict.is_none());
    for (path, was) in paths.iter().zip(&before) {
        assert_eq!(&bytes(&t, path), was, "{path}");
    }
}

#[test]
fn prose_is_escaped_and_code_is_written_raw() {
    let (t, k) = open_with(&[(
        "library/top.md",
        "---\nid: TOP\ntitle: Top\n---\nplain foo and `foo` here\n\n```\nlet foo = 1;\n```\n",
    )]);
    let found = k.find_under("TOP", &spec("foo"), 50).unwrap();
    k.replace_under(
        &Actor::Human,
        &request("TOP", &spec("foo"), "*a* [b] <c> _d_", &found),
        NOW,
    )
    .unwrap();
    assert_eq!(
        text(&t, "library/top.md"),
        "---\nid: TOP\ntitle: Top\n---\nplain \\*a\\* \\[b\\] \\<c\\> \\_d\\_ and `*a* [b] <c> _d_` here\n\n```\nlet *a* [b] <c> _d_ = 1;\n```\n"
    );
}

#[test]
fn a_replacement_cannot_turn_text_into_frontmatter_or_break_code() {
    // Without frontmatter, a body that opens with a rule must not become one.
    let (t, k) = open_with(&[("library/top.md", "---\nid-less body\nOLD\n")]);
    let found = k.find_under("library/top.md", &spec("old"), 50).unwrap();
    k.replace_under(
        &Actor::Human,
        &request("library/top.md", &spec("old"), "---", &found),
        NOW,
    )
    .unwrap();
    let new = text(&t, "library/top.md");
    assert_eq!(new, "---\nid-less body\n\\---\n");
    assert_eq!(split(&new).prefix, "");

    // A backtick inside a code span is refused, and nothing is written.
    let (t, k) = open_with(&[(
        "library/top.md",
        "---\nid: TOP\ntitle: Top\n---\na `foo` b\n",
    )]);
    let found = k.find_under("TOP", &spec("foo"), 50).unwrap();
    let before = bytes(&t, "library/top.md");
    let log = commits(&k);
    let err = k
        .replace_under(
            &Actor::Human,
            &request("TOP", &spec("foo"), "x`y", &found),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("backtick"), "{err}");
    assert_eq!(bytes(&t, "library/top.md"), before);
    assert_eq!(commits(&k), log);
}

#[test]
fn a_single_page_gets_the_singular_in_its_commit() {
    let (_t, k) = open();
    let found = k.find_under("LOW", &spec("again"), 50).unwrap();
    k.replace_under(
        &Actor::Human,
        &request("LOW", &spec("again"), "once more", &found),
        NOW,
    )
    .unwrap();
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "replace: “again” → “once more” in 1 page"
    );
}

#[test]
fn whole_word_and_case_reach_the_replacement() {
    let (t, k) = open_with(&[(
        "library/top.md",
        "---\nid: TOP\ntitle: Top\n---\nÄrger ärger Ärgerlich über überall\n",
    )]);
    let by_word = FindSpec {
        whole_word: true,
        match_case: true,
        ..spec("Ärger")
    };
    let found = k.find_under("TOP", &by_word, 50).unwrap();
    assert_eq!(found[0].count, 1);
    k.replace_under(
        &Actor::Human,
        &request("TOP", &by_word, "Zorn", &found),
        NOW,
    )
    .unwrap();
    assert_eq!(
        text(&t, "library/top.md"),
        "---\nid: TOP\ntitle: Top\n---\nZorn ärger Ärgerlich über überall\n"
    );
}
