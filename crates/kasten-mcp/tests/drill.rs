//! The destruction drill: a scripted MCP client tries
//! to trash everything, empty notes, reach `.git`, rename in storms and fire
//! 1,000 rapid edits. Guardrails must trigger, nothing may be lost, and
//! undoing the session must restore the exact prior tree.

mod common;

use std::collections::BTreeMap;
use std::fs;

use common::{Client, vault};
use kasten_core::config_keys::AgentMode;
use kasten_core::history::{Actor, History};
use kasten_core::policy::AgentPolicy;
use kasten_core::{Instant, Kasten};
use serde_json::{Value, json};

#[derive(Default, Debug)]
struct Counts {
    done: usize,
    pending: usize,
    refused: usize,
}

impl Counts {
    fn add(&mut self, outcome: &Result<Value, String>) {
        match outcome {
            Ok(v) if v["status"] == json!("done") => self.done += 1,
            Ok(v) if v["status"] == json!("pending_review") => self.pending += 1,
            Ok(v) => panic!("unexpected result {v}"),
            Err(_) => self.refused += 1,
        }
    }
}

#[test]
fn the_destruction_drill() {
    let v = vault();
    let history = History::open(&v.0).unwrap().unwrap();
    let before = history.tree_id("HEAD").unwrap();
    let head_before = history.head().unwrap();
    let originals: BTreeMap<String, Vec<u8>> = history
        .files_at("HEAD")
        .unwrap()
        .into_iter()
        .map(|p| {
            let bytes = fs::read(v.0.join(&p)).unwrap();
            (p, bytes)
        })
        .collect();

    let mut c = Client::start(&v.0, "drill");
    let listed = c.call("list_notes", json!({"limit": 500})).unwrap();
    let notes: Vec<String> = listed["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["path"].as_str().unwrap().to_owned())
        .collect();
    assert!(notes.len() >= 8, "{notes:?}");

    // 1. Trash everything.
    let mut trash = Counts::default();
    for note in &notes {
        trash.add(&c.call("trash_note", json!({"note": note, "reason": "drill"})));
    }
    assert!(trash.done <= 5, "{trash:?}");
    assert!(trash.pending > 0, "trash must trigger review: {trash:?}");
    let template = c.call("trash_note", json!({"note": "templates/page.md"}));
    assert!(template.is_err(), "templates are read-only: {template:?}");

    // 2. Empty every note that is left.
    let mut empty = Counts::default();
    for note in &notes {
        empty.add(&c.call(
            "propose_edit",
            json!({"note": note, "new_body": "", "reason": "drill"}),
        ));
    }
    assert!(empty.done == 0 && empty.pending > 0, "{empty:?}");

    // 3. Reach for .git and other private folders.
    for attempt in [
        c.call(
            "append",
            json!({"note": ".git/config", "markdown": "[core]\nbare = true"}),
        ),
        c.call("append", json!({"note": "../outside.md", "markdown": "x"})),
        c.call(
            "move_note",
            json!({"note": "Zettelkasten method", "project": "../.git"}),
        ),
        c.call("read_note", json!({"note": ".kasten/config.yaml"})),
    ] {
        assert!(
            attempt.is_err() || attempt.as_ref().unwrap()["status"] == json!("pending_review"),
            "{attempt:?}"
        );
    }

    // 4. A storm of renames.
    let captured = c
        .call("capture", json!({"markdown": "Storm target"}))
        .unwrap();
    let mut storm = Counts::default();
    let mut current = captured["result"]["path"].as_str().map(str::to_owned);
    for n in 0..40 {
        let Some(path) = current.clone() else { break };
        let outcome = c.call(
            "rename_note",
            json!({"note": path, "title": format!("Storm {n}")}),
        );
        if let Ok(v) = &outcome
            && v["status"] == json!("done")
        {
            current = v["result"]["note"]["path"].as_str().map(str::to_owned);
        }
        storm.add(&outcome);
    }
    assert!(storm.pending > 0, "renames must trigger review: {storm:?}");

    // 5. A thousand rapid edits to a note the session already changed.
    let target = current.unwrap();
    let mut rapid = Counts::default();
    for n in 0..1000 {
        rapid.add(&c.call(
            "append",
            json!({"note": target, "markdown": format!("Edit {n}")}),
        ));
    }
    assert_eq!(rapid.done, 1000, "{rapid:?}");
    let session = c.call("capture", json!({"markdown": "Last one"})).unwrap()["session"]
        .as_str()
        .unwrap()
        .to_owned();
    drop(c);

    // Nothing lost: every original file is where it was, or in the trash, byte for byte.
    let trashed: Vec<(String, Vec<u8>)> = walk(&v.0.join(".trash"));
    for (path, bytes) in &originals {
        let here = fs::read(v.0.join(path)).ok();
        let kept = here.as_ref() == Some(bytes)
            || trashed
                .iter()
                .any(|(p, b)| p.ends_with(path.as_str()) && b == bytes);
        assert!(kept, "{path} was lost");
    }
    let k = Kasten::open(&v.0).unwrap();
    let report = k.verify().unwrap();
    assert!(
        report.problems.iter().all(|p| p.kind != "git"),
        "{:?}",
        report.problems
    );
    assert!(!k.proposals().unwrap().is_empty());

    // Undo the whole session: back to the exact tree.
    let undone = k.undo_session(&session, Instant::now()).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(
        history.tree_id("HEAD").unwrap(),
        before,
        "undo must restore the exact tree"
    );
    assert_ne!(
        history.head().unwrap(),
        head_before,
        "undo adds commits, it never resets"
    );
    assert!(k.proposals().unwrap().is_empty());
}

/// The drill through the batch tool: a batch cannot trash, cannot reach a
/// private folder, and one bad change refuses all of it; big batches of honest
/// edits are one commit each; and one undo gives back the exact tree.
#[test]
fn the_destruction_drill_with_batches() {
    let v = vault();
    let history = History::open(&v.0).unwrap().unwrap();
    let before = history.tree_id("HEAD").unwrap();
    let originals: Vec<String> = history.files_at("HEAD").unwrap();

    let mut c = Client::start(&v.0, "drill");
    let listed = c.call("list_notes", json!({"limit": 500})).unwrap();
    let notes: Vec<String> = listed["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["path"].as_str().unwrap().to_owned())
        .collect();
    assert!(notes.len() >= 8, "{notes:?}");
    let item = |tool: &str, args: Value| json!({"tool": tool, "args": args});

    // 1. A batch that trashes everything is not a batch.
    let trash: Vec<Value> = notes
        .iter()
        .map(|n| item("trash_note", json!({"note": n})))
        .collect();
    assert!(c.call("batch", json!({"ops": trash})).is_err());

    // 2. One reach for a private folder refuses all of it, and nothing is written.
    let reach = c.call(
        "batch",
        json!({"ops": [
            item("append", json!({"note": notes[0], "markdown": "Fine."})),
            item("append", json!({"note": ".git/config", "markdown": "[core]\nbare = true"})),
            item("move_note", json!({"note": notes[1], "project": "../.git"})),
        ]}),
    );
    assert!(reach.is_err(), "{reach:?}");
    assert_eq!(
        history.tree_id("HEAD").unwrap(),
        before,
        "nothing was written"
    );

    // 3. A storm of renames of one note in one batch either waits for review or fails whole.
    let storm: Vec<Value> = (0..40)
        .map(|n| {
            item(
                "rename_note",
                json!({"note": notes[0], "title": format!("Storm {n}")}),
            )
        })
        .collect();
    let storm = c.call("batch", json!({"ops": storm}));
    assert!(
        storm.is_err() || storm.as_ref().unwrap()["status"] == json!("pending_review"),
        "{storm:?}"
    );

    // 4. Too many changes at once are refused.
    let many: Vec<Value> = (0..101)
        .map(|n| {
            item(
                "append",
                json!({"note": notes[0], "markdown": format!("L{n}")}),
            )
        })
        .collect();
    assert!(c.call("batch", json!({"ops": many})).is_err());

    // 5. Honest batches of a hundred edits each go through, one commit apiece.
    let commits = history.log(None, 10_000).unwrap().len();
    for round in 0..5 {
        let ops: Vec<Value> = (0..100)
            .map(|n| {
                item(
                    "append",
                    json!({"note": notes[n % 3], "markdown": format!("Round {round} line {n}")}),
                )
            })
            .collect();
        let told = c.call("batch", json!({"ops": ops})).unwrap();
        assert_eq!(told["status"], json!("done"), "{told}");
    }
    // (The proposal of step 3, if there was one, is the only other commit of this session.)
    let made = history.log(None, 10_000).unwrap().len() - commits;
    assert_eq!(made, 5, "five batches, five commits");
    let session = c.call("capture", json!({"markdown": "Last one"})).unwrap()["session"]
        .as_str()
        .unwrap()
        .to_owned();
    drop(c);

    for path in &originals {
        assert!(v.0.join(path).exists(), "{path} was lost");
    }
    let k = Kasten::open(&v.0).unwrap();
    assert!(k.verify().unwrap().problems.iter().all(|p| p.kind != "git"));
    let undone = k.undo_session(&session, Instant::now()).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(
        history.tree_id("HEAD").unwrap(),
        before,
        "undo must restore the exact tree"
    );
}

/// The same drill with the vault left on autonomous: nothing waits for review
/// any more, but the refusals hold, nothing is deleted for good, and undoing
/// the session still gives back the exact tree.
#[test]
fn the_destruction_drill_in_autonomous_mode() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let policy = AgentPolicy {
        mode: AgentMode::Autonomous,
        ..AgentPolicy::default()
    };
    k.set_agent_policy(&Actor::Human, policy, Instant::now())
        .unwrap();
    drop(k);
    let history = History::open(&v.0).unwrap().unwrap();
    let before = history.tree_id("HEAD").unwrap();
    let originals: Vec<String> = history.files_at("HEAD").unwrap();

    let mut c = Client::start(&v.0, "drill");
    let listed = c.call("list_notes", json!({"limit": 500})).unwrap();
    let notes: Vec<String> = listed["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["path"].as_str().unwrap().to_owned())
        .collect();
    assert!(notes.len() >= 8, "{notes:?}");

    // Rewrites go straight through, and so does trashing past the soft limit.
    let mut empty = Counts::default();
    for note in &notes {
        empty.add(&c.call(
            "propose_edit",
            json!({"note": note, "new_body": "", "reason": "drill"}),
        ));
    }
    assert!(empty.done > 5 && empty.pending == 0, "{empty:?}");
    let mut trash = Counts::default();
    for note in &notes {
        trash.add(&c.call("trash_note", json!({"note": note, "reason": "drill"})));
    }
    assert!(trash.done > 5 && trash.pending == 0, "{trash:?}");
    let template = c.call("trash_note", json!({"note": "templates/page.md"}));
    assert!(template.is_err(), "templates are read-only: {template:?}");

    // The refusals hold: private folders, and the mode itself.
    for attempt in [
        c.call(
            "append",
            json!({"note": ".git/config", "markdown": "[core]\nbare = true"}),
        ),
        c.call("append", json!({"note": "../outside.md", "markdown": "x"})),
        c.call(
            "append",
            json!({"note": ".kasten/config.yaml", "markdown": "agents:\n  mode: review\n"}),
        ),
    ] {
        assert!(attempt.is_err(), "{attempt:?}");
    }

    // A storm of renames all runs.
    let captured = c
        .call("capture", json!({"markdown": "Storm target"}))
        .unwrap();
    let mut storm = Counts::default();
    let mut current = captured["result"]["path"].as_str().map(str::to_owned);
    for n in 0..40 {
        let Some(path) = current.clone() else { break };
        let outcome = c.call(
            "rename_note",
            json!({"note": path, "title": format!("Storm {n}")}),
        );
        if let Ok(v) = &outcome
            && v["status"] == json!("done")
        {
            current = v["result"]["note"]["path"].as_str().map(str::to_owned);
        }
        storm.add(&outcome);
    }
    assert!(storm.done == 40 && storm.pending == 0, "{storm:?}");
    let session = c.call("capture", json!({"markdown": "Last one"})).unwrap()["session"]
        .as_str()
        .unwrap()
        .to_owned();
    drop(c);

    // Nothing is gone for good: every file is where it was or in the trash.
    let trashed: Vec<(String, Vec<u8>)> = walk(&v.0.join(".trash"));
    for path in &originals {
        let kept =
            v.0.join(path).exists() || trashed.iter().any(|(p, _)| p.ends_with(path.as_str()));
        assert!(kept, "{path} was lost");
    }
    assert!(Kasten::open(&v.0).unwrap().proposals().unwrap().is_empty());

    // The session undoes to the exact tree, by new commits.
    let k = Kasten::open(&v.0).unwrap();
    let undone = k.undo_session(&session, Instant::now()).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(history.tree_id("HEAD").unwrap(), before);
    assert!(
        !k.list_checkpoints().unwrap().is_empty(),
        "a checkpoint came first"
    );
}

fn walk(dir: &std::path::Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(walk(&path));
        } else if let Ok(bytes) = fs::read(&path) {
            out.push((path.to_string_lossy().replace('\\', "/"), bytes));
        }
    }
    out
}
