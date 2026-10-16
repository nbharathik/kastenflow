//! Picture usage reads a note once and remembers what it found while the file
//! is as it was. Whatever it answers must be what an engine that has never
//! looked answers from the same files: after an edit in the app, a rewrite
//! the watcher reported (even one that kept the size and the modified time),
//! a note made or deleted outside, and a note that shows no picture at all.

use crate::asset_support::fixture;
use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn write(t: &common::TempVault, rel: &str, text: &str) {
    let file = t.vault.root().join(rel);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

fn same_as_a_fresh_engine(t: &common::TempVault, k: &Kasten) {
    let fresh = Kasten::open(t.vault.root()).unwrap();
    assert_eq!(k.assets_usage().unwrap(), fresh.assets_usage().unwrap());
}

fn places(k: &Kasten, asset: &str) -> Vec<(String, String)> {
    k.assets_usage()
        .unwrap()
        .get(asset)
        .map(|u| {
            u.notes
                .iter()
                .map(|n| (n.path.clone(), n.title.clone()))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn the_second_look_reads_no_note_again_and_one_by_one_shares_the_scan() {
    let (t, k) = open();
    let wide = k
        .save_asset(&Actor::Human, "wide.png", &fixture("wide.png"), NOW)
        .unwrap();
    write(
        &t,
        "inbox/shows.md",
        "---\ntitle: Shows\n---\n![a](../assets/wide.png)\n",
    );
    assert_eq!(k.note_reads(), 0);
    let first = k.assets_usage().unwrap();
    let notes = t.vault.files(".md").unwrap().len();
    assert!(notes > 1);
    assert_eq!(
        k.note_reads(),
        notes,
        "every note is read once to begin with"
    );
    for _ in 0..2 {
        assert_eq!(k.assets_usage().unwrap(), first);
        assert_eq!(k.asset_usage(&wide).unwrap(), first[&wide]);
    }
    assert_eq!(k.note_reads(), notes, "a note was read again");
    assert_eq!(
        places(&k, &wide),
        [("inbox/shows.md".into(), "Shows".into())]
    );
    same_as_a_fresh_engine(&t, &k);
}

#[test]
fn an_edit_in_the_app_reads_that_note_alone() {
    let (t, k) = open();
    write(&t, "inbox/edited.md", "Nothing to see yet.\n");
    k.assets_usage().unwrap();
    let read = k.note_reads();
    assert!(places(&k, "assets/wide.png").is_empty());
    k.append(
        &Actor::Human,
        "inbox/edited.md",
        "![a](../assets/wide.png)\n",
        None,
        NOW,
    )
    .unwrap();
    assert_eq!(places(&k, "assets/wide.png").len(), 1);
    assert_eq!(
        k.note_reads(),
        read + 1,
        "only the edited note is read again"
    );
    same_as_a_fresh_engine(&t, &k);
}

#[test]
fn an_outside_rewrite_that_keeps_size_and_time_is_seen_once_the_watcher_reports_it() {
    let (t, k) = open();
    let path = "inbox/same-size.md";
    write(
        &t,
        path,
        "---\ntitle: Alpha\n---\n![a](../assets/wide.png)\n",
    );
    assert_eq!(
        places(&k, "assets/wide.png"),
        [(path.into(), "Alpha".into())]
    );
    let file = t.vault.root().join(path);
    let stamp = fs::metadata(&file).unwrap().modified().unwrap();
    let text = fs::read_to_string(&file).unwrap();
    // Same length, same modified time, another title and another picture.
    let rewritten = text.replace("Alpha", "Omega").replace("wide", "tall");
    assert_eq!(rewritten.len(), text.len());
    fs::write(&file, rewritten).unwrap();
    fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(stamp)
        .unwrap();
    assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), stamp);

    k.outside_changes(&[path.to_owned()], 1);
    assert!(places(&k, "assets/wide.png").is_empty());
    assert_eq!(
        places(&k, "assets/tall.png"),
        [(path.into(), "Omega".into())]
    );
    same_as_a_fresh_engine(&t, &k);
}

#[test]
fn a_change_that_alters_the_file_is_seen_without_a_report_and_a_deleted_note_is_gone() {
    let (t, k) = open();
    write(&t, "inbox/a.md", "![a](../assets/wide.png)\n");
    write(&t, "inbox/b.md", "![b](../assets/wide.png)\n");
    assert_eq!(places(&k, "assets/wide.png").len(), 2);
    // Longer, so its size differs: the cache notices on its own.
    write(
        &t,
        "inbox/a.md",
        "![a](../assets/wide.png) and more words\n",
    );
    fs::remove_file(t.vault.root().join("inbox/b.md")).unwrap();
    write(&t, "inbox/c.md", "![c](../assets/tall.png)\n");
    assert_eq!(
        places(&k, "assets/wide.png")
            .into_iter()
            .map(|p| p.0)
            .collect::<Vec<_>>(),
        ["inbox/a.md"]
    );
    assert_eq!(places(&k, "assets/tall.png").len(), 1);
    same_as_a_fresh_engine(&t, &k);
}

#[test]
fn forgetting_the_cache_reads_every_note_again() {
    let (t, k) = open();
    write(&t, "inbox/fine.md", "![a](../assets/wide.png)\n");
    assert_eq!(places(&k, "assets/wide.png").len(), 1);
    same_as_a_fresh_engine(&t, &k);
    let read = k.note_reads();
    k.forget_file_cache();
    k.assets_usage().unwrap();
    assert_eq!(
        k.note_reads(),
        read * 2,
        "a forgotten cache reads the notes again"
    );
}
