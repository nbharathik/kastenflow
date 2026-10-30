//! Agent modes: review everything, balanced and autonomous, per vault and per
//! project; what each does to ordinary writes, soft limits, the ops that always
//! wait and the refusals; changing the mode (a person only); checkpoints.

use crate::common;

use std::collections::BTreeMap;
use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::{Actor, History};
use kasten_core::policy::{AUTONOMOUS_APPROVER, AgentPolicy, SESSION_LABEL};
use kasten_core::{Config, Instant, Kasten, Outcome};

const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";
const WELCOME: &str = "library/welcome-to-kasten.md";
const PLAN: &str = "inbox/plan.md";

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let s = Session::start("claude-code", NOW);
    (t, k, s)
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    set_modes(k, mode, &[]);
}

fn set_modes(k: &Kasten, mode: AgentMode, projects: &[(&str, AgentMode)]) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        projects: projects
            .iter()
            .map(|(slug, mode)| {
                (
                    (*slug).to_owned(),
                    ProjectAgents {
                        mode: Some(*mode),
                        ..ProjectAgents::default()
                    },
                )
            })
            .collect::<BTreeMap<_, _>>(),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

fn append(path: &str, text: &str) -> AgentOp {
    AgentOp::Append {
        path: path.into(),
        markdown: text.into(),
        heading: None,
    }
}

/// A full rewrite of a note, against the body it has now.
fn rewrite(k: &Kasten, path: &str, body: &str) -> AgentOp {
    let current = k.read(path).unwrap();
    AgentOp::Edit {
        path: path.into(),
        body: body.into(),
        base: kasten_core::frontmatter::split(&current.text)
            .body
            .to_owned(),
        reason: Some("test".into()),
    }
}

/// A page with a long section, so that replacing it takes out more than 40%.
fn write_plan(t: &common::TempVault, k: &Kasten) {
    let long: String = (0..30)
        .map(|n| format!("Line {n} of the plan with some words.\n"))
        .collect();
    let text =
        format!("---\ntitle: Plan\ntype: page\n---\n## Keep\n\nShort.\n\n## Details\n\n{long}");
    fs::write(t.vault.root().join(PLAN), text).unwrap();
    k.reindex().unwrap();
}

fn wipe_details() -> AgentOp {
    AgentOp::ReplaceSection {
        path: PLAN.into(),
        heading: "Details".into(),
        markdown: "Gone.".into(),
    }
}

fn standup() -> AgentOp {
    AgentOp::Template {
        name: "Daily standup".into(),
        text: "---\ntitle: \"{{title}}\"\ntype: page\n---\n## Today\n".into(),
        base: None,
        reason: None,
    }
}

fn word(outcome: &Outcome) -> &'static str {
    match outcome {
        Outcome::Done { .. } => "done",
        Outcome::PendingReview { .. } => "pending",
        Outcome::Staged { .. } => "staged",
    }
}

/// What each kind of op comes to in one vault in `mode` (each op as a session
/// of its own): its outcome, or "refused".
fn run_all(mode: AgentMode, kinds: &[&str]) -> Vec<&'static str> {
    let (t, k, _) = open();
    write_plan(&t, &k);
    set_mode(&k, mode);
    kinds
        .iter()
        .enumerate()
        .map(|(n, which)| {
            let s = Session::start(
                "claude-code",
                Instant {
                    millis: NOW.millis + n as u64,
                },
            );
            run(&t, &k, &s, which)
        })
        .collect()
}

