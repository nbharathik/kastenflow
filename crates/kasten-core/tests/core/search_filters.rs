//! Search filters on dates and sub-pages: `on:`, `created:`, `updated:`
//! (a day, a month, a year or a range `a..b`) and `under:` (a page and every
//! page below it, by id or path), combined with words, tags and types.

use crate::common;

use std::fs;

use common::dev_vault;
use kasten_core::index::Index;

fn index_of(t: &common::TempVault) -> Index {
    let mut index = Index::open(&t.vault.root().join(".kasten/cache/index.sqlite")).unwrap();
    index.rebuild(&t.vault).unwrap();
    index
}

fn write(t: &common::TempVault, path: &str, text: &str) {
    let file = t.vault.root().join(path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

fn dated(title: &str, created: &str, updated: &str, extra: &str) -> String {
    format!(
        "---\ntitle: {title}\ncreated: {created}\nupdated: {updated}\n{extra}---\nOrchid notes.\n"
    )
}

/// Four orchid notes through September and October 2026, and one with no
/// dates of its own.
fn orchids() -> common::TempVault {
    let t = dev_vault();
    write(
        &t,
        "library/early.md",
        &dated(
            "Early",
            "2026-09-05T10:00:00Z",
            "2026-09-20T08:00:00Z",
            "tags: [garden]\n",
        ),
    );
    write(
        &t,
        "library/middle.md",
        &dated("Middle", "2026-09-15T12:00:00Z", "2026-09-15T12:30:00Z", ""),
    );
    write(
        &t,
        "library/october.md",
        &dated(
            "October",
            "2026-10-06T09:00:00Z",
            "2026-10-06T09:30:00Z",
            "tags: [garden]\ntype: card\n",
        ),
    );
    write(
        &t,
        "library/late.md",
        &dated("Late", "2026-10-20T07:00:00Z", "2026-10-21T07:00:00Z", ""),
    );
    write(
        &t,
        "library/bare.md",
        "---\ntitle: Bare\n---\nOrchid notes.\n",
    );
    // Its only date is its file's: noon on 2020-01-01 (UTC).
    let file = fs::File::options()
        .write(true)
        .open(t.vault.root().join("library/bare.md"))
        .unwrap();
    file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_577_880_000))
        .unwrap();
    t
}

fn paths(index: &Index, query: &str) -> Vec<String> {
    let mut found: Vec<String> = index
        .search(query, 100)
        .unwrap()
        .into_iter()
        .map(|h| h.path.trim_start_matches("library/").to_owned())
        .collect();
    found.sort();
    found
}

#[test]
fn created_takes_a_day_a_month_a_year_or_a_range() {
    let t = orchids();
    let index = index_of(&t);
    let q = |extra: &str| paths(&index, &format!("orchid {extra}"));
    assert_eq!(q("created:2026-10-06"), ["october.md"]);
    assert_eq!(q("created:2026-10"), ["late.md", "october.md"]);
    assert_eq!(q("created:2026-09"), ["early.md", "middle.md"]);
    assert_eq!(
        q("created:2026-09-01..2026-09-30"),
        ["early.md", "middle.md"]
    );
    assert_eq!(
        q("created:2026-09-15..2026-10-06"),
        ["middle.md", "october.md"]
    );
    // A month at either end reaches its first and last day.
    assert_eq!(
        q("created:2026-09..2026-10"),
        ["early.md", "late.md", "middle.md", "october.md"]
    );
    assert_eq!(q("created:2026-10-01.."), ["late.md", "october.md"]);
    assert_eq!(q("created:..2026-09-30"), ["early.md", "middle.md"]);
    // A year; a note with no date of its own has no created day.
    assert_eq!(
        q("created:2026"),
        ["early.md", "late.md", "middle.md", "october.md"]
    );
    assert!(q("created:2025").is_empty());
    assert!(
        q("created:2020").is_empty(),
        "the file's time is no created day"
    );
}

