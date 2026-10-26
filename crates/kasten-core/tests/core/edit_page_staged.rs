//! `edit_page` in a chat that previews its changes: the edit is staged as a
//! change set (the page's text is what the set holds), later reads of the
//! blocks see it, applying it writes once, and a page that changed meanwhile
//! is merged or refused with a sentence.

use crate::common::NOW;
use crate::edit_page::{PAGE, blocks, commits, edit, open, replace, text};

use kasten_core::Outcome;
use kasten_core::agent::{AgentOp, ApplyOutcome};
use kasten_core::history::Actor;
use kasten_core::pages::PageStep;

fn staged(outcome: Outcome) {
    assert!(matches!(outcome, Outcome::Staged { .. }), "{outcome:?}");
}

#[test]
fn a_page_edit_is_staged_and_nothing_reaches_the_vault() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let before = text(&t);
    let n = commits(&k);
    let mut set = k.begin_changes(&s, NOW);
    let out = k
        .stage(
            &mut set,
            &s,
            &edit(vec![replace(&all[1], "Staged intro.")]),
            NOW,
        )
        .unwrap();
    staged(out);
    assert_eq!(text(&t), before, "the vault is untouched");
    assert_eq!(commits(&k), n);
    assert!(k.proposals().unwrap().is_empty(), "no proposal is kept");
    let held = set.text_of(PAGE).unwrap();
    assert!(held.contains("Staged intro.") && !held.contains("Intro paragraph."));
    assert_eq!(set.steps.len(), 1);
    assert_eq!(set.steps[0].name, "edit_page");
    assert_eq!(set.steps[0].summary, "Edit “Edit page test” (1 change)");
    // The frontmatter is the page's own: odd spacing and all.
    assert!(held.contains("custom:   [a,   b]"));
}

#[test]
fn accepting_the_set_writes_the_edit_once_in_one_commit() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let n = commits(&k);
    let mut set = k.begin_changes(&s, NOW);
    staged(
        k.stage(
            &mut set,
            &s,
            &edit(vec![replace(&all[1], "Staged intro.")]),
            NOW,
        )
        .unwrap(),
    );
    let applied = k.apply_changes(&set, "Ada", NOW).unwrap();
    let ApplyOutcome::Applied { commit, paths } = applied else {
        panic!("expected applied, got {applied:?}");
    };
    assert!(commit.is_some());
    assert_eq!(paths, [PAGE]);
    let after = text(&t);
    assert!(after.contains("Staged intro.") && !after.contains("Intro paragraph."));
    assert_eq!(after.matches("Staged intro.").count(), 1);
    assert_eq!(commits(&k), n + 1);
}

#[test]
fn rejecting_the_set_writes_nothing() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let before = text(&t);
    let n = commits(&k);
    let mut set = k.begin_changes(&s, NOW);
    staged(
        k.stage(
            &mut set,
            &s,
            &edit(vec![replace(&all[1], "Staged intro.")]),
            NOW,
        )
        .unwrap(),
    );
    k.discard_changes(&set).unwrap();
    assert_eq!(text(&t), before);
    assert_eq!(commits(&k), n);
}

#[test]
fn a_second_edit_names_blocks_as_the_staged_page_has_them() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let mut set = k.begin_changes(&s, NOW);
    // Two paragraphs become one callout: every id after it moves.
    staged(
        k.stage(
            &mut set,
            &s,
            &edit(vec![PageStep::Delete {
                block: crate::edit_page::r(&all[1]),
            }]),
            NOW,
        )
        .unwrap(),
    );
    // The vault still has the old ids: the stale read is refused while staging...
    let old = edit(vec![replace(&all[2], "Late")]);
    let err = k.stage(&mut set, &s, &old, NOW).unwrap_err();
    assert!(
        err.to_string().contains("changed since") || err.to_string().contains("no block"),
        "{err}"
    );
    // ...and the staged read gives the new ones.
    let seen = k.read_page_blocks_in(&set, PAGE, 1, 1000).unwrap();
    assert_eq!(seen.total, all.len() - 1);
    assert!(
        !seen
            .blocks
            .iter()
            .any(|b| b.text.contains("Intro paragraph."))
    );
    let heading = &seen.blocks[1];
    staged(
        k.stage(&mut set, &s, &edit(vec![replace(heading, "## Jobs")]), NOW)
            .unwrap(),
    );
    assert_eq!(set.steps.len(), 2);
    k.apply_changes(&set, "Ada", NOW).unwrap();
    let after = text(&t);
    assert!(after.contains("## Jobs") && !after.contains("Intro paragraph."));
}

#[test]
fn reading_blocks_without_a_staged_page_reads_the_vault() {
    let (_t, k, s) = open();
    let set = k.begin_changes(&s, NOW);
    let a = k.read_page_blocks_in(&set, PAGE, 1, 1000).unwrap();
    let b = k.read_page_blocks(PAGE, 1, 1000).unwrap();
    assert_eq!((a.hash, a.total), (b.hash, b.total));
}

#[test]
fn a_stale_block_is_refused_while_staging_with_a_sentence_and_nothing_is_kept() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let note = k.read(PAGE).unwrap();
    let human = note.text.replace("Intro paragraph.", "Other words.");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    let kept = text(&t);
    let mut set = k.begin_changes(&s, NOW);
    let err = k
        .stage(&mut set, &s, &edit(vec![replace(&all[1], "Late")]), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("changed since"), "{err}");
    assert!(set.is_empty());
    assert_eq!(text(&t), kept);
}