fn run(t: &common::TempVault, k: &Kasten, s: &Session, which: &str) -> &'static str {
    let op = match which {
        "ordinary" => append(WELCOME, "Added by an agent."),
        "soft" => wipe_details(),
        "always" => rewrite(k, WELCOME, "Rewritten.\n"),
        "schema" => AgentOp::TagSchema {
            tag: "trip".into(),
            schema: serde_json::json!({"properties": [{"key": "stage", "type": "select", "options": ["Idea"]}]}),
        },
        "template" => standup(),
        "locked" => {
            let file = t.vault.root().join(DRAFT);
            let text = fs::read_to_string(&file).unwrap().replacen(
                "tags: [paper]",
                "tags: [paper]\nlocked: true",
                1,
            );
            fs::write(&file, text).unwrap();
            k.reindex().unwrap();
            append(DRAFT, "x")
        }
        "private" => append(".kasten/config.yaml", "agents:\n  mode: autonomous\n"),
        "templates" => append("templates/page.md", "x"),
        "huge" => append(WELCOME, &"x".repeat(210 * 1024)),
        other => panic!("{other}"),
    };
    match k.agent_run(s, &op, NOW) {
        Ok(outcome) => word(&outcome),
        Err(_) => "refused",
    }
}

#[test]
fn the_modes_against_the_kinds_of_op() {
    // (op, review, balanced, autonomous); "locked" goes last, it locks a note.
    let rows = [
        ("ordinary", "pending", "done", "done"),
        ("soft", "pending", "pending", "done"),
        ("always", "pending", "pending", "done"),
        ("schema", "pending", "pending", "done"),
        ("template", "pending", "pending", "done"),
        ("private", "refused", "refused", "refused"),
        ("templates", "refused", "refused", "refused"),
        ("huge", "refused", "refused", "refused"),
        ("locked", "refused", "refused", "refused"),
    ];
    let kinds: Vec<&str> = rows.iter().map(|row| row.0).collect();
    let review = run_all(AgentMode::Review, &kinds);
    let balanced = run_all(AgentMode::Balanced, &kinds);
    let autonomous = run_all(AgentMode::Autonomous, &kinds);
    for (n, (which, want_review, want_balanced, want_autonomous)) in rows.iter().enumerate() {
        assert_eq!(review[n], *want_review, "review: {which}");
        assert_eq!(balanced[n], *want_balanced, "balanced: {which}");
        assert_eq!(autonomous[n], *want_autonomous, "autonomous: {which}");
    }
}

#[test]
fn a_vault_with_no_agents_key_is_balanced() {
    let (t, k, s) = open();
    write_plan(&t, &k);
    assert_eq!(k.agent_mode(None, NOW), AgentMode::Balanced);
    let done = k.agent_run(&s, &append(WELCOME, "x"), NOW).unwrap();
    assert_eq!(word(&done), "done");
    let waiting = k.agent_run(&s, &wipe_details(), NOW).unwrap();
    assert_eq!(word(&waiting), "pending");
    let last = &k.log(Some(WELCOME), 1).unwrap()[0];
    assert_eq!(last.mode, None, "balanced commits carry no mode");
}

#[test]
fn review_holds_a_plain_append_and_writes_nothing() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let before = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    let outcome = k.agent_run(&s, &append(WELCOME, "Plain."), NOW).unwrap();
    let Outcome::PendingReview { reason, .. } = &outcome else {
        panic!("{outcome:?}")
    };
    assert!(reason.contains("every change"), "{reason}");
    assert_eq!(
        fs::read_to_string(t.vault.root().join(WELCOME)).unwrap(),
        before
    );
    assert_eq!(k.proposals().unwrap().len(), 1);
    // The person can still accept it.
    let Outcome::PendingReview { proposal, .. } = outcome else {
        unreachable!()
    };
    k.accept_proposal(&proposal, "Ada", NOW).unwrap();
    assert!(
        fs::read_to_string(t.vault.root().join(WELCOME))
            .unwrap()
            .contains("Plain.")
    );
    // Trust does not turn Review into anything else.
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    let again = k.agent_run(&s, &append(WELCOME, "More."), NOW).unwrap();
    assert_eq!(word(&again), "pending");
}

#[test]
fn review_stages_a_plain_append_in_a_chat() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let before = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    let mut set = k.begin_changes(&s, NOW);
    let outcome = k
        .stage(&mut set, &s, &append(WELCOME, "Plain."), NOW)
        .unwrap();
    assert_eq!(word(&outcome), "staged");
    assert_eq!(
        fs::read_to_string(t.vault.root().join(WELCOME)).unwrap(),
        before
    );
}