#[test]
fn updated_follows_the_note_s_own_date() {
    let t = orchids();
    let index = index_of(&t);
    let q = |extra: &str| paths(&index, &format!("orchid {extra}"));
    // Early was made on September 5 and last changed on September 20.
    assert_eq!(q("updated:2026-09-20"), ["early.md"]);
    assert!(q("updated:2026-09-05").is_empty());
    assert_eq!(
        q("updated:2026-09-01..2026-09-30"),
        ["early.md", "middle.md"]
    );
    assert_eq!(q("updated:2026-10-21"), ["late.md"]);
    assert_eq!(q("updated:2026-10"), ["late.md", "october.md"]);
    // With no date of its own, a note has its file's time.
    assert_eq!(q("updated:2020-01-01"), ["bare.md"]);
}

#[test]
fn on_matches_the_day_a_note_was_made_or_changed() {
    let t = orchids();
    let index = index_of(&t);
    let q = |extra: &str| paths(&index, &format!("orchid {extra}"));
    assert_eq!(q("on:2026-09-05"), ["early.md"], "made that day");
    assert_eq!(q("on:2026-09-20"), ["early.md"], "changed that day");
    assert_eq!(q("on:2026-10-06"), ["october.md"]);
    assert_eq!(q("on:2020-01-01"), ["bare.md"], "the file's time counts");
    assert_eq!(q("on:2026-09"), ["early.md", "middle.md"]);
    assert_eq!(q("on:2026-10-01..2026-10-31"), ["late.md", "october.md"]);
    assert!(q("on:2026-08-31").is_empty());
}

#[test]
fn date_filters_alone_list_the_newest_matches() {
    let t = orchids();
    let index = index_of(&t);
    let hits = index.search("created:2026-10-06", 20).unwrap();
    assert!(
        hits.iter().any(|h| h.path == "library/october.md"),
        "{hits:?}"
    );
    assert!(hits.iter().all(|h| h.path != "library/early.md"));
    let hits = index.search("on:2026-10-06", 20).unwrap();
    assert!(hits.iter().any(|h| h.path == "library/october.md"));
}

#[test]
fn date_filters_combine_with_words_tags_and_types() {
    let t = orchids();
    let index = index_of(&t);
    let q = |query: &str| paths(&index, query);
    assert_eq!(q("orchid tag:garden created:2026-09"), ["early.md"]);
    assert_eq!(q("orchid #garden updated:2026-10"), ["october.md"]);
    assert_eq!(q("orchid type:card on:2026-10"), ["october.md"]);
    assert_eq!(q("orchid created:2026-10 after:2026-10-10"), ["late.md"]);
    assert_eq!(
        q("orchid created:2026-09-01..2026-10-31 updated:2026-10-06"),
        ["october.md"]
    );
    // Two date filters narrow each other.
    assert!(q("orchid created:2026-09 updated:2026-10").is_empty());
}

#[test]
fn a_date_that_is_not_one_is_a_word_and_a_backwards_range_finds_nothing() {
    let t = orchids();
    let index = index_of(&t);
    for query in [
        "orchid created:2026-13",
        "orchid created:2026-02-30",
        "orchid created:soon",
        "orchid on:2026-10-06..2026-10-0x",
        "orchid created:2026-10-31..2026-10-01",
        "created:2026-10-31..2026-10-01",
    ] {
        assert!(index.search(query, 20).unwrap().is_empty(), "{query}");
    }
}

fn family() -> common::TempVault {
    let t = dev_vault();
    let page = |id: &str, title: &str, parent: Option<&str>, extra: &str| {
        let parent = parent.map_or(String::new(), |p| format!("parent: {p}\n"));
        format!("---\nid: {id}\ntitle: {title}\n{parent}{extra}---\nPelican notes.\n")
    };
    write(&t, "library/top.md", &page("TOP1", "Top", None, ""));
    write(
        &t,
        "library/mid.md",
        &page("MID1", "Mid", Some("TOP1"), "tags: [x]\n"),
    );
    write(&t, "library/low.md", &page("LOW1", "Low", Some("MID1"), ""));
    write(
        &t,
        "library/side.md",
        &page("SIDE1", "Side", Some("TOP1"), ""),
    );
    write(&t, "library/other.md", &page("OTHER1", "Other", None, ""));
    // Two pages that are each other's parent, and one its own.
    write(
        &t,
        "library/loop-a.md",
        &page("LA", "Loop A", Some("LB"), ""),
    );
    write(
        &t,
        "library/loop-b.md",
        &page("LB", "Loop B", Some("LA"), ""),
    );
    write(
        &t,
        "library/self.md",
        &page("SELF1", "Self", Some("SELF1"), ""),
    );
    write(&t, "library/my page.md", &page("MYP", "My page", None, ""));
    write(
        &t,
        "library/child of my page.md",
        &page("CHILD", "Child of my page", Some("MYP"), ""),
    );
    t
}

