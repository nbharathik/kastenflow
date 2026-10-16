//! Agent ops through the guardrails: refusals, proposals, review and trust.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, ProposalStatus, Session};
use kasten_core::{Instant, Kasten, Outcome};
use serde_json::json;

const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";
const WELCOME: &str = "library/welcome-to-kasten.md";

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let s = Session::start("claude-code", NOW);
    (t, k, s)
}

fn pending(outcome: &Outcome) -> &str {
    match outcome {
        Outcome::PendingReview { proposal, .. } => proposal,
        other => panic!("expected a proposal, got {other:?}"),
    }
}

fn append(path: &str, text: &str) -> AgentOp {
    AgentOp::Append {
        path: path.into(),
        markdown: text.into(),
        heading: None,
    }
}

#[test]
fn small_edits_run_and_commit_as_the_agent() {
    let (_t, k, s) = open();
    let done = k
        .agent_run(&s, &append(WELCOME, "Added by an agent."), NOW)
        .unwrap();
    assert!(matches!(done, Outcome::Done { .. }));
    let last = &k.log(Some(WELCOME), 1).unwrap()[0];
    assert_eq!(last.author, "agent:claude-code");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert_eq!(last.op.as_deref(), Some("append"));
    let captured = k
        .agent_run(
            &s,
            &AgentOp::Capture {
                markdown: "Idea: bike tour".into(),
                tags: vec!["trip".into()],
            },
            NOW,
        )
        .unwrap();
    let Outcome::Done { result } = captured else {
        panic!()
    };
    assert_eq!(result["path"], json!("inbox/idea-bike-tour.md"));
}

