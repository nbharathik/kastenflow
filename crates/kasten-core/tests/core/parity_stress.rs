//! The parity ops under attack: the mode of the project an op lands in, an
//! agent's undo told apart from a person's, a restore that meets a taken
//! name, and a lock set between a proposal and its accepting. (Pages, to-dos,
//! saved searches and the journal are in `parity_stress_pages`.)

use crate::change_sets::open;
use crate::common::NOW;
use crate::parity::{lock, refused};
use crate::structure::{done, page, pending};
use kasten_core::Kasten;
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::Actor;

const PROJECT: &str = "photo-organiser";

/// The vault in `mode`, with the project in `project_mode`.
fn modes(k: &Kasten, mode: AgentMode, project_mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        projects: [(
            PROJECT.to_owned(),
            ProjectAgents {
                mode: Some(project_mode),
                ..ProjectAgents::default()
            },
        )]
        .into(),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

fn drawing_xml() -> String {
    "<mxfile host=\"test\">\n  <diagram id=\"p1\" name=\"Page-1\">\n    <mxGraphModel>\n      <root>\n        <mxCell id=\"0\" />\n        <mxCell id=\"1\" parent=\"0\" />\n        <mxCell id=\"a\" value=\"a\" vertex=\"1\" parent=\"1\" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n".into()
}

#[test]
fn a_page_restored_into_a_project_in_review_waits_though_the_vault_is_autonomous() {
    let (_t, k, s) = open();
    let gone = page(&k, "Gone", Some(PROJECT), None);
    let trashed = k.trash(&Actor::Human, &gone.meta.path, NOW).unwrap();
    modes(&k, AgentMode::Autonomous, AgentMode::Review);
    let op = AgentOp::RestoreNote { path: trashed };
    pending(k.agent_run(&s, &op, NOW).unwrap());
    assert!(k.read(&gone.meta.path).is_err(), "nothing came back yet");
}

#[test]
fn a_diagram_moved_into_a_project_in_review_waits_though_the_vault_is_autonomous() {
    let (_t, k, s) = open();
    modes(&k, AgentMode::Autonomous, AgentMode::Review);
    let made = AgentOp::CreateDiagram {
        title: "Flow".into(),
        project: None,
        xml: drawing_xml(),
    };
    let path = done(k.agent_run(&s, &made, NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned();
    let into = AgentOp::MoveDiagram {
        path: path.clone(),
        project: Some(PROJECT.into()),
    };
    pending(k.agent_run(&s, &into, NOW).unwrap());
    assert_eq!(
        k.diagrams().unwrap()[0].path,
        path,
        "it stayed in the library"
    );
}

#[test]
fn undoing_a_session_that_changed_a_project_in_review_waits() {
    let (_t, k, s) = open();
    modes(&k, AgentMode::Autonomous, AgentMode::Autonomous);
    let made = AgentOp::CreateNote {
        note_type: "page".into(),
        title: "Scratch".into(),
        body: "x".into(),
        project: Some(PROJECT.into()),
        tags: vec![],
        props: Default::default(),
        parent: None,
        template: None,
    };
    let path = done(k.agent_run(&s, &made, NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned();
    modes(&k, AgentMode::Autonomous, AgentMode::Review);
    let undo = AgentOp::UndoSession {
        session: s.id.clone(),
    };
    pending(k.agent_run(&s, &undo, NOW).unwrap());
    assert!(k.read(&path).is_ok(), "the page is still there");
}

#[test]
fn an_agents_undo_says_it_was_the_agents_and_in_which_mode() {
    let (_t, k, s) = open();
    let made = AgentOp::Capture {
        markdown: "Remember the milk".into(),
        tags: vec![],
    };
    done(k.agent_run(&s, &made, NOW).unwrap());
    let undo = AgentOp::UndoSession {
        session: s.id.clone(),
    };
    done(k.agent_run(&s, &undo, NOW).unwrap());
    let head = &k.log(None, 1).unwrap()[0];
    assert!(head.message.contains("Kasten-Undo:"), "{}", head.message);
    assert!(
        head.message
            .contains(&format!("Kasten-Agent: kasten-chat {}", s.id)),
        "{}",
        head.message
    );
    // The revert is not a commit of the session, so the session stays whole.
    assert_eq!(head.session, None);
    let listed = k.sessions(10).unwrap();
    assert!(listed[0].undone && listed[0].commits == 1, "{listed:?}");

    modes(&k, AgentMode::Autonomous, AgentMode::Autonomous);
    let other = kasten_core::agent::Session::start("cursor", NOW);
    let made = AgentOp::Capture {
        markdown: "Another thought".into(),
        tags: vec![],
    };
    done(k.agent_run(&other, &made, NOW).unwrap());
    let undo = AgentOp::UndoSession {
        session: other.id.clone(),
    };
    done(k.agent_run(&other, &undo, NOW).unwrap());
    let head = &k.log(None, 1).unwrap()[0];
    assert!(
        head.message.contains("Kasten-Mode: autonomous"),
        "{}",
        head.message
    );
    assert!(
        !head.message.contains("Approved-by"),
        "an agent's own undo needs no approval: {}",
        head.message
    );

    // Another session's changes are taken back, in autonomous mode, on the
    // mode's own approval, and the commit says so.
    let made = AgentOp::Capture {
        markdown: "A third thought".into(),
        tags: vec![],
    };
    done(k.agent_run(&other, &made, NOW).unwrap());
    let third = kasten_core::agent::Session::start(
        "windsurf",
        kasten_core::Instant {
            millis: NOW.millis + 1,
        },
    );
    let undo = AgentOp::UndoSession {
        session: other.id.clone(),
    };
    done(k.agent_run(&third, &undo, NOW).unwrap());
    let head = &k.log(None, 1).unwrap()[0];
    assert!(
        head.message.contains("Kasten-Agent: windsurf"),
        "{}",
        head.message
    );
    assert!(
        head.message.contains("Approved-by: autonomous-mode"),
        "{}",
        head.message
    );
}

#[test]
fn a_persons_commit_is_never_a_session_whatever_its_words_say() {
    let (_t, k, s) = open();
    // A person's note whose title reads like a session's trailer.
    let victim = "01VICTIMSESSION0000000000";
    page(&k, &format!("Kasten-Session: {victim}"), None, None);
    let undo = AgentOp::UndoSession {
        session: victim.into(),
    };
    let why = refused(&k, &s, &undo);
    assert!(why.contains("nothing left to undo"), "{why}");
    assert!(k.sessions(50).unwrap().iter().all(|i| i.id != victim));
}

#[test]
fn an_undo_keeps_what_a_person_wrote_since() {
    let (_t, k, s) = open();
    let made = AgentOp::CreateNote {
        note_type: "page".into(),
        title: "Draft".into(),
        body: "agent line\n".into(),
        project: None,
        tags: vec![],
        props: Default::default(),
        parent: None,
        template: None,
    };
    let path = done(k.agent_run(&s, &made, NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned();
    k.append(&Actor::Human, &path, "my own words", None, NOW)
        .unwrap();
    let undo = AgentOp::UndoSession {
        session: s.id.clone(),
    };
    // Whatever the undo does, the person's words are still in the vault.
    let _ = k.agent_run(&s, &undo, NOW);
    let text = k.read(&path).map(|n| n.text).unwrap_or_default();
    assert!(text.contains("my own words"), "{text}");
}

#[test]
fn a_restored_page_never_writes_over_a_page_that_took_its_name() {
    let (_t, k, s) = open();
    let first = page(&k, "Twin", None, None);
    let trashed = k.trash(&Actor::Human, &first.meta.path, NOW).unwrap();
    let second = page(&k, "Twin", None, None);
    assert_eq!(first.meta.path, second.meta.path, "the name was free again");
    let before = k.read(&second.meta.path).unwrap().text;
    let told = done(
        k.agent_run(&s, &AgentOp::RestoreNote { path: trashed }, NOW)
            .unwrap(),
    );
    assert_ne!(told["path"], second.meta.path.as_str());
    assert_eq!(k.read(&second.meta.path).unwrap().text, before);
    assert!(k.read(told["path"].as_str().unwrap()).is_ok());
}

#[test]
fn a_proposal_is_refused_when_its_page_was_locked_while_it_waited() {
    let (_t, k, s) = open();
    let p = page(&k, "Styled", None, None);
    crate::structure_agent::set_mode(&k, AgentMode::Review);
    let op = AgentOp::SetNoteMeta {
        path: p.meta.path.clone(),
        key: "icon".into(),
        value: Some("📗".into()),
    };
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    lock(&k, &p.meta.path);
    let why = k.accept_proposal(&id, "me", NOW).unwrap_err().to_string();
    assert!(why.contains("locked"), "{why}");
    assert!(!k.read(&p.meta.path).unwrap().text.contains("📗"));
}