#[test]
fn where_a_chat_writes_follows_the_mode() {
    let (_t, k, _s) = open();
    let table = [
        (AgentMode::Review, false, true),
        (AgentMode::Review, true, true),
        (AgentMode::Balanced, false, true),
        (AgentMode::Balanced, true, false),
        (AgentMode::Autonomous, false, false),
        (AgentMode::Autonomous, true, false),
    ];
    for (mode, apply_directly, staged) in table {
        set_mode(&k, mode);
        assert_eq!(
            k.chat_writes_staged(None, apply_directly, NOW),
            staged,
            "{mode:?} with apply directly {apply_directly}"
        );
    }
}

#[test]
fn trust_lifts_the_soft_limits_in_balanced_but_not_the_ops_that_always_wait() {
    let (t, k, s) = open();
    write_plan(&t, &k);
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    assert_eq!(
        word(&k.agent_run(&s, &wipe_details(), NOW).unwrap()),
        "done"
    );
    let rewritten = k
        .agent_run(&s, &rewrite(&k, WELCOME, "New.\n"), NOW)
        .unwrap();
    assert_eq!(word(&rewritten), "pending");
}

#[test]
fn autonomous_commits_say_so_and_an_auto_accepted_rewrite_says_who_approved_it() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    let done = k.agent_run(&s, &append(WELCOME, "Plain."), NOW).unwrap();
    assert_eq!(word(&done), "done");
    let last = &k.log(Some(WELCOME), 1).unwrap()[0];
    assert_eq!(last.author, "agent:claude-code");
    assert_eq!(last.mode.as_deref(), Some("autonomous"));
    assert_eq!(last.approved_by, None);

    let op = rewrite(&k, WELCOME, "Rewritten by an agent.\n");
    let done = k.agent_run(&s, &op, NOW).unwrap();
    assert_eq!(word(&done), "done", "{done:?}");
    assert!(k.proposals().unwrap().is_empty(), "nothing waits");
    assert!(
        fs::read_to_string(t.vault.root().join(WELCOME))
            .unwrap()
            .contains("Rewritten by an agent.")
    );
    let last = &k.log(Some(WELCOME), 1).unwrap()[0];
    assert_eq!(last.op.as_deref(), Some("propose_edit"));
    assert_eq!(last.mode.as_deref(), Some("autonomous"));
    assert_eq!(last.approved_by.as_deref(), Some(AUTONOMOUS_APPROVER));
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert!(last.message.contains("Approved-by: autonomous-mode"));
    assert!(last.message.contains("Kasten-Mode: autonomous"));

    // A person's own commit in the same vault carries no mode.
    let note = k.read(WELCOME).unwrap();
    let body = kasten_core::frontmatter::split(&note.text).body.to_owned();
    k.save_body(
        &Actor::Human,
        WELCOME,
        &format!("{body}\nMine.\n"),
        &note.hash,
        NOW,
    )
    .unwrap();
    k.commit_edits().unwrap();
    assert_eq!(k.log(Some(WELCOME), 1).unwrap()[0].mode, None);
}

#[test]
fn autonomous_lifts_the_soft_limits_and_keeps_going_past_them() {
    let (t, k, s) = open();
    write_plan(&t, &k);
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 2;
    config.guardrails.max_trash_per_session = 1;
    k.set_config(config).unwrap();
    set_mode(&k, AgentMode::Autonomous);
    assert_eq!(
        word(&k.agent_run(&s, &wipe_details(), NOW).unwrap()),
        "done"
    );
    for n in 0..6 {
        let op = AgentOp::Capture {
            markdown: format!("Card {n}"),
            tags: vec![],
        };
        assert_eq!(
            word(&k.agent_run(&s, &op, NOW).unwrap()),
            "done",
            "card {n}"
        );
    }
    for n in 0..3 {
        let op = AgentOp::Trash {
            path: format!("inbox/card-{n}.md"),
            reason: None,
        };
        assert_eq!(
            word(&k.agent_run(&s, &op, NOW).unwrap()),
            "done",
            "trash {n}"
        );
    }
    // The same session goes back to the limits when the mode does.
    set_mode(&k, AgentMode::Balanced);
    let more = AgentOp::Capture {
        markdown: "One more".into(),
        tags: vec![],
    };
    assert_eq!(word(&k.agent_run(&s, &more, NOW).unwrap()), "pending");
}