#[test]
fn refuses_locked_notes_templates_and_huge_writes() {
    let (t, k, s) = open();
    let path = t.vault.root().join(DRAFT);
    let text = fs::read_to_string(&path).unwrap().replacen(
        "tags: [paper]",
        "tags: [paper]\nlocked: true",
        1,
    );
    fs::write(&path, text).unwrap();
    k.reindex().unwrap();
    let err = k.agent_run(&s, &append(DRAFT, "x"), NOW).unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    // A locked note linking to a page keeps an agent from renaming that page.
    let err = k
        .agent_run(
            &s,
            &AgentOp::Rename {
                path: "projects/note-taking-study/pages/related-work-notes.md".into(),
                title: "Reading".into(),
            },
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    let err = k
        .agent_run(&s, &append("templates/page.md", "x"), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
    let big = "x".repeat(210 * 1024);
    let err = k.agent_run(&s, &append(WELCOME, &big), NOW).unwrap_err();
    assert!(err.to_string().contains("200 KB"), "{err}");
    // Every field that gets written counts: a title and tags too.
    let titled = AgentOp::CreateNote {
        note_type: "page".into(),
        title: big.clone(),
        body: String::new(),
        project: None,
        tags: vec![],
        props: Default::default(),
        parent: None,
        template: None,
    };
    let err = k.agent_run(&s, &titled, NOW).unwrap_err();
    assert!(err.to_string().contains("200 KB"), "{err}");
    let tagged = AgentOp::Capture {
        markdown: "x".into(),
        tags: vec![big.clone()],
    };
    assert!(
        k.agent_run(&s, &tagged, NOW)
            .unwrap_err()
            .to_string()
            .contains("200 KB")
    );
    // Trust never lifts a refusal.
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    assert!(k.agent_run(&s, &append(DRAFT, "x"), NOW).is_err());
}

#[test]
fn big_removals_wait_for_review_and_can_be_accepted() {
    let (t, k, s) = open();
    let op = AgentOp::ReplaceSection {
        path: DRAFT.into(),
        heading: "1. Introduction".into(),
        markdown: "Short.".into(),
    };
    // A small section: under 40% of the note, so it runs.
    assert!(matches!(
        k.agent_run(&s, &op, NOW).unwrap(),
        Outcome::Done { .. }
    ));
    let long: String = (0..30)
        .map(|n| format!("Line {n} of the plan with some words.\n"))
        .collect();
    let made = k
        .agent_run(
            &s,
            &AgentOp::CreateNote {
                note_type: "page".into(),
                title: "Plan".into(),
                body: format!("## Keep\n\nShort.\n\n## Details\n\n{long}"),
                project: None,
                tags: vec![],
                props: Default::default(),
                parent: None,
                template: None,
            },
            NOW,
        )
        .unwrap();
    let Outcome::Done { result } = made else {
        panic!()
    };
    let plan = result["path"].as_str().unwrap().to_owned();
    let text = fs::read_to_string(t.vault.root().join(&plan)).unwrap();
    let wipe = AgentOp::ReplaceSection {
        path: plan.clone(),
        heading: "Details".into(),
        markdown: "Gone.".into(),
    };
    let outcome = k.agent_run(&s, &wipe, NOW).unwrap();
    let id = pending(&outcome).to_owned();
    let Outcome::PendingReview { reason, .. } = &outcome else {
        unreachable!()
    };
    assert!(
        reason.contains("Removes") && reason.contains("40%"),
        "{reason}"
    );
    // Nothing changed yet; the proposal is a file with a diff.
    assert_eq!(
        fs::read_to_string(t.vault.root().join(&plan)).unwrap(),
        text
    );
    let waiting = k.proposals().unwrap();
    assert_eq!(waiting.len(), 1);
    assert!(
        waiting[0].diff.starts_with(&format!("--- a/{plan}")),
        "{}",
        waiting[0].diff
    );
    assert_eq!(waiting[0].client, "claude-code");
    // Accepting runs it as the agent's change, approved by the person.
    k.accept_proposal(&id, "Ada", NOW).unwrap();
    assert!(
        fs::read_to_string(t.vault.root().join(&plan))
            .unwrap()
            .ends_with("## Details\n\nGone.\n")
    );
    let log = k.log(None, 2).unwrap();
    assert_eq!(log[1].approved_by.as_deref(), Some("Ada"));
    assert_eq!(log[1].session.as_deref(), Some(s.id.as_str()));
    assert!(log[0].summary.starts_with("accept: "), "{}", log[0].summary);
    assert!(k.proposals().unwrap().is_empty());
    let archived = fs::read_to_string(
        t.vault
            .root()
            .join(format!(".kasten/proposals/archive/{id}.json")),
    )
    .unwrap();
    assert!(archived.contains("\"status\": \"accepted\""));
}

#[test]
fn rewrites_and_schemas_always_wait_and_merge_on_accept() {
    let (t, k, s) = open();
    let note = k.read(WELCOME).unwrap();
    let body = kasten_core::frontmatter::split(&note.text).body.to_owned();
    let rewritten = body.replacen("Kasten", "KASTEN", 1);
    let op = AgentOp::Edit {
        path: WELCOME.into(),
        body: rewritten,
        base: body.clone(),
        reason: Some("Shout the name".into()),
    };
    let id = pending(&k.agent_run(&s, &op, NOW).unwrap()).to_owned();
    // A person edits another line meanwhile; accepting keeps both.
    let later = format!("{body}\nA new last line.\n");
    k.save_body(
        &kasten_core::history::Actor::Human,
        WELCOME,
        &later,
        &note.hash,
        NOW,
    )
    .unwrap();
    k.accept_proposal(&id, "Ada", NOW).unwrap();
    let text = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    assert!(
        text.contains("KASTEN") && text.contains("A new last line."),
        "{text}"
    );
    let schema = AgentOp::TagSchema {
        tag: "trip".into(),
        schema: json!({"properties": [{"key": "stage", "type": "select", "options": ["Idea"]}]}),
    };
    let id = pending(&k.agent_run(&s, &schema, NOW).unwrap()).to_owned();
    k.reject_proposal(&id, "Ada", NOW).unwrap();
    assert!(!t.vault.root().join("tags/trip.yaml").exists());
    let archived: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            t.vault
                .root()
                .join(format!(".kasten/proposals/archive/{id}.json")),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(archived["status"], json!("rejected"));
    assert_eq!(archived["decidedBy"], json!("Ada"));
    assert!(
        k.accept_proposal(&id, "Ada", NOW).is_err(),
        "decided proposals stay decided"
    );
    let _ = ProposalStatus::Pending;
}

#[test]
fn many_notes_or_trashes_in_a_session_become_proposals_until_trusted() {
    let (_t, k, s) = open();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 3;
    config.guardrails.max_trash_per_session = 1;
    k.set_config(config).unwrap();
    for n in 0..3 {
        let op = AgentOp::Capture {
            markdown: format!("Card {n}"),
            tags: vec![],
        };
        assert!(
            matches!(k.agent_run(&s, &op, NOW).unwrap(), Outcome::Done { .. }),
            "card {n}"
        );
    }
    let fourth = AgentOp::Capture {
        markdown: "Card 4".into(),
        tags: vec![],
    };
    let outcome = k.agent_run(&s, &fourth, NOW).unwrap();
    let Outcome::PendingReview { reason, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert!(reason.contains("last 10 minutes"), "{reason}");
    // Notes already changed in the window still take edits.
    assert!(matches!(
        k.agent_run(&s, &append("inbox/card-0.md", "more"), NOW)
            .unwrap(),
        Outcome::Done { .. }
    ));
    // Ten minutes later the window has moved on.
    let later = Instant {
        millis: NOW.millis + 11 * 60 * 1000,
    };
    assert!(matches!(
        k.agent_run(&s, &fourth, later).unwrap(),
        Outcome::Done { .. }
    ));
    let trash = |p: &str| AgentOp::Trash {
        path: p.into(),
        reason: Some("tidy".into()),
    };
    assert!(matches!(
        k.agent_run(&s, &trash("inbox/card-1.md"), later).unwrap(),
        Outcome::Done { .. }
    ));
    let outcome = k.agent_run(&s, &trash("inbox/card-2.md"), later).unwrap();
    let Outcome::PendingReview { reason, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert!(reason.contains("trash"), "{reason}");
    // A trusted session skips the soft limits.
    k.trust_session(&s.id, later.millis + 3_600_000).unwrap();
    assert!(matches!(
        k.agent_run(&s, &trash("inbox/card-2.md"), later).unwrap(),
        Outcome::Done { .. }
    ));
}

#[test]
fn ops_sent_together_each_count_against_the_soft_limits() {
    let (t, k, s) = open();
    let mut config = k.config();
    config.guardrails.max_trash_per_session = 2;
    k.set_config(config).unwrap();
    let paths: Vec<String> = (0..6).map(|n| format!("inbox/old-{n}.md")).collect();
    for path in &paths {
        fs::write(t.vault.path_of(path).unwrap(), "---\ntitle: Old\n---\n").unwrap();
    }
    k.reindex().unwrap();

    let start = std::sync::Barrier::new(paths.len());
    let outcomes: Vec<Outcome> = std::thread::scope(|scope| {
        let runs: Vec<_> = paths
            .iter()
            .map(|path| {
                let (k, s, start) = (&k, &s, &start);
                scope.spawn(move || {
                    start.wait();
                    let op = AgentOp::Trash {
                        path: path.clone(),
                        reason: None,
                    };
                    k.agent_run(s, &op, NOW).unwrap()
                })
            })
            .collect();
        runs.into_iter().map(|run| run.join().unwrap()).collect()
    });
    let done = outcomes
        .iter()
        .filter(|o| matches!(o, Outcome::Done { .. }))
        .count();
    assert_eq!(done, 2, "{outcomes:?}");
}