#[test]
fn under_finds_a_page_and_everything_below_it() {
    let t = family();
    let index = index_of(&t);
    let q = |extra: &str| paths(&index, &format!("pelican {extra}"));
    assert_eq!(q("under:TOP1"), ["low.md", "mid.md", "side.md", "top.md"]);
    assert_eq!(q("under:MID1"), ["low.md", "mid.md"]);
    assert_eq!(q("under:LOW1"), ["low.md"]);
    // By path, with or without the extension.
    assert_eq!(q("under:library/mid.md"), ["low.md", "mid.md"]);
    assert_eq!(q("under:library/mid"), ["low.md", "mid.md"]);
    assert_eq!(
        q("under:library/top.md"),
        ["low.md", "mid.md", "side.md", "top.md"]
    );
    assert!(q("under:NOPE").is_empty());
    assert!(q("under:library/nothing.md").is_empty());
}

#[test]
fn under_alone_lists_the_family_and_combines_with_other_filters() {
    let t = family();
    let index = index_of(&t);
    let q = |query: &str| paths(&index, query);
    assert_eq!(q("under:TOP1"), ["low.md", "mid.md", "side.md", "top.md"]);
    assert_eq!(q("pelican under:TOP1 tag:x"), ["mid.md"]);
    assert_eq!(q("under:TOP1 tag:x"), ["mid.md"]);
    assert_eq!(q("pelican under:TOP1 mid"), ["mid.md"]);
    assert_eq!(q("under:TOP1 created:2026"), Vec::<String>::new());
}

#[test]
fn a_parent_loop_cannot_run_forever() {
    let t = family();
    let index = index_of(&t);
    let q = |extra: &str| paths(&index, &format!("pelican {extra}"));
    assert_eq!(q("under:LA"), ["loop-a.md", "loop-b.md"]);
    assert_eq!(q("under:library/loop-b.md"), ["loop-a.md", "loop-b.md"]);
    assert_eq!(q("under:SELF1"), ["self.md"]);
}

#[test]
fn under_takes_a_quoted_path_with_spaces() {
    let t = family();
    let index = index_of(&t);
    assert_eq!(
        paths(&index, "pelican under:\"library/my page.md\""),
        ["child of my page.md", "my page.md"]
    );
}

#[test]
fn under_follows_pages_as_they_move() {
    let t = family();
    let mut index = index_of(&t);
    // Low is given another parent outside the tree.
    write(
        &t,
        "library/low.md",
        "---\nid: LOW1\ntitle: Low\nparent: OTHER1\n---\nPelican notes.\n",
    );
    index
        .refresh(&t.vault, &["library/low.md".to_owned()])
        .unwrap();
    assert_eq!(paths(&index, "pelican under:MID1"), ["mid.md"]);
    assert_eq!(
        paths(&index, "pelican under:OTHER1"),
        ["low.md", "other.md"]
    );
}

#[test]
fn the_notes_under_a_page_are_listed_root_first_for_the_engine() {
    let t = family();
    let index = index_of(&t);
    // The page itself, then the pages below it by path.
    assert_eq!(
        index.under("TOP1").unwrap(),
        [
            "library/top.md",
            "library/low.md",
            "library/mid.md",
            "library/side.md"
        ]
        .map(String::from)
    );
    assert_eq!(
        index.under("library/mid.md").unwrap(),
        ["library/mid.md", "library/low.md"].map(String::from)
    );
    assert_eq!(
        index.under("library/loop-a").unwrap(),
        ["library/loop-a.md", "library/loop-b.md"].map(String::from)
    );
    assert!(index.under("NOPE").unwrap().is_empty());
}