#[test]
fn a_project_has_its_own_mode_over_the_vaults() {
    let (_t, k, s) = open();
    // Balanced vault, one project on autonomous.
    set_modes(
        &k,
        AgentMode::Balanced,
        &[("note-taking-study", AgentMode::Autonomous)],
    );
    assert_eq!(
        k.agent_mode(Some("note-taking-study"), NOW),
        AgentMode::Autonomous
    );
    assert_eq!(
        k.agent_mode(Some("photo-organiser"), NOW),
        AgentMode::Balanced
    );
    let inside = rewrite(&k, DRAFT, "Inside.\n");
    assert_eq!(word(&k.agent_run(&s, &inside, NOW).unwrap()), "done");
    let outside = rewrite(&k, WELCOME, "Outside.\n");
    assert_eq!(word(&k.agent_run(&s, &outside, NOW).unwrap()), "pending");
    // A new note is judged by the project it is made in.
    let made = AgentOp::CreateNote {
        note_type: "page".into(),
        title: "In the project".into(),
        body: String::new(),
        project: Some("note-taking-study".into()),
        tags: vec![],
        props: Default::default(),
        parent: None,
        template: None,
    };
    assert_eq!(word(&k.agent_run(&s, &made, NOW).unwrap()), "done");

    // Autonomous vault, one project held on review.
    set_modes(
        &k,
        AgentMode::Autonomous,
        &[("note-taking-study", AgentMode::Review)],
    );
    let held = append(DRAFT, "Held.");
    assert_eq!(word(&k.agent_run(&s, &held, NOW).unwrap()), "pending");
    let free = append(WELCOME, "Free.");
    assert_eq!(word(&k.agent_run(&s, &free, NOW).unwrap()), "done");
    // Moving a note out of a project held on review is no way round it: the
    // stricter of where it is and where it goes decides.
    let moved = AgentOp::Move {
        path: DRAFT.into(),
        project: None,
    };
    assert_eq!(word(&k.agent_run(&s, &moved, NOW).unwrap()), "pending");
}

#[test]
fn a_time_boxed_autonomous_mode_falls_back_to_balanced() {
    let (_t, k, s) = open();
    let hour = Instant {
        millis: NOW.millis + 3_600_000,
    };
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Autonomous),
        until: Some(hour.rfc3339()),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
    assert_eq!(k.agent_mode(None, NOW), AgentMode::Autonomous);
    let early = rewrite(&k, WELCOME, "Early.\n");
    assert_eq!(word(&k.agent_run(&s, &early, NOW).unwrap()), "done");
    let after = Instant {
        millis: hour.millis + 1,
    };
    assert_eq!(k.agent_mode(None, after), AgentMode::Balanced);
    let late = rewrite(&k, WELCOME, "Late.\n");
    assert_eq!(word(&k.agent_run(&s, &late, after).unwrap()), "pending");
    // Plain writes carry on as balanced writes.
    let plain = append(DRAFT, "Still fine.");
    assert_eq!(word(&k.agent_run(&s, &plain, after).unwrap()), "done");
    assert_eq!(k.log(Some(DRAFT), 1).unwrap()[0].mode, None);
}

#[test]
fn autonomous_needs_history_to_be_undone() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let s = Session::start("claude-code", NOW);
    set_mode(&k, AgentMode::Autonomous);
    assert!(!k.has_history());
    assert_eq!(k.agent_mode(None, NOW), AgentMode::Balanced);
    let op = rewrite(&k, WELCOME, "No history.\n");
    assert_eq!(word(&k.agent_run(&s, &op, NOW).unwrap()), "pending");
}

