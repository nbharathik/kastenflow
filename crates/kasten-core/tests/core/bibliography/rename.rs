//! Renaming a citation key: the .bib entry, the pages that cite it, the pictures'
//! sidecars and the decks, in one commit that undo takes back; and everything that
//! makes it refuse.

use kasten_core::cite::{DeckText, KeyRename};

use super::support::{Fresh, MANAGED, NOW, fresh, human};

const FROM: &str = "old2020thing";
const TO: &str = "new2020thing";
const DECK: &str = "library/talk.deck";
const SIDECAR: &str = "assets/.meta/fig.png.json";

const BIB: &str = "% my papers\n@article{old2020thing,\n  title = {A thing},\n  year = {2020}\n}\n\n@article{other2019,\n  title = {Another},\n  year = {2019}\n}\n\n@article{old2020thingy, title = {A near key}}\n";

/// A deck with a citation on a slide, one in a group on it, and one in a layout.
fn deck(first: &str, grouped: &str, layout: &str) -> String {
    format!(
        "{{\n  \"format\": \"kasten-deck\",\n  \"formatVersion\": 1,\n  \"slides\": [\n    {{\n      \"elements\": [\n        {{\"id\": \"c1\", \"keys\": [{first}], \"type\": \"citation\"}},\n        {{\"children\": [{{\"id\": \"c2\", \"keys\": [\"{grouped}\"], \"type\": \"citation\"}}], \"id\": \"g1\", \"type\": \"group\"}},\n        {{\"id\": \"t1\", \"text\": \"old2020thing in a text stays\", \"type\": \"text\"}}\n      ],\n      \"id\": \"s1\",\n      \"layout\": \"title\"\n    }}\n  ],\n  \"theme\": {{\"layouts\": [{{\"elements\": [{{\"id\": \"lc\", \"keys\": [{layout}], \"type\": \"citation\"}}], \"name\": \"title\"}}]}},\n  \"title\": \"Talk\"\n}}\n"
    )
}

fn old_deck() -> String {
    deck(
        "\"old2020thing\", \"other2019\"",
        "old2020thing",
        "\"old2020thing\"",
    )
}

/// The same deck as the Slides engine would write it after the rename: slides only.
fn renamed_deck() -> String {
    deck(
        "\"new2020thing\", \"other2019\"",
        "new2020thing",
        "\"old2020thing\"",
    )
}

const PAGE_A: &str =
    "---\ntitle: A\n---\nSee [@old2020thing, p. 4] and [see @other2019; @old2020thing].\n";
const PAGE_B: &str = "---\ntitle: B\n---\nOnly [@other2019] and [@old2020thingy].\n";
const TEMPLATE: &str = "Template [@old2020thing]\n";
const CARD: &str = "{\n  \"id\": \"01K5ZK0000000000000000AS01\",\n  \"name\": \"fig.png\",\n  \"tags\": [],\n  \"citationKey\": \"old2020thing\"\n}\n";

/// A vault with the bibliography, pages, a picture and a deck all citing the key.
fn cited() -> Fresh {
    let f = fresh();
    f.put(MANAGED, BIB);
    f.put("library/a.md", PAGE_A);
    f.put("library/b.md", PAGE_B);
    f.put("templates/cite.md", TEMPLATE);
    f.put_bytes("assets/fig.png", b"not really a picture");
    f.put(SIDECAR, CARD);
    f.put(DECK, &old_deck());
    f.reindex();
    // What was written by hand is in history, so undoing the rename goes back to it.
    f.k.commit_external().unwrap();
    f
}

fn files(f: &Fresh) -> Vec<(String, String)> {
    [
        MANAGED,
        "library/a.md",
        "library/b.md",
        "templates/cite.md",
        SIDECAR,
        DECK,
    ]
    .iter()
    .map(|p| ((*p).to_owned(), f.text(p)))
    .collect()
}

fn request(f: &Fresh, decks: Vec<DeckText>) -> KeyRename {
    KeyRename {
        from: FROM.to_owned(),
        to: TO.to_owned(),
        bib_hash: f.hash(),
        decks,
    }
}

fn deck_text(f: &Fresh, text: &str) -> DeckText {
    let plan = f.k.plan_key_rename(FROM, TO).unwrap();
    DeckText {
        path: DECK.to_owned(),
        base_hash: plan.decks[0].hash.clone(),
        text: text.to_owned(),
    }
}

