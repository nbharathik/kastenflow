//! Applying a change set: one commit by the approved agent, a person's own
//! edits made meanwhile kept or reported, everything or nothing written.

use std::fs;

use kasten_core::agent::{AgentOp, ApplyOutcome, ChangeSet};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};

use crate::change_sets::{
    DRAFT, JOURNAL, WELCOME, append, create, open, replace, snapshot, stage, without_stamps,
};
use crate::common::NOW;

fn applied(outcome: ApplyOutcome) -> (String, Vec<String>) {
    match outcome {
        ApplyOutcome::Applied { commit, paths } => (commit.expect("a commit"), paths),
        stale => panic!("expected it to apply, got {stale:?}"),
    }
}

fn stale(outcome: ApplyOutcome) -> Vec<String> {
    match outcome {
        ApplyOutcome::Stale { files } => files,
        applied => panic!("expected it to be stale, got {applied:?}"),
    }
}

fn tag(path: &str, tag: &str) -> AgentOp {
    AgentOp::Tags {
        path: path.into(),
        add: vec![tag.into()],
        remove: vec![],
    }
}

/// A set that changes two notes and makes a third.
fn busy(k: &Kasten, s: &kasten_core::agent::Session) -> ChangeSet {
    let mut set = k.begin_changes(s, NOW);
    stage(k, &mut set, s, &append(WELCOME, "Added by the chat."));
    stage(
        k,
        &mut set,
        s,
        &replace(DRAFT, "3. Method", "A fresh method."),
    );
    stage(k, &mut set, s, &tag(DRAFT, "reviewed"));
    stage(k, &mut set, s, &create("Fresh page", "Fresh body.\n"));
    set
}

#[test]
fn applying_is_one_commit_by_the_approved_agent() {
    let (t, k, s) = open();
    let set = busy(&k, &s);
    let before = k.log(None, 500).unwrap().len();
    let (commit, paths) = applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    let log = k.log(None, 500).unwrap();
    assert_eq!(log.len(), before + 1, "exactly one commit");
    let last = &log[0];
    assert_eq!(last.id, commit);
    assert_eq!(last.author, "agent:kasten-chat");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert_eq!(last.approved_by.as_deref(), Some("Ada"));
    assert_eq!(last.op.as_deref(), Some("apply_changes"));
    assert!(
        last.message
            .contains(&format!("Kasten-Change-Set: {}", set.id)),
        "{}",
        last.message
    );
    assert_eq!(paths, ["library/fresh-page.md", WELCOME, DRAFT]);
    for path in &paths {
        assert_eq!(
            t.vault.read(path).unwrap().text,
            set.text_of(path).unwrap(),
            "{path}"
        );
    }
    // The scratch folder is gone, and the vault has nothing waiting.
    assert!(
        !t.vault
            .root()
            .join(".kasten/cache/changes")
            .join(&set.id)
            .exists()
    );
    assert!(k.dirty().unwrap().is_empty());

    // Undo session takes the whole set back, as one more commit.
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    assert_eq!(undone.reverted, [commit]);
    assert!(!t.vault.exists("library/fresh-page.md"));
    assert!(
        !t.vault
            .read(WELCOME)
            .unwrap()
            .text
            .contains("Added by the chat.")
    );
}

#[test]
fn applying_the_same_set_as_the_direct_ops_would_write_the_same_notes() {
    let (_a, direct, ds) = open();
    let (b, staged, ss) = open();
    let ops = [
        append(WELCOME, "Added by the chat."),
        replace(DRAFT, "3. Method", "A fresh method."),
        tag(DRAFT, "reviewed"),
        create("Related work notes", "A second note with that title.\n"),
    ];
    let mut set = staged.begin_changes(&ss, NOW);
    for op in &ops {
        stage(&staged, &mut set, &ss, op);
        direct.agent_run(&ds, op, NOW).unwrap();
    }
    applied(staged.apply_changes(&set, "Ada", NOW).unwrap());
    // Every note of both vaults agrees, but for the stamps; a note that
    // shares a title keeps the links to the other where they went.
    for meta in direct.list().unwrap() {
        let want = direct.read(&meta.path).unwrap().text;
        let got = b.vault.read(&meta.path).unwrap().text;
        assert_eq!(without_stamps(&got), without_stamps(&want), "{}", meta.path);
    }
}