#[test]
fn only_a_person_changes_the_mode() {
    let (t, k, s) = open();
    let commits = k.log(None, 500).unwrap().len();
    let policy = AgentPolicy {
        mode: AgentMode::Autonomous,
        until: Some(
            Instant {
                millis: NOW.millis + 60_000,
            }
            .rfc3339(),
        ),
        projects: BTreeMap::from([("thesis".to_owned(), AgentMode::Review)]),
    };
    k.set_agent_policy(&Actor::Human, policy, NOW).unwrap();
    assert_eq!(k.agent_mode(None, NOW), AgentMode::Autonomous);
    assert_eq!(k.agent_mode(Some("thesis"), NOW), AgentMode::Review);
    let on_disk = Config::load(t.vault.root()).unwrap();
    let agents = on_disk.agents.unwrap();
    assert_eq!(agents.mode, Some(AgentMode::Autonomous));
    assert_eq!(agents.projects["thesis"].mode, Some(AgentMode::Review));
    assert!(agents.until.is_some());
    let log = k.log(None, 500).unwrap();
    assert_eq!(log.len(), commits + 1, "one commit");
    assert!(!log[0].agent && log[0].mode.is_none(), "{:?}", log[0]);

    // An agent, whatever its session, is refused and nothing changes.
    let before = fs::read_to_string(t.vault.root().join(".kasten/config.yaml")).unwrap();
    let escalate = AgentPolicy {
        mode: AgentMode::Autonomous,
        ..AgentPolicy::default()
    };
    for actor in [
        s.actor(),
        Actor::Approved {
            client: s.client.clone(),
            session: s.id.clone(),
            by: "someone".into(),
        },
    ] {
        let err = k
            .set_agent_policy(&actor, escalate.clone(), NOW)
            .unwrap_err();
        assert!(err.to_string().contains("person"), "{err}");
    }
    assert_eq!(
        fs::read_to_string(t.vault.root().join(".kasten/config.yaml")).unwrap(),
        before
    );
    assert_eq!(k.log(None, 500).unwrap().len(), commits + 1);

    // Back down, and a time nobody can read is turned down.
    let back = AgentPolicy::default();
    k.set_agent_policy(&Actor::Human, back, NOW).unwrap();
    assert_eq!(k.agent_mode(None, NOW), AgentMode::Balanced);
    let soon = AgentPolicy {
        until: Some("soon".into()),
        ..AgentPolicy::default()
    };
    assert!(k.set_agent_policy(&Actor::Human, soon, NOW).is_err());
}

#[test]
fn setting_the_mode_keeps_what_the_file_has_that_this_version_does_not_know() {
    let (t, _k, _s) = open();
    let path = t.vault.root().join(".kasten/config.yaml");
    let text = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        format!("{text}\nagents:\n  mode: balanced\n  later: kept\n  projects:\n    thesis:\n      mode: review\n      note: also kept\n"),
    )
    .unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    let mut policy = AgentPolicy {
        mode: AgentMode::Review,
        ..AgentPolicy::default()
    };
    policy
        .projects
        .insert("thesis".into(), AgentMode::Autonomous);
    k.set_agent_policy(&Actor::Human, policy, NOW).unwrap();
    let written = fs::read_to_string(&path).unwrap();
    assert!(
        written.contains("later") && written.contains("also kept"),
        "{written}"
    );
}

