//! The health report: one read-only look at the vault's files, index,
//! history, backup, review queue and trash. It adds up what the other reads
//! say, commits nothing and writes nothing outside the cache folder.

use crate::asset_support::fixture;
use crate::common;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};

const PLAN: &str = "library/plan.md";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

/// Every file but git's and Kasten's own, by path.
fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn counts_what_the_vault_holds() {
    let (t, k) = open();
    k.save_asset(&Actor::Human, "wide.png", &fixture("wide.png"), NOW)
        .unwrap();
    k.create_board(&Actor::Human, "Extra", None, NOW).unwrap();
    fs::write(t.vault.root().join("library/sketch.drawio"), "<mxfile/>").unwrap();
    k.outside_changes(&["library/sketch.drawio".to_owned()], 1);
    let h = k.health(NOW.millis);
    let notes = k
        .list()
        .unwrap()
        .into_iter()
        .filter(|n| n.kind != "template")
        .count();
    assert_eq!(h.counts.notes, notes);
    assert_eq!(h.counts.boards, k.boards().unwrap().len());
    assert_eq!(h.counts.boards, 2);
    assert_eq!(h.counts.decks, k.decks().unwrap().len());
    assert_eq!(h.counts.diagrams, 1);
    assert_eq!(h.counts.sources, k.sources().unwrap().len());
    assert_eq!(h.counts.assets, 1);
    assert_eq!(h.format, 1);
    assert_eq!(h.synced, None);
}

#[test]
fn reports_the_index_history_and_the_revision() {
    let (_t, k) = open();
    let h = k.health(NOW.millis);
    assert_eq!(h.index.notes, k.list().unwrap().len());
    assert_eq!(h.index.unindexed, 0);
    assert!(h.index.schema >= 1);
    assert!(h.history.on && !h.history.busy && h.history.pending == 0);
    assert!(
        h.history.last_commit.is_some(),
        "the vault has a first commit"
    );
    assert_eq!(h.revision, k.revision());

    // Typing waits for its commit.
    let path = "projects/photo-organiser/cards/duplicate-score-for-photos.md";
    let note = k.read(path).unwrap();
    k.save_body(&Actor::Human, path, "Typed.\n", &note.hash, NOW)
        .unwrap();
    let typing = k.health(NOW.millis);
    assert_eq!(typing.history.pending, 1);
    assert_eq!(typing.revision.notes, h.revision.notes + 1);
    k.commit_edits().unwrap();
    assert_eq!(k.health(NOW.millis).history.pending, 0);
}

#[test]
fn a_vault_without_history_says_so() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let h = k.health(NOW.millis);
    assert!(!h.history.on);
    assert_eq!(h.history.last_commit, None);
    assert_eq!(serde_json::to_value(&h.backup).unwrap()["state"], "off");
    assert!(h.backup_file.is_none());
}

#[test]
fn counts_proposals_waiting_the_trash_and_conflict_copies() {
    let (t, k) = open();
    let long: String = (0..30)
        .map(|n| format!("Line {n} of the plan with some words.\n"))
        .collect();
    fs::write(
        t.vault.path_of(PLAN).unwrap(),
        format!("---\ntitle: Plan\n---\n## Details\n\n{long}"),
    )
    .unwrap();
    k.reindex().unwrap();
    let session = Session::start("claude-code", NOW);
    let wipe = AgentOp::ReplaceSection {
        path: PLAN.into(),
        heading: "Details".into(),
        markdown: "Gone.".into(),
    };
    assert!(matches!(
        k.agent_run(&session, &wipe, NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
    assert_eq!(k.health(NOW.millis).proposals, 1);

    assert_eq!(k.health(NOW.millis).trash.items, 0);
    k.trash(&Actor::Human, "inbox/capture-ideas-here.md", NOW)
        .unwrap();
    let trash = k.health(NOW.millis).trash;
    assert_eq!(trash.items, 1);
    assert!(trash.bytes > 20, "{trash:?}");

    assert!(k.health(NOW.millis).conflicts.is_empty());
    fs::write(
        t.vault
            .root()
            .join("library/plan (conflict 2026-10-06 09-30).md"),
        "---\ntitle: Plan (conflict)\n---\nx\n",
    )
    .unwrap();
    fs::write(
        t.vault
            .root()
            .join("library/talk (conflict 2026-10-06 09-31).deck"),
        "{}",
    )
    .unwrap();
    k.outside_changes(
        &["library/plan (conflict 2026-10-06 09-30).md".to_owned()],
        1,
    );
    assert_eq!(
        k.health(NOW.millis).conflicts,
        [
            "library/plan (conflict 2026-10-06 09-30).md",
            "library/talk (conflict 2026-10-06 09-31).deck"
        ]
    );
}

#[test]
fn the_last_check_is_what_verify_last_found_and_kept_in_the_cache() {
    let (t, k) = open();
    assert!(k.health(NOW.millis).last_check.is_none());
    let started = kasten_core::Instant::now().millis;
    let report = k.verify().unwrap();
    let saved = fs::read_to_string(t.vault.root().join(".kasten/cache/verify.json")).unwrap();
    assert!(saved.contains("\"problems\""), "{saved}");
    let check = k
        .health(NOW.millis)
        .last_check
        .expect("verify left its report");
    assert_eq!(
        (check.notes, check.boards, check.decks, check.problems),
        (
            report.notes,
            report.boards,
            report.decks,
            report.problems.len()
        )
    );
    assert!(check.time >= started);
    // A vault opened afresh still knows: the file is the memory.
    let again = Kasten::open(t.vault.root()).unwrap();
    assert_eq!(again.health(NOW.millis).last_check, Some(check));
    // A file that cannot be read is no check at all.
    fs::write(t.vault.root().join(".kasten/cache/verify.json"), "not json").unwrap();
    assert!(again.health(NOW.millis).last_check.is_none());
}

#[test]
fn looking_changes_nothing_and_commits_nothing() {
    let (t, k) = open();
    let before = tree(t.vault.root());
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let revision = k.revision();
    for _ in 0..3 {
        k.health(NOW.millis);
    }
    assert_eq!(tree(t.vault.root()), before);
    assert_eq!(k.log(None, 1).unwrap()[0].id, head);
    assert_eq!(k.revision(), revision);
    assert!(k.pending_edits().is_empty());
}

#[test]
fn serves_the_shape_the_app_reads() {
    let (_t, k) = open();
    let json = serde_json::to_value(k.health(NOW.millis)).unwrap();
    for key in [
        "revision",
        "counts",
        "index",
        "history",
        "backup",
        "backupFile",
        "proposals",
        "trash",
        "conflicts",
        "lastCheck",
        "synced",
        "format",
    ] {
        assert!(json.get(key).is_some(), "missing {key} in {json}");
    }
    assert_eq!(
        json["counts"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .len(),
        6
    );
    assert!(json["history"].get("lastCommit").is_some() && json["history"].get("busy").is_some());
    assert!(json["revision"].get("epoch").is_some());
}