#[test]
fn a_person_changing_the_same_block_after_staging_makes_the_set_stale() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let mut set = k.begin_changes(&s, NOW);
    staged(
        k.stage(
            &mut set,
            &s,
            &edit(vec![replace(&all[1], "Staged intro.")]),
            NOW,
        )
        .unwrap(),
    );
    let note = k.read(PAGE).unwrap();
    let human = note.text.replace("Intro paragraph.", "Their words.");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    let kept = text(&t);
    let out = k.apply_changes(&set, "Ada", NOW).unwrap();
    assert!(matches!(out, ApplyOutcome::Stale { .. }), "{out:?}");
    assert_eq!(text(&t), kept, "nothing was written");
    assert!(k.log(Some(PAGE), 1).unwrap()[0].op.as_deref() != Some("apply_changes"));
    // Recalculating replays the step, which says why it cannot be made again.
    let (fresh, dropped) = k.rebase_changes(&set, NOW).unwrap();
    assert!(fresh.is_empty());
    assert_eq!(dropped.len(), 1);
    assert!(
        dropped[0].why.contains("changed since"),
        "{}",
        dropped[0].why
    );
}

#[test]
fn a_person_changing_another_part_of_the_page_keeps_both_edits() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let mut set = k.begin_changes(&s, NOW);
    staged(
        k.stage(
            &mut set,
            &s,
            &edit(vec![replace(&all[1], "Staged intro.")]),
            NOW,
        )
        .unwrap(),
    );
    let note = k.read(PAGE).unwrap();
    let human = note.text.replace("Closing words.", "Their closing.");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    k.apply_changes(&set, "Ada", NOW).unwrap();
    let after = text(&t);
    assert!(after.contains("Staged intro.") && after.contains("Their closing."));
}

#[test]
fn a_page_locked_after_staging_stops_the_set() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let mut set = k.begin_changes(&s, NOW);
    staged(
        k.stage(
            &mut set,
            &s,
            &edit(vec![replace(&all[1], "Staged intro.")]),
            NOW,
        )
        .unwrap(),
    );
    let locked = text(&t).replacen("custom:", "locked: true\ncustom:", 1);
    std::fs::write(t.vault.root().join(PAGE), &locked).unwrap();
    let err = k.apply_changes(&set, "Ada", NOW).unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    assert_eq!(text(&t), locked);
}

fn staged_intro(
    k: &kasten_core::Kasten,
    s: &kasten_core::agent::Session,
) -> kasten_core::agent::ChangeSet {
    let all = blocks(k);
    let mut set = k.begin_changes(s, NOW);
    staged(
        k.stage(
            &mut set,
            s,
            &edit(vec![replace(&all[1], "Staged intro.")]),
            NOW,
        )
        .unwrap(),
    );
    set
}

#[test]
fn a_page_deleted_or_moved_after_staging_makes_the_set_stale_and_writes_nothing() {
    let (t, k, s) = open();
    let set = staged_intro(&k, &s);
    let path = t.vault.root().join(PAGE);
    let moved = t.vault.root().join("library/moved-page.md");
    std::fs::rename(&path, &moved).unwrap();
    let out = k.apply_changes(&set, "Ada", NOW).unwrap();
    assert!(matches!(out, ApplyOutcome::Stale { .. }), "{out:?}");
    assert!(!path.exists(), "the page is not written back");
    std::fs::remove_file(&moved).unwrap();
    let out = k.apply_changes(&set, "Ada", NOW).unwrap();
    assert!(matches!(out, ApplyOutcome::Stale { .. }), "{out:?}");
    assert!(!path.exists());
}

#[test]
fn a_page_rewritten_whole_after_staging_is_never_overwritten() {
    let (t, k, s) = open();
    let set = staged_intro(&k, &s);
    let note = k.read(PAGE).unwrap();
    let theirs = "# Something else\n\nEntirely new words.\n";
    k.save_body(&Actor::Human, PAGE, theirs, &note.hash, NOW)
        .unwrap();
    let kept = text(&t);
    let out = k.apply_changes(&set, "Ada", NOW).unwrap();
    match out {
        ApplyOutcome::Stale { .. } => assert_eq!(text(&t), kept),
        other => {
            let after = text(&t);
            assert!(after.contains("Entirely new words."), "{other:?}\n{after}");
        }
    }
}

#[test]
fn a_page_edit_inside_a_staged_batch_is_staged_as_one_step() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let before = text(&t);
    let mut set = k.begin_changes(&s, NOW);
    let batch = AgentOp::Batch {
        ops: vec![
            edit(vec![replace(&all[1], "ONE")]),
            edit(vec![replace(&all[6], "TWO")]),
        ],
        reason: None,
    };
    staged(k.stage(&mut set, &s, &batch, NOW).unwrap());
    assert_eq!(text(&t), before);
    assert_eq!(set.steps.len(), 1);
    let held = set.text_of(PAGE).unwrap();
    assert!(held.contains("ONE") && held.contains("TWO"));
}

#[test]
fn a_page_edit_in_a_staged_chat_does_not_run_the_forty_percent_rule() {
    // The person looks at the whole set before it is applied.
    let (_t, k, s) = open();
    let all = blocks(&k);
    let steps = all
        .iter()
        .skip(1)
        .map(|b| PageStep::Delete {
            block: crate::edit_page::r(b),
        })
        .collect();
    let mut set = k.begin_changes(&s, NOW);
    staged(k.stage(&mut set, &s, &edit(steps), NOW).unwrap());
}
