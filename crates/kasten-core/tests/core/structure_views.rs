//! What an agent may do with the views of a tag's database: add or reorder
//! them as an ordinary write, never a view that cannot be shown, and a view
//! left out waits for review.

use serde_json::{Value, json};

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::structure::{commits, done, pending, text_of};
use crate::structure_agent::set_mode;
use kasten_core::Kasten;
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;

fn views_of(k: &Kasten, tag: &str) -> Vec<Value> {
    k.tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == tag)
        .unwrap()
        .views
}

fn views(tag: &str, views: Vec<Value>) -> AgentOp {
    AgentOp::SetTagViews {
        tag: tag.into(),
        views,
    }
}

#[test]
fn an_agent_adds_a_view_and_the_rest_of_the_schema_file_is_as_it_was() {
    let (t, k, s) = open();
    let before = text_of(&t, "tags/paper.yaml");
    let mut all = views_of(&k, "paper");
    all.push(json!({"name": "Venues", "type": "table"}));
    let n = commits(&k);
    done(k.agent_run(&s, &views("paper", all), NOW).unwrap());
    let after = text_of(&t, "tags/paper.yaml");
    let head_of_file = before.split("views:").next().unwrap();
    assert!(after.starts_with(head_of_file), "{after}");
    assert!(
        after.contains("Venues") && after.contains("Pipeline"),
        "{after}"
    );
    assert_eq!(commits(&k), n + 1);
    let head = &k.log(None, 1).unwrap()[0];
    assert!(head.agent && head.op.as_deref() == Some("update_tag_schema"));
}

#[test]
fn views_a_tag_database_cannot_show_are_refused_in_every_mode_and_never_queued() {
    let (t, k, s) = open();
    let existing = views_of(&k, "paper");
    let bad: Vec<(&str, Vec<Value>)> = vec![
        ("type", vec![json!({"name": "Plan", "type": "gantt"})]),
        ("type", vec![json!({"name": "Plan"})]),
        ("name", vec![json!({"type": "table"})]),
        ("mapping", vec![json!("table")]),
        (
            "called",
            vec![
                json!({"name": "Same", "type": "table"}),
                json!({"name": "same", "type": "kanban"}),
            ],
        ),
    ];
    for mode in [
        AgentMode::Balanced,
        AgentMode::Review,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let before = snapshot(t.vault.root());
        for (word, list) in &bad {
            let err = k
                .agent_run(&s, &views("paper", list.clone()), NOW)
                .unwrap_err()
                .to_string();
            assert!(err.contains(word), "{word}: {err}");
        }
        // A tag with no schema file is for update_tag_schema, which waits for review.
        let err = k
            .agent_run(&s, &views("nonesuch", existing.clone()), NOW)
            .unwrap_err()
            .to_string();
        assert!(err.contains("update_tag_schema"), "{err}");
        assert_eq!(snapshot(t.vault.root()), before);
        assert!(k.proposals().unwrap().is_empty());
    }
}

#[test]
fn adding_a_view_is_an_ordinary_write_and_leaving_one_out_waits_unless_trusted() {
    let (t, k, s) = open();
    let all = views_of(&k, "paper");
    let fewer: Vec<Value> = all.iter().take(2).cloned().collect();
    let before = text_of(&t, "tags/paper.yaml");
    let id = pending(
        k.agent_run(&s, &views("paper", fewer.clone()), NOW)
            .unwrap(),
    );
    assert_eq!(text_of(&t, "tags/paper.yaml"), before);
    let why = k.proposals().unwrap();
    assert!(why[0].reason.contains("All"), "{}", why[0].reason);
    k.reject_proposal(&id, "me", NOW).unwrap();
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    done(k.agent_run(&s, &views("paper", fewer), NOW).unwrap());
    assert_eq!(views_of(&k, "paper").len(), 2);
}

#[test]
fn a_kept_view_that_comes_back_without_its_settings_waits_for_review_too() {
    let (t, k, s) = open();
    let mut all = views_of(&k, "paper");
    // "All" had a sort; the agent keeps the name and the type and nothing else.
    let before = text_of(&t, "tags/paper.yaml");
    for view in &mut all {
        if view["name"] == "All" {
            *view = json!({"name": "All", "type": "table"});
        }
    }
    let id = pending(k.agent_run(&s, &views("paper", all.clone()), NOW).unwrap());
    assert_eq!(
        text_of(&t, "tags/paper.yaml"),
        before,
        "nothing was written"
    );
    let why = &k.proposals().unwrap()[0].reason;
    assert!(why.contains("All") && why.contains("settings"), "{why}");
    k.reject_proposal(&id, "me", NOW).unwrap();
    // Adding a view next to views that keep all they had is still an ordinary write.
    let mut more = views_of(&k, "paper");
    more.push(json!({"name": "Venues", "type": "table"}));
    done(k.agent_run(&s, &views("paper", more), NOW).unwrap());
}

#[test]
fn review_everything_holds_a_view_change_too() {
    let (_t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let mut all = views_of(&k, "paper");
    all.push(json!({"name": "Venues", "type": "table"}));
    pending(k.agent_run(&s, &views("paper", all), NOW).unwrap());
    assert_eq!(views_of(&k, "paper").len(), 3);
}
