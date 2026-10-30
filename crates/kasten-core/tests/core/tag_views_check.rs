//! A tag schema written whole (by an agent's `update_tag_schema`, a person's
//! edit or an import) is held to the same view kinds as the view bar: an
//! unknown kind is refused with a sentence that names it and the kinds there are.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::tags::{VIEW_KINDS, schema_yaml};
use kasten_core::{Kasten, Outcome};
use serde_json::json;

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn every_known_view_kind_passes() {
    for kind in VIEW_KINDS {
        // A timeline names the date property its bars begin at.
        let schema = json!({
            "properties": [{"key": "when", "type": "date"}],
            "views": [{"name": "V", "type": kind, "start": "when"}]
        });
        assert!(schema_yaml("task", &schema).is_ok(), "{kind}");
    }
    assert_eq!(
        VIEW_KINDS,
        ["table", "kanban", "list", "calendar", "gallery", "timeline"]
    );
}

#[test]
fn an_unknown_view_kind_is_refused_naming_it_and_the_allowed_ones() {
    let schema = json!({"views": [{"name": "Plan", "type": "roadmap"}]});
    let err = schema_yaml("task", &schema).unwrap_err().to_string();
    assert!(err.contains("roadmap"), "{err}");
    for kind in VIEW_KINDS {
        assert!(err.contains(kind), "{err} should list {kind}");
    }
    // A view with no type at all is the same mistake.
    let typeless = json!({"views": [{"name": "Plan"}]});
    let err = schema_yaml("task", &typeless).unwrap_err().to_string();
    assert!(err.contains("table"), "{err}");
}

#[test]
fn an_agent_cannot_propose_a_schema_with_an_unknown_view() {
    let (t, k) = open();
    let s = Session::start("claude-code", NOW);
    let before = std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap();
    let bad = AgentOp::TagSchema {
        tag: "task".into(),
        schema: json!({"views": [{"name": "Gantt", "type": "gantt"}]}),
    };
    let err = k.agent_run(&s, &bad, NOW).unwrap_err().to_string();
    assert!(err.contains("gantt") && err.contains("kanban"), "{err}");

    let good = AgentOp::TagSchema {
        tag: "task".into(),
        schema: json!({"views": [{"name": "Board", "type": "kanban", "group_by": "status"}]}),
    };
    let outcome = k.agent_run(&s, &good, NOW).unwrap();
    assert!(
        matches!(outcome, Outcome::PendingReview { .. }),
        "{outcome:?}"
    );
    assert_eq!(
        std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap(),
        before,
        "nothing is written before review"
    );
}

#[test]
fn a_person_saving_a_whole_schema_is_held_to_it_too() {
    let (t, k) = open();
    let before = std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap();
    let bad = json!({"views": [{"name": "Gantt", "type": "gantt"}]});
    assert!(
        k.write_tag_schema(&Actor::Human, "task", &bad, NOW)
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(t.vault.root().join("tags/task.yaml")).unwrap(),
        before
    );
}
