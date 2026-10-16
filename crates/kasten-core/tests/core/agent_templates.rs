//! Agents and templates: an agent may propose a new template or
//! a change to one, and a person decides; nothing an agent sends is written
//! to templates/ before it is accepted. Pages can start from a template.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::{Kasten, Outcome};
use serde_json::{Map, Value, json};

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let s = Session::start("kasten-chat", NOW);
    (t, k, s)
}

fn pending(outcome: &Outcome) -> String {
    match outcome {
        Outcome::PendingReview { proposal, .. } => proposal.clone(),
        other => panic!("expected a proposal, got {other:?}"),
    }
}

const STANDUP: &str = "---\ntitle: \"{{title}}\"\ntype: page\ntags: [meeting]\n---\n## Yesterday\n\n## Today\n\n## Blockers\n";

#[test]
fn a_new_template_waits_for_review_then_is_written_whole() {
    let (t, k, s) = open();
    let op = AgentOp::Template {
        name: "Daily standup".into(),
        text: STANDUP.into(),
        base: None,
        reason: Some("You asked for a standup template".into()),
    };
    let id = pending(&k.agent_run(&s, &op, NOW).unwrap());
    let file = t.vault.root().join("templates/daily-standup.md");
    assert!(!file.exists(), "nothing is written before review");

    let proposal = k
        .proposals()
        .unwrap()
        .into_iter()
        .find(|p| p.id == id)
        .unwrap();
    assert_eq!(
        proposal.target.as_ref().unwrap().path,
        "templates/daily-standup.md"
    );
    assert_eq!(proposal.after.as_deref(), Some(STANDUP));
    assert!(proposal.before.is_none());

    let accepted = k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(accepted["path"], json!("templates/daily-standup.md"));
    assert_eq!(fs::read_to_string(&file).unwrap(), STANDUP);
    let last = &k.log(Some("templates/daily-standup.md"), 1).unwrap()[0];
    assert_eq!(last.op.as_deref(), Some("template"));
    assert!(
        k.list()
            .unwrap()
            .iter()
            .any(|n| n.path == "templates/daily-standup.md" && n.kind == "template")
    );

    // Asking for the same name again is refused: an agent updates a template instead.
    let again = k.agent_run(&s, &op, NOW).unwrap_err();
    assert!(again.to_string().contains("already"), "{again}");
}

#[test]
fn a_changed_template_merges_with_edits_made_while_it_waited() {
    let (t, k, s) = open();
    let path = t.vault.root().join("templates/meeting.md");
    let base = fs::read_to_string(&path).unwrap();
    let text = format!("{base}\n## Follow-ups\n\n- [ ] Owner: task\n");
    let id = pending(
        &k.agent_run(
            &s,
            &AgentOp::Template {
                name: "meeting".into(),
                text: text.clone(),
                base: Some(base.clone()),
                reason: None,
            },
            NOW,
        )
        .unwrap(),
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        base,
        "unchanged until accepted"
    );

    // Meanwhile a person edits the template's first line.
    let mine = base.replacen("title:", "# A person's note\ntitle:", 1);
    assert_ne!(mine, base);
    fs::write(&path, &mine).unwrap();
    k.accept_proposal(&id, "me", NOW).unwrap();
    let merged = fs::read_to_string(&path).unwrap();
    assert!(merged.contains("# A person's note"), "{merged}");
    assert!(merged.contains("## Follow-ups"), "{merged}");
}

#[test]
fn other_ops_still_never_write_templates() {
    let (_t, k, s) = open();
    let err = k
        .agent_run(
            &s,
            &AgentOp::Append {
                path: "templates/meeting.md".into(),
                markdown: "x".into(),
                heading: None,
            },
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
    let bad = AgentOp::Template {
        name: "  ".into(),
        text: STANDUP.into(),
        base: None,
        reason: None,
    };
    assert!(
        k.agent_run(&s, &bad, NOW).is_err(),
        "a template needs a name"
    );
}

#[test]
fn an_agent_starts_a_page_from_a_template() {
    let (_t, k, s) = open();
    let done = k
        .agent_run(
            &s,
            &AgentOp::CreateNote {
                note_type: "page".into(),
                title: "Sprint review".into(),
                body: String::new(),
                project: None,
                tags: vec![],
                props: Map::<String, Value>::new(),
                parent: None,
                template: Some("meeting".into()),
            },
            NOW,
        )
        .unwrap();
    let Outcome::Done { result } = done else {
        panic!()
    };
    let note = k.read(result["path"].as_str().unwrap()).unwrap();
    assert_eq!(note.meta.title, "Sprint review");
    assert!(
        note.meta.tags.contains(&"meeting".to_owned()),
        "{:?}",
        note.meta.tags
    );
    assert!(note.text.contains("Agenda"), "{}", note.text);
    assert!(!note.text.contains("{{title}}"));
}

#[test]
fn a_sub_page_from_a_template_that_does_not_exist_is_refused() {
    let (_t, k, s) = open();
    let op = AgentOp::CreateNote {
        note_type: "page".into(),
        title: "Chapter one".into(),
        body: String::new(),
        project: None,
        tags: vec![],
        props: Map::new(),
        parent: Some("library/zettelkasten-method.md".into()),
        template: Some("no such template".into()),
    };
    let err = k.agent_run(&s, &op, NOW).unwrap_err();
    assert!(err.to_string().contains("No template called"), "{err}");
}
