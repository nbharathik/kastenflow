//! Setups added to a project that exists: only what it lacks, the person's own
//! files and schemas kept, nothing written when nothing is missing; and the
//! requests a setup refuses.

use std::fs;

use super::{DAY, NOW, existing, fresh, new, text, tree};
use kasten_core::history::Actor;
use kasten_core::{Error, SetupTarget};

#[test]
fn an_existing_project_gains_only_what_it_lacks_and_the_persons_files_stay() {
    let f = fresh();
    // A project of their own, with a page where the setup would put one, and a status.
    f.k.create(
        &Actor::Human,
        &kasten_core::NewNote {
            kind: kasten_core::Kind::Project,
            title: "Trip".to_owned(),
            date: DAY.to_owned(),
            project: None,
            parent: None,
            template: None,
            icon: None,
        },
        NOW,
    )
    .unwrap();
    f.k.set_project_state(
        &Actor::Human,
        "projects/trip/_project.md",
        &kasten_core::ProjectState {
            status: Some(Some("Paused".into())),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    let mine = "---\ntitle: Outline\n---\nMy own outline.\n";
    fs::create_dir_all(f.dir.join("projects/trip/pages")).unwrap();
    fs::write(f.dir.join("projects/trip/pages/outline.md"), mine).unwrap();
    f.k.reindex().unwrap();
    let page_before = text(&f, "projects/trip/_project.md");

    let plan = f.k.preview_setup("writing", &existing("trip")).unwrap();
    assert_eq!(plan.keep, ["projects/trip/pages/outline.md"]);
    assert!(
        plan.props.is_empty(),
        "the page has a status already: {:?}",
        plan.props
    );
    assert!(
        !plan
            .create
            .contains(&"projects/trip/_project.md".to_owned())
    );
    let done =
        f.k.apply_setup(&Actor::Human, "writing", &existing("trip"), NOW)
            .unwrap();
    assert_eq!(done.written, plan.create);
    assert_eq!(done.kept, plan.keep);
    assert_eq!(text(&f, "projects/trip/pages/outline.md"), mine);
    assert_eq!(
        text(&f, "projects/trip/_project.md"),
        page_before,
        "a page that lacks nothing is not touched"
    );
    assert!(f.dir.join("projects/trip/pages/draft.md").is_file());

    // Applied again: nothing to write, no commit.
    let head = f.k.log(None, 1).unwrap()[0].id.clone();
    let again =
        f.k.apply_setup(&Actor::Human, "writing", &existing("trip"), NOW)
            .unwrap();
    assert!(
        again.written.is_empty() && again.commit.is_none(),
        "{again:?}"
    );
    assert_eq!(f.k.log(None, 1).unwrap()[0].id, head);
}

#[test]
fn a_page_without_a_status_gets_one_and_nothing_else_of_it_changes() {
    let f = fresh();
    let page = "---\nid: 01PAGEWITHOUTSTATUS000000A\ntitle: Plain\ntype: project\nx-note: keep me\ntags: [project]\n---\nBody stays.\n";
    fs::create_dir_all(f.dir.join("projects/plain")).unwrap();
    fs::write(f.dir.join("projects/plain/_project.md"), page).unwrap();
    f.k.reindex().unwrap();
    let plan = f.k.preview_setup("research", &existing("plain")).unwrap();
    assert_eq!(plan.props, ["status"]);
    assert!(
        plan.create
            .contains(&"projects/plain/_project.md".to_owned())
    );
    f.k.apply_setup(&Actor::Human, "research", &existing("plain"), NOW)
        .unwrap();
    let after = text(&f, "projects/plain/_project.md");
    for line in [
        "id: 01PAGEWITHOUTSTATUS000000A\n",
        "title: Plain\n",
        "x-note: keep me\n",
        "tags: [project]\n",
    ] {
        assert!(after.contains(line), "{line:?} in {after:?}");
    }
    assert!(
        after.contains("props:\n  status: Active\n") && after.ends_with("---\nBody stays.\n"),
        "{after}"
    );
}

#[test]
fn tag_schemas_the_vault_has_are_kept() {
    let f = fresh();
    // `experiment` ships with every vault; `reading` is the setup's to add.
    let before = text(&f, "tags/experiment.yaml");
    let plan = f.k.preview_setup("research", &new("Study")).unwrap();
    assert!(plan.keep.contains(&"tags/experiment.yaml".to_owned()));
    assert!(plan.create.contains(&"tags/reading.yaml".to_owned()));
    f.k.apply_setup(&Actor::Human, "research", &new("Study"), NOW)
        .unwrap();
    assert_eq!(text(&f, "tags/experiment.yaml"), before);
    // A reading schema of their own is never replaced.
    let g = fresh();
    let own = "name: reading\nproperties:\n  - {key: shelf, type: text}\n";
    fs::write(g.dir.join("tags/reading.yaml"), own).unwrap();
    let done =
        g.k.apply_setup(&Actor::Human, "research", &new("Study"), NOW)
            .unwrap();
    assert!(done.kept.contains(&"tags/reading.yaml".to_owned()));
    assert_eq!(text(&g, "tags/reading.yaml"), own);
}

#[test]
fn agents_cannot_apply_a_setup_and_bad_requests_write_nothing() {
    let f = fresh();
    let before = tree(&f.dir);
    let agent = Actor::Agent {
        client: "test".into(),
        session: "s-1".into(),
    };
    assert!(matches!(
        f.k.apply_setup(&agent, "research", &new("X"), NOW),
        Err(Error::Invalid(_))
    ));
    for (id, target, word) in [
        ("nonsense", new("X"), "no setup"),
        ("../research", new("X"), "no setup"),
        ("research", new("   "), "title"),
        ("research", new("Has [brackets]"), "title"),
        ("research", existing("nowhere"), "No project called nowhere"),
        ("research", existing("../x"), "Not a project folder"),
        ("research", existing(""), "Not a project folder"),
    ] {
        let err =
            f.k.apply_setup(&Actor::Human, id, &target, NOW)
                .unwrap_err();
        assert!(
            matches!(err, Error::Invalid(ref m) if m.contains(word)),
            "{id} {target:?}: {err:?}"
        );
        assert!(f.k.preview_setup(id, &target).is_err(), "{id} {target:?}");
    }
    assert_eq!(tree(&f.dir), before);
}

#[test]
fn the_target_reads_as_the_app_sends_it() {
    let new_target: SetupTarget = serde_json::from_str(r#"{"kind": "new", "title": "A"}"#).unwrap();
    assert_eq!(new_target, SetupTarget::New { title: "A".into() });
    let old: SetupTarget = serde_json::from_str(r#"{"kind": "existing", "folder": "a"}"#).unwrap();
    assert_eq!(old, SetupTarget::Existing { folder: "a".into() });
    let f = fresh();
    let plan = serde_json::to_value(f.k.preview_setup("writing", &new("Z")).unwrap()).unwrap();
    for key in ["projectPath", "home", "create", "keep", "props"] {
        assert!(plan.get(key).is_some(), "{key}");
    }
}