#[test]
fn a_persons_edit_to_another_part_is_kept() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "Staged tail."));
    stage(&k, &mut set, &s, &tag(WELCOME, "staged"));
    // A person edits a line in the middle meanwhile, and saves (which moves `updated`).
    let current = k.read(WELCOME).unwrap();
    let body = kasten_core::frontmatter::split(&current.text)
        .body
        .replace("only you can empty it.", "only you can empty it, for good.");
    let later = Instant {
        millis: NOW.millis + 60_000,
    };
    k.save_body(&Actor::Human, WELCOME, &body, &current.hash, later)
        .unwrap();
    assert_eq!(k.stale_changes(&set, later).unwrap(), Vec::<String>::new());
    applied(k.apply_changes(&set, "Ada", later).unwrap());
    let text = t.vault.read(WELCOME).unwrap().text;
    assert!(
        text.contains("only you can empty it, for good."),
        "the person's edit"
    );
    assert!(text.contains("Staged tail."), "the chat's edit");
    assert!(text.contains("staged"), "and its tag: {text}");
}

#[test]
fn a_clash_makes_the_whole_set_stale_and_writes_nothing() {
    let (t, k, s) = open();
    let set = busy(&k, &s);
    // A person rewrites the line the chat's section replaced.
    let file = t.vault.root().join(DRAFT);
    let text = fs::read_to_string(&file).unwrap().replace(
        "We give each person ten questions about notes they wrote a month earlier,",
        "We interview twelve people about their own notes,",
    );
    fs::write(&file, text).unwrap();
    let before = snapshot(t.vault.root());
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let files = stale(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert_eq!(files, [DRAFT]);
    assert_eq!(k.stale_changes(&set, NOW).unwrap(), [DRAFT]);
    assert_eq!(snapshot(t.vault.root()), before, "not even the other notes");
    assert!(!t.vault.exists("library/fresh-page.md"));
    // No commit but, at most, the person's own outside edit being noticed.
    let after = k.log(None, 3).unwrap();
    assert!(after[0].id == head || !after[0].agent, "{after:?}");
    // The set is still there, to recalculate or discard.
    assert!(
        t.vault
            .root()
            .join(".kasten/cache/changes")
            .join(&set.id)
            .join("set.json")
            .is_file()
    );
}

#[test]
fn recalculating_plans_the_steps_again_on_the_vault_as_it_is() {
    let (t, k, s) = open();
    let set = busy(&k, &s);
    let file = t.vault.root().join(DRAFT);
    let text = fs::read_to_string(&file).unwrap().replace(
        "We give each person ten questions about notes they wrote a month earlier,",
        "We interview twelve people about their own notes,",
    );
    fs::write(&file, text).unwrap();
    assert_eq!(k.stale_changes(&set, NOW).unwrap(), [DRAFT]);
    let (fresh, dropped) = k.rebase_changes(&set, NOW).unwrap();
    assert!(dropped.is_empty(), "{dropped:?}");
    assert_eq!(fresh.id, set.id);
    assert_eq!(fresh.steps.len(), set.steps.len());
    assert_eq!(k.stale_changes(&fresh, NOW).unwrap(), Vec::<String>::new());
    applied(k.apply_changes(&fresh, "Ada", NOW).unwrap());
    // The section replaced is the chat's, as a section replace always is.
    let draft = t.vault.read(DRAFT).unwrap().text;
    assert!(draft.contains("A fresh method.") && !draft.contains("interview twelve"));
}

#[test]
fn a_step_that_can_no_longer_be_made_is_dropped_when_recalculating() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "Kept."));
    stage(&k, &mut set, &s, &replace(DRAFT, "3. Method", "Gone."));
    // The heading is taken out of the draft meanwhile.
    let file = t.vault.root().join(DRAFT);
    let text = fs::read_to_string(&file)
        .unwrap()
        .replace("## 3. Method", "## 3. Approach");
    fs::write(&file, text).unwrap();
    let (fresh, dropped) = k.rebase_changes(&set, NOW).unwrap();
    assert_eq!(dropped.len(), 1);
    assert!(dropped[0].why.contains("No heading"), "{:?}", dropped[0]);
    assert!(dropped[0].summary.contains("Replace"), "{:?}", dropped[0]);
    assert_eq!(fresh.files.len(), 1);
    applied(k.apply_changes(&fresh, "Ada", NOW).unwrap());
}