#[test]
fn the_plan_says_what_a_rename_would_change_and_writes_nothing() {
    let f = cited();
    let before = files(&f);
    let plan = f.k.plan_key_rename(FROM, TO).unwrap();
    assert_eq!(
        (plan.from.as_str(), plan.to.as_str(), plan.file.as_str()),
        (FROM, TO, MANAGED)
    );
    assert_eq!(plan.bib_hash, f.hash());
    let pages: Vec<(&str, usize)> = plan
        .pages
        .iter()
        .map(|p| (p.page.path.as_str(), p.page.count))
        .collect();
    assert_eq!(pages, [("library/a.md", 2), ("templates/cite.md", 1)]);
    assert_eq!(plan.pages[0].page.title, "A");
    assert_eq!(plan.decks.len(), 1);
    assert_eq!(plan.decks[0].deck.path, DECK);
    assert_eq!(
        (plan.decks[0].deck.count, plan.decks[0].deck.in_layouts),
        (2, 1)
    );
    assert_eq!(plan.assets, ["assets/fig.png"]);
    assert_eq!(files(&f), before);

    let uses = f.k.reference_uses(FROM).unwrap();
    assert_eq!(uses.pages.len(), 2);
    assert_eq!((uses.decks[0].count, uses.decks[0].in_layouts), (2, 1));
    assert_eq!(uses.assets, ["assets/fig.png"]);
    let none = f.k.reference_uses("nobody2000").unwrap();
    assert!(none.pages.is_empty() && none.decks.is_empty() && none.assets.is_empty());
}

#[test]
fn a_rename_changes_the_bib_pages_pictures_and_decks_in_one_commit_that_undo_takes_back() {
    let f = cited();
    let before = files(&f);
    let head = f.head();
    let done =
        f.k.rename_citation_key(
            &human(),
            &request(&f, vec![deck_text(&f, &renamed_deck())]),
            NOW,
        )
        .unwrap();
    assert_eq!(
        (done.pages, done.decks, done.assets, done.layouts),
        (2, 1, 1, 1)
    );
    assert_eq!(done.commit.as_deref(), Some(f.head().as_str()));
    assert_ne!(f.head(), head);

    // Only the key's bytes changed in the bibliography, and the near key is as it was.
    assert_eq!(f.text(MANAGED), BIB.replacen(FROM, TO, 1));
    assert!(f.text(MANAGED).contains("old2020thingy"));
    assert_eq!(f.text("library/a.md"), PAGE_A.replace(FROM, TO));
    assert_eq!(
        f.text("library/b.md"),
        PAGE_B,
        "a page that cites other keys is as it was"
    );
    assert_eq!(f.text("templates/cite.md"), TEMPLATE.replace(FROM, TO));
    assert!(
        f.text(SIDECAR)
            .contains("\"citationKey\": \"new2020thing\""),
        "{}",
        f.text(SIDECAR)
    );
    assert_eq!(f.text(DECK), renamed_deck());
    assert!(
        f.text(DECK)
            .contains("\"keys\": [\"old2020thing\"], \"type\": \"citation\"}], \"name\""),
        "the layout's citation is left"
    );

    // One commit: undoing it puts every file back.
    let undone =
        f.k.undo_commit(done.commit.as_deref().unwrap(), NOW)
            .unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    assert_eq!(files(&f), before);
    let again = f.k.bibliography().unwrap();
    assert!(again.managed.entries.iter().any(|e| e.key == FROM));
}

#[test]
fn a_deck_text_that_changes_anything_else_is_refused_and_nothing_is_written() {
    let f = cited();
    let before = files(&f);
    let head = f.head();
    let good = renamed_deck();
    for (what, text) in [
        (
            "another field",
            good.replace("\"Talk\"", "\"Another title\""),
        ),
        (
            "the layout's citation too",
            deck(
                "\"new2020thing\", \"other2019\"",
                "new2020thing",
                "\"new2020thing\"",
            ),
        ),
        (
            "a key dropped",
            deck("\"new2020thing\"", "new2020thing", "\"old2020thing\""),
        ),
        (
            "the text element",
            good.replace("old2020thing in a text stays", "changed"),
        ),
        ("not renamed at all", old_deck()),
        ("not a deck", "{}".to_owned()),
    ] {
        let given = deck_text(&f, &text);
        let err =
            f.k.rename_citation_key(&human(), &request(&f, vec![given]), NOW)
                .unwrap_err()
                .to_string();
        assert!(
            err.contains("changes more than the key") || err.contains("Not a KastenFlow deck"),
            "{what}: {err}"
        );
        assert_eq!(files(&f), before, "{what}");
        assert_eq!(f.head(), head, "{what}");
    }
}

#[test]
fn a_text_that_is_the_old_deck_in_other_spacing_and_key_order_is_accepted() {
    let f = cited();
    // The same JSON values, written compactly with other key orders.
    let compact = renamed_deck().replace("\n  ", "").replace(": ", ":");
    f.k.rename_citation_key(&human(), &request(&f, vec![deck_text(&f, &compact)]), NOW)
        .unwrap();
    assert_eq!(f.text(DECK), compact);
}