#[test]
fn an_autonomous_session_gets_one_checkpoint_before_its_first_write() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    assert!(k.list_checkpoints().unwrap().is_empty());
    k.agent_run(&s, &append(WELCOME, "One."), NOW).unwrap();
    k.agent_run(&s, &append(WELCOME, "Two."), NOW).unwrap();
    let marks = k.list_checkpoints().unwrap();
    assert_eq!(marks.len(), 1);
    let mark = &marks[0];
    assert_eq!(mark.session, s.id);
    assert_eq!(mark.label, SESSION_LABEL);
    assert_eq!(mark.time, NOW.millis);
    // It is the commit the session started from: the one before its first.
    let history = History::open(t.vault.root()).unwrap().unwrap();
    let log = history.log(None, 10).unwrap();
    // The log is newest first, so the session's first commit is its last entry.
    let first = log
        .iter()
        .rposition(|c| c.session.as_deref() == Some(s.id.as_str()))
        .expect("the session wrote");
    assert_eq!(mark.head, log[first + 1].id);
    // The list is a cache file, kept apart from the notes.
    assert!(
        t.vault
            .root()
            .join(".kasten/cache/checkpoints.json")
            .is_file()
    );

    // Another session has its own; a balanced write has none.
    let other = Session::start(
        "other",
        Instant {
            millis: NOW.millis + 1,
        },
    );
    k.agent_run(&other, &append(WELCOME, "Three."), NOW)
        .unwrap();
    assert_eq!(k.list_checkpoints().unwrap().len(), 2);
    assert_eq!(
        k.list_checkpoints().unwrap()[0].session,
        other.id,
        "newest first"
    );
    set_mode(&k, AgentMode::Balanced);
    let third = Session::start(
        "third",
        Instant {
            millis: NOW.millis + 2,
        },
    );
    k.agent_run(&third, &append(WELCOME, "Four."), NOW).unwrap();
    assert_eq!(k.list_checkpoints().unwrap().len(), 2);
}

#[test]
fn a_batch_over_twenty_ops_gets_a_checkpoint() {
    let (_t, k, s) = open();
    assert!(k.maybe_checkpoint(&s, false, 20, NOW).unwrap().is_none());
    assert!(k.maybe_checkpoint(&s, false, 1, NOW).unwrap().is_none());
    let mark = k.maybe_checkpoint(&s, false, 21, NOW).unwrap().unwrap();
    assert!(mark.label.contains("21"), "{}", mark.label);
    assert_eq!(mark.session, s.id);
    // An autonomous session's first write still gets its own, once.
    let first = k.maybe_checkpoint(&s, true, 1, NOW).unwrap().unwrap();
    assert_eq!(first.label, SESSION_LABEL);
    assert!(k.maybe_checkpoint(&s, true, 1, NOW).unwrap().is_none());
    assert_eq!(k.list_checkpoints().unwrap().len(), 2);
}

#[test]
fn restoring_a_checkpoint_adds_commits_and_leaves_history_alone() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    let history = History::open(t.vault.root()).unwrap().unwrap();
    let original = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    k.agent_run(&s, &append(WELCOME, "Agent line."), NOW)
        .unwrap();
    let made = k
        .agent_run(
            &s,
            &AgentOp::Capture {
                markdown: "Autonomous idea".into(),
                tags: vec![],
            },
            NOW,
        )
        .unwrap();
    let Outcome::Done { result } = made else {
        panic!()
    };
    let made_path = result["path"].as_str().unwrap().to_owned();
    assert!(t.vault.root().join(&made_path).is_file());
    let mark = k.list_checkpoints().unwrap().remove(0);
    let commits_before: Vec<String> = history
        .log(None, 500)
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();

    let restored = k.restore_to_checkpoint(&mark.id, NOW).unwrap();
    assert!(restored.commit.is_some());
    assert_eq!(
        fs::read_to_string(t.vault.root().join(WELCOME)).unwrap(),
        original
    );
    assert!(
        !t.vault.root().join(&made_path).exists(),
        "a note made since goes to the trash"
    );
    assert!(restored.trashed.iter().any(|p| p.ends_with(&made_path)));
    // History only grew: every commit it had is still in it, in the same order.
    let commits_after: Vec<String> = history
        .log(None, 500)
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();
    assert!(commits_after.len() > commits_before.len());
    assert_eq!(
        &commits_after[commits_after.len() - commits_before.len()..],
        commits_before.as_slice()
    );
    assert!(commits_after.contains(&mark.head));
    // The checkpoint stays; an unknown one is an error.
    assert_eq!(k.list_checkpoints().unwrap().len(), 1);
    assert!(k.restore_to_checkpoint("nope", NOW).is_err());
}