#[test]
fn a_note_locked_after_staging_blocks_the_whole_apply() {
    let (t, k, s) = open();
    let set = busy(&k, &s);
    let file = t.vault.root().join(DRAFT);
    let text = fs::read_to_string(&file).unwrap().replacen(
        "tags: [paper]",
        "tags: [paper]\nlocked: true",
        1,
    );
    fs::write(&file, text).unwrap();
    k.reindex().unwrap();
    let before = snapshot(t.vault.root());
    let err = k.apply_changes(&set, "Ada", NOW).unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    assert_eq!(snapshot(t.vault.root()), before, "nothing was written");
    assert!(!t.vault.exists("library/fresh-page.md"));
}

#[test]
fn a_failure_part_way_puts_everything_back() {
    let (t, k, s) = open();
    let set = busy(&k, &s);
    let before = snapshot(t.vault.root());
    let head = k.log(None, 1).unwrap()[0].id.clone();
    k.fail_changes_writes_after(2);
    let err = k.apply_changes(&set, "Ada", NOW).unwrap_err();
    assert!(err.to_string().contains("No space"), "{err}");
    assert_eq!(snapshot(t.vault.root()), before, "every file as it was");
    assert_eq!(k.log(None, 1).unwrap()[0].id, head, "no commit");
    // The set is still there, and applies once the disk allows.
    applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert!(t.vault.exists("library/fresh-page.md"));
}

#[test]
fn a_new_note_takes_the_next_free_name_if_its_own_was_taken_meanwhile() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let made = stage(&k, &mut set, &s, &create("Twin", "from the chat"));
    assert_eq!(made["path"], "library/twin.md");
    fs::write(
        t.vault.root().join("library/twin.md"),
        "---\ntitle: Twin\n---\nthe person's\n",
    )
    .unwrap();
    let (_, paths) = applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert_eq!(paths, ["library/twin-2.md"]);
    assert!(
        t.vault
            .read("library/twin.md")
            .unwrap()
            .text
            .contains("the person's")
    );
    assert!(
        t.vault
            .read("library/twin-2.md")
            .unwrap()
            .text
            .contains("from the chat")
    );
}

#[test]
fn a_file_taken_away_meanwhile_makes_the_set_stale() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "x"));
    stage(&k, &mut set, &s, &append(JOURNAL, "y"));
    fs::remove_file(t.vault.root().join(JOURNAL)).unwrap();
    assert_eq!(stale(k.apply_changes(&set, "Ada", NOW).unwrap()), [JOURNAL]);
    assert!(!t.vault.read(WELCOME).unwrap().text.contains("\nx\n"));
}

#[test]
fn applying_is_the_persons_approval_and_counts_against_no_limit() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    for n in 0..30 {
        stage(&k, &mut set, &s, &create(&format!("Many {n}"), "x"));
    }
    let (_, paths) = applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert_eq!(paths.len(), 30);
    // The session's own tally is untouched: its next direct write still runs.
    let next = k.agent_run(&s, &append(WELCOME, "after"), NOW).unwrap();
    assert!(matches!(next, kasten_core::Outcome::Done { .. }));
    assert!(t.vault.exists("library/many-29.md"));
}