#[test]
fn a_deck_the_plan_lists_but_the_request_leaves_out_is_refused() {
    let f = cited();
    let before = files(&f);
    let err =
        f.k.rename_citation_key(&human(), &request(&f, vec![]), NOW)
            .unwrap_err()
            .to_string();
    assert!(err.contains(DECK) && err.contains("no new text"), "{err}");
    assert_eq!(files(&f), before);
}

#[test]
fn a_deck_that_the_plan_does_not_list_is_refused() {
    let f = cited();
    f.put(
        "library/other.deck",
        &deck("\"other2019\"", "other2019", "\"other2019\""),
    );
    let mut given = vec![deck_text(&f, &renamed_deck())];
    given.push(DeckText {
        path: "library/other.deck".to_owned(),
        base_hash: "0".to_owned(),
        text: deck("\"other2019\"", "other2019", "\"other2019\""),
    });
    let err =
        f.k.rename_citation_key(&human(), &request(&f, given), NOW)
            .unwrap_err()
            .to_string();
    assert!(
        err.contains("library/other.deck") && err.contains("does not cite"),
        "{err}"
    );
}

#[test]
fn a_deck_or_a_bibliography_that_changed_since_the_plan_is_refused() {
    let f = cited();
    let before = files(&f);
    let given = deck_text(&f, &renamed_deck());
    let planned = request(&f, vec![given.clone()]);

    f.put(DECK, &format!("{}\n", old_deck()));
    let err =
        f.k.rename_citation_key(&human(), &planned, NOW)
            .unwrap_err()
            .to_string();
    assert!(err.contains("changed since"), "{err}");
    f.put(DECK, &old_deck());

    f.put(MANAGED, &format!("{BIB}% touched\n"));
    let err =
        f.k.rename_citation_key(&human(), &planned, NOW)
            .unwrap_err()
            .to_string();
    assert!(err.contains("changed since"), "{err}");
    f.put(MANAGED, BIB);
    assert_eq!(files(&f), before);
    // Planned again, it goes through.
    f.k.rename_citation_key(
        &human(),
        &request(&f, vec![deck_text(&f, &renamed_deck())]),
        NOW,
    )
    .unwrap();
}

#[test]
fn a_key_that_cannot_be_renamed_is_refused_with_a_sentence() {
    let f = cited();
    f.put(
        "shelf/ext.bib",
        "@book{external2000, title = {Elsewhere}}\n",
    );
    f.reindex();
    let say = |from: &str, to: &str| f.k.plan_key_rename(from, to).unwrap_err().to_string();
    assert!(
        say(FROM, "other2019").contains("already a key"),
        "to an existing key"
    );
    assert!(
        say(FROM, "OTHER2019").contains("already a key"),
        "case alone is not a new key"
    );
    assert!(say(FROM, "has space").contains("cannot be a key"));
    assert!(say(FROM, "").contains("key is needed"));
    assert!(say(FROM, FROM).contains("same as the old"));
    assert!(say("nobody2000", "fresh").contains("no reference with the key"));
    let external = say("external2000", "fresh");
    assert!(
        external.contains("read only") && external.contains("shelf/ext.bib"),
        "{external}"
    );
}

#[test]
fn a_page_written_behind_the_engines_back_is_still_found() {
    let f = cited();
    // Not told to the engine: the index does not know this page.
    f.put("library/late.md", "[@old2020thing]\n");
    let plan = f.k.plan_key_rename(FROM, TO).unwrap();
    let paths: Vec<&str> = plan.pages.iter().map(|p| p.page.path.as_str()).collect();
    assert!(paths.contains(&"library/late.md"), "{paths:?}");
    f.k.rename_citation_key(
        &human(),
        &request(&f, vec![deck_text(&f, &renamed_deck())]),
        NOW,
    )
    .unwrap();
    assert_eq!(f.text("library/late.md"), "[@new2020thing]\n");
}

#[test]
fn a_page_changed_behind_the_engines_back_is_read_as_it_is() {
    let f = cited();
    // A page the index knew without the citation; now it has one (a moment later, so its time differs).
    std::thread::sleep(std::time::Duration::from_millis(40));
    f.put("library/b.md", "---\ntitle: B\n---\nNow [@old2020thing].\n");
    let plan = f.k.plan_key_rename(FROM, TO).unwrap();
    assert!(plan.pages.iter().any(|p| p.page.path == "library/b.md"));
}

#[cfg(windows)]
#[test]
fn a_rename_that_fails_part_way_leaves_every_file_as_it_was() {
    let f = cited();
    let before = files(&f);
    let given = deck_text(&f, &renamed_deck());
    // A read-only deck cannot be replaced on Windows, after the bibliography and pages were written.
    let path = f.dir.join(DECK);
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&path, permissions.clone()).unwrap();
    let result =
        f.k.rename_citation_key(&human(), &request(&f, vec![given]), NOW);
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(&path, permissions).unwrap();
    assert!(result.is_err());
    assert_eq!(files(&f), before);
}