#[test]
fn the_destruction_drill_in_autonomous_mode_deletes_nothing_for_good() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    k.commit_external().unwrap();
    let history = History::open(t.vault.root()).unwrap().unwrap();
    let before = history.tree_id("HEAD").unwrap();
    let head_before = history.head().unwrap();
    let originals: Vec<String> = history.files_at("HEAD").unwrap();
    let notes: Vec<String> = k.list().unwrap().into_iter().map(|n| n.path).collect();
    assert!(notes.len() >= 8, "{notes:?}");

    // Empty every note: rewrites are let through, templates and locked notes are still refused.
    let mut emptied = 0;
    for path in &notes {
        let Ok(current) = k.read(path) else { continue };
        let op = AgentOp::Edit {
            path: path.clone(),
            body: String::new(),
            base: kasten_core::frontmatter::split(&current.text)
                .body
                .to_owned(),
            reason: Some("drill".into()),
        };
        if let Ok(outcome) = k.agent_run(&s, &op, NOW) {
            assert_eq!(word(&outcome), "done", "{path}");
            emptied += 1;
        }
    }
    assert!(emptied > 5, "{emptied}");
    assert!(k.proposals().unwrap().is_empty());
    // Trash everything: the soft limit on trashes is lifted.
    let mut trashed = 0;
    for path in &notes {
        let op = AgentOp::Trash {
            path: path.clone(),
            reason: Some("drill".into()),
        };
        if let Ok(outcome) = k.agent_run(&s, &op, NOW) {
            assert_eq!(word(&outcome), "done", "{path}");
            trashed += 1;
        }
    }
    assert!(trashed > 5, "{trashed}");
    assert!(
        k.agent_run(
            &s,
            &AgentOp::Trash {
                path: "templates/page.md".into(),
                reason: None
            },
            NOW
        )
        .is_err()
    );
    // Reach for private folders, and rename in a storm.
    for attempt in [".git/config", "../outside.md", ".kasten/config.yaml"] {
        assert!(
            k.agent_run(&s, &append(attempt, "x"), NOW).is_err(),
            "{attempt}"
        );
    }
    let captured = k
        .agent_run(
            &s,
            &AgentOp::Capture {
                markdown: "Storm target".into(),
                tags: vec![],
            },
            NOW,
        )
        .unwrap();
    let Outcome::Done { result } = captured else {
        panic!()
    };
    let mut current = result["path"].as_str().unwrap().to_owned();
    for n in 0..30 {
        let op = AgentOp::Rename {
            path: current.clone(),
            title: format!("Storm {n}"),
        };
        match k.agent_run(&s, &op, NOW).unwrap() {
            Outcome::Done { result } => {
                current = result["note"]["path"].as_str().unwrap().to_owned();
            }
            other => panic!("renames run in autonomous mode: {other:?}"),
        }
    }

    // Nothing is gone for good: every file is where it was or in the trash.
    let in_trash = walk_names(&t.vault.root().join(".trash"));
    for path in &originals {
        let kept = t.vault.root().join(path).exists()
            || in_trash.iter().any(|p| p.ends_with(path.as_str()));
        assert!(kept, "{path} was lost");
    }

    // And the whole session undoes to the exact tree, by new commits.
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(history.tree_id("HEAD").unwrap(), before);
    assert_ne!(history.head().unwrap(), head_before);
    assert!(
        history
            .log(None, 5000)
            .unwrap()
            .iter()
            .any(|c| c.id == head_before)
    );
}

fn walk_names(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(walk_names(&path));
        } else {
            out.push(path.to_string_lossy().replace('\\', "/"));
        }
    }
    out
}
