use super::*;

#[test]
fn ops_round_trip_as_json() {
    let op = AgentOp::ReplaceSection {
        path: "a.md".into(),
        heading: "Plan".into(),
        markdown: "x".into(),
    };
    let json = serde_json::to_value(&op).unwrap();
    assert_eq!(json["kind"], "replace_section");
    assert_eq!(serde_json::from_value::<AgentOp>(json).unwrap(), op);
    let create: AgentOp =
        serde_json::from_str(r#"{"kind":"create_note","type":"card","title":"T"}"#).unwrap();
    assert_eq!(create.name(), "create_note");
    assert!(create.creates());
    assert_eq!(op.path(), Some("a.md"));
    assert_eq!(op.bytes(), 1);
}

#[test]
fn structure_ops_round_trip_as_json_as_proposals_keep_them() {
    let state = AgentOp::SetProjectState {
        path: "projects/a/_project.md".into(),
        state: serde_json::from_str(r#"{"status": "Paused", "health": null}"#).unwrap(),
    };
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(
        json["state"],
        serde_json::json!({"status": "Paused", "health": null})
    );
    assert_eq!(serde_json::from_value::<AgentOp>(json).unwrap(), state);
    let nest: AgentOp = serde_json::from_str(r#"{"kind":"set_parent","path":"a.md"}"#).unwrap();
    assert_eq!(
        nest,
        AgentOp::SetParent {
            path: "a.md".into(),
            parent: None
        }
    );
    assert_eq!(
        (nest.name(), nest.path(), nest.bytes()),
        ("set_parent", Some("a.md"), 0)
    );
    let order = AgentOp::ReorderChildren {
        parent: "p.md".into(),
        ids: vec!["A".into(), "BC".into()],
    };
    assert_eq!(
        (order.name(), order.path(), order.bytes()),
        ("reorder_children", Some("p.md"), 3)
    );
    let project = AgentOp::CreateProject {
        title: "Trip".into(),
        setup: None,
    };
    assert!(project.creates() && project.path().is_none());
    let views = AgentOp::SetTagViews {
        tag: "paper".into(),
        views: vec![],
    };
    assert_eq!((views.name(), views.path()), ("set_tag_views", None));
}

#[test]
fn deck_ops_measure_what_was_sent_and_not_the_deck() {
    let edit: AgentOp = serde_json::from_str(
        r#"{"kind":"edit_deck","path":"library/a.deck","tool":"add_slide","base":"{}","text":"{ }   ","sent":42}"#,
    )
    .unwrap();
    assert_eq!(
        (edit.name(), edit.path(), edit.bytes()),
        ("edit_deck", Some("library/a.deck"), 42)
    );
    assert!(!edit.creates());
    // Older or hand-written proposals name no summary and no size.
    let made: AgentOp = serde_json::from_str(
        r#"{"kind":"create_deck","title":"T","tool":"create_deck","text":"{}"}"#,
    )
    .unwrap();
    assert_eq!(
        (made.name(), made.path(), made.bytes()),
        ("create_deck", None, 0)
    );
    assert!(made.creates());
}

#[test]
fn parity_ops_round_trip_as_json_as_proposals_keep_them() {
    let ops = vec![
        AgentOp::DuplicateNote {
            path: "a.md".into(),
        },
        AgentOp::RestoreNote {
            path: ".trash/20260101T000000Z/a.md".into(),
        },
        AgentOp::SetNoteMeta {
            path: "a.md".into(),
            key: "font".into(),
            value: None,
        },
        AgentOp::SetTask {
            path: "a.md".into(),
            line: 2,
            done: true,
            base: "h".into(),
        },
        AgentOp::AddComment {
            path: "a.md".into(),
            anchor: Anchor {
                section: "Plan".into(),
                nth: 1,
                quote: Some("words".into()),
                prefix: None,
                suffix: None,
            },
            text: "Check".into(),
        },
        AgentOp::UpdateCollection {
            path: "views/a.yaml".into(),
            edits: Map::new(),
            base: "h".into(),
        },
        AgentOp::AddReference {
            kind: "article".into(),
            key: "k2026".into(),
            fields: BTreeMap::from([("title".to_owned(), "T".to_owned())]),
            allow_duplicate: false,
        },
        AgentOp::UndoSession {
            session: "s".into(),
        },
    ];
    for op in ops {
        let json = serde_json::to_value(&op).unwrap();
        assert_eq!(json["kind"], op.name());
        assert_eq!(serde_json::from_value::<AgentOp>(json).unwrap(), op);
    }
    let reference = AgentOp::AddReference {
        kind: "book".into(),
        key: "k".into(),
        fields: BTreeMap::new(),
        allow_duplicate: false,
    };
    assert_eq!(serde_json::to_value(&reference).unwrap()["type"], "book");
    assert!(!reference.creates() && reference.path().is_none());
    let copy = AgentOp::DuplicateNote {
        path: "a.md".into(),
    };
    assert!(copy.creates() && copy.path() == Some("a.md"));
}

#[test]
fn a_saved_setup_op_round_trips_and_older_proposals_read_with_defaults() {
    let save = AgentOp::SaveProjectSetup {
        project: "trip".into(),
        slug: "kit".into(),
        title: "Kit".into(),
        pages: Some(vec!["projects/trip/pages/a.md".into()]),
    };
    let json = serde_json::to_value(&save).unwrap();
    assert_eq!(json["kind"], "save_project_setup");
    assert_eq!(serde_json::from_value::<AgentOp>(json).unwrap(), save);
    assert_eq!(
        (save.name(), save.path(), save.bytes()),
        ("save_project_setup", None, 4 + 3 + 3 + 24)
    );
    assert!(!save.creates());
    let short: AgentOp =
        serde_json::from_str(r#"{"kind":"save_project_setup","project":"trip","title":"Kit"}"#)
            .unwrap();
    assert!(
        matches!(short, AgentOp::SaveProjectSetup { slug, pages: None, .. } if slug.is_empty())
    );
}

#[test]
fn smart_page_ops_round_trip_and_name_the_page_not_the_file() {
    let write = AgentOp::SmartWrite {
        page: "projects/r/pages/tracker.md".into(),
        path: "data/venues.json".into(),
        content: "{}".into(),
        base: String::new(),
        reason: None,
    };
    let delete = AgentOp::SmartDelete {
        page: "projects/r/pages/tracker.md".into(),
        path: "app.js".into(),
        reason: Some("old".into()),
    };
    for op in [&write, &delete] {
        let json = serde_json::to_value(op).unwrap();
        assert_eq!(json["kind"], op.name());
        assert_eq!(&serde_json::from_value::<AgentOp>(json).unwrap(), op);
        // The op is about the page (its lock, its project, its title), and
        // makes no note of its own.
        assert_eq!(op.path(), Some("projects/r/pages/tracker.md"));
        assert!(!op.creates());
    }
    assert_eq!(
        (write.name(), delete.name()),
        ("smart_write", "smart_delete")
    );
    // The size limit counts the text sent.
    assert_eq!((write.bytes(), delete.bytes()), (2, 0));
    // A write without a base or reason reads as a new file.
    let short: AgentOp = serde_json::from_value(serde_json::json!({
        "kind": "smart_write", "page": "a.md", "path": "x.js", "content": "x"
    }))
    .unwrap();
    assert!(matches!(short, AgentOp::SmartWrite { base, reason: None, .. } if base.is_empty()));
}
