//! The structure ops under stress: odd frontmatter, ids with special
//! characters, long lists, two engines on one vault, a cycle made by two moves
//! of one batch, a held move that stopped being safe, an index written by an
//! older version, and other spellings of a path.

use std::fs;

use rusqlite::Connection;
use serde_json::{Map, json};

use crate::change_sets::{open, snapshot};
use crate::common::{NOW, dev_vault};
use crate::structure::{HANDBOOK, HANDBOOK_TEXT, commits, done, handbook, id_of, page, pending};
use crate::structure_agent::{Has, batch, set_mode};
use kasten_core::Kasten;
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::structure::order_text;

const HANDBOOK_ID: &str = "01HANDBOOK00000000000000A";

pub(crate) fn kid_text(id: &str, title: &str) -> String {
    format!(
        "---\nid: {}\ntitle: {title}\ntype: page\nparent: {HANDBOOK_ID}\n---\nBody\n",
        serde_json::to_string(id).unwrap()
    )
}

#[test]
fn a_stray_children_order_never_hides_the_page_or_its_lock() {
    let (t, k, s) = open();
    for (i, stray) in ["{a: 1}", "[[x], y]", "[{a: 1}]", "\"just text\""]
        .into_iter()
        .enumerate()
    {
        let text = HANDBOOK_TEXT.replace(
            "icon: 📘\n",
            &format!("icon: 📘\nlocked: true\nchildren_order: {stray}\n"),
        );
        handbook(&t, &k, &text);
        let note = k.read(HANDBOOK).unwrap();
        assert_eq!(note.meta.title, "Handbook", "{stray}");
        assert!(note.meta.locked, "{stray}: the lock must still be seen");
        assert_eq!(
            note.meta.id.as_deref(),
            Some(HANDBOOK_ID),
            "round {i}: {stray}"
        );
        let order = AgentOp::ReorderChildren {
            parent: HANDBOOK.into(),
            ids: vec![],
        };
        assert!(k.agent_run(&s, &order, NOW).is_err(), "{stray}");
    }
}

#[test]
fn a_batch_of_two_moves_cannot_make_a_cycle() {
    let (t, k, s) = open();
    let a = page(&k, "Page A", None, None);
    let b = page(&k, "Page B", None, None);
    let before = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let ops = vec![
        AgentOp::SetParent {
            path: a.meta.path.clone(),
            parent: Some(b.meta.path.clone()),
        },
        AgentOp::SetParent {
            path: b.meta.path.clone(),
            parent: Some(a.meta.path.clone()),
        },
    ];
    let result = k.agent_run(&s, &batch(ops), NOW);
    let (pa, pb) = (
        k.read(&a.meta.path).map(|n| n.meta.parent),
        k.read(&b.meta.path).map(|n| n.meta.parent),
    );
    assert!(
        result.is_err(),
        "the second move would put B inside its own sub-page: {pa:?} {pb:?}"
    );
    assert!(snapshot(t.vault.root()) == before);
    assert_eq!(commits(&k), commits_before);
}

#[test]
fn a_held_move_is_refused_when_accepting_it_would_make_a_cycle() {
    let (_t, k, s) = open();
    let a = page(&k, "Page A", None, None);
    let b = page(&k, "Page B", None, None);
    set_mode(&k, AgentMode::Review);
    let nest = AgentOp::SetParent {
        path: a.meta.path.clone(),
        parent: Some(b.meta.path.clone()),
    };
    let id = pending(k.agent_run(&s, &nest, NOW).unwrap());
    // Meanwhile a person puts B inside A: A inside B is now a cycle.
    k.set_parent(&Actor::Human, &b.meta.path, Some(&a.meta.path), NOW)
        .unwrap();
    let err = k.accept_proposal(&id, "me", NOW).unwrap_err().to_string();
    assert!(err.contains("inside itself"), "{err}");
    assert_eq!(k.read(&a.meta.path).unwrap().meta.parent, None);
}

#[test]
fn a_held_move_is_refused_when_the_page_was_locked_meanwhile() {
    let (_t, k, s) = open();
    let a = page(&k, "Page A", None, None);
    let b = page(&k, "Page B", None, None);
    set_mode(&k, AgentMode::Review);
    let nest = AgentOp::SetParent {
        path: a.meta.path.clone(),
        parent: Some(b.meta.path.clone()),
    };
    let id = pending(k.agent_run(&s, &nest, NOW).unwrap());
    k.set_meta(&Actor::Human, &b.meta.path, "locked", Some("true"), NOW)
        .unwrap();
    let err = k.accept_proposal(&id, "me", NOW).unwrap_err().to_string();
    assert!(err.contains("locked"), "{err}");
    assert_eq!(k.read(&a.meta.path).unwrap().meta.parent, None);
}

#[test]
fn a_locked_sub_sub_page_or_a_locked_note_that_links_to_a_moved_title_refuses_the_move() {
    let (t, k, s) = open();
    let holder = page(&k, "Holder", Some("photo-organiser"), None);
    let mover = page(&k, "Mover", None, None);
    let child = page(&k, "Mover child", None, Some(&mover.meta.path));
    let grand = page(&k, "Mover grandchild", None, Some(&child.meta.path));
    k.set_meta(&Actor::Human, &grand.meta.path, "locked", Some("true"), NOW)
        .unwrap();
    let nest = AgentOp::SetParent {
        path: mover.meta.path.clone(),
        parent: Some(holder.meta.path.clone()),
    };
    for mode in [
        AgentMode::Balanced,
        AgentMode::Review,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let before = snapshot(t.vault.root());
        let err = k.agent_run(&s, &nest, NOW).unwrap_err().to_string();
        assert!(err.contains("locked"), "{mode:?}: {err}");
        assert!(
            snapshot(t.vault.root()) == before,
            "{mode:?}: nothing written"
        );
    }

    // A locked note that links to a title the move could rewrite.
    k.set_meta(&Actor::Human, &grand.meta.path, "locked", None, NOW)
        .unwrap();
    fs::write(
        t.vault.root().join("library/linker.md"),
        "---\nid: 01LINKER\ntitle: Linker\nlocked: true\n---\nSee [[Mover child]]\n",
    )
    .unwrap();
    k.reindex().unwrap();
    set_mode(&k, AgentMode::Autonomous);
    let err = k.agent_run(&s, &nest, NOW).unwrap_err().to_string();
    assert!(err.contains("locked") && err.contains("links"), "{err}");
}

#[test]
fn an_agent_called_directly_cannot_take_a_locked_page_out_of_its_page() {
    let (_t, k, _s) = open();
    let outer = page(&k, "Outer", None, None);
    let inner = page(&k, "Inner", None, Some(&outer.meta.path));
    k.set_meta(&Actor::Human, &inner.meta.path, "locked", Some("true"), NOW)
        .unwrap();
    let agent = Actor::Agent {
        client: "test".into(),
        session: "s1".into(),
    };
    let err = k
        .set_parent(&agent, &inner.meta.path, None, NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("locked"), "{err}");
    assert_eq!(k.read(&inner.meta.path).unwrap().meta.parent, outer.meta.id);
    // Leaving a locked parent is allowed: only the page itself is written.
    let free = page(&k, "Free", None, Some(&outer.meta.path));
    k.set_meta(&Actor::Human, &outer.meta.path, "locked", Some("true"), NOW)
        .unwrap();
    k.set_parent(&agent, &free.meta.path, None, NOW).unwrap();
    assert_eq!(k.read(&free.meta.path).unwrap().meta.parent, None);
}

#[test]
fn a_tag_schema_view_needs_a_name_and_two_views_cannot_share_one() {
    use kasten_core::tags::schema_yaml;
    let nameless = json!({"views": [{"type": "table"}]});
    assert!(schema_yaml("task", &nameless).is_err());
    let blank = json!({"views": [{"name": "  ", "type": "table"}]});
    assert!(schema_yaml("task", &blank).is_err());
    let twice =
        json!({"views": [{"name": "All", "type": "table"}, {"name": "all", "type": "list"}]});
    let err = schema_yaml("task", &twice).unwrap_err().to_string();
    assert!(err.contains("two views"), "{err}");
    let fine =
        json!({"views": [{"name": "All", "type": "table"}, {"name": "Board", "type": "kanban"}]});
    assert!(schema_yaml("task", &fine).is_ok());
}

#[test]
fn update_props_cannot_reach_a_projects_state_by_another_spelling_of_the_page() {
    let (t, k, s) = open();
    let page_path = "projects/photo-organiser/_project.md";
    let before = snapshot(t.vault.root());
    let spellings = [
        "Projects/photo-organiser/_project.md",
        "projects/photo-organiser/_Project.md",
        "PROJECTS/PHOTO-ORGANISER/_PROJECT.MD",
    ];
    for spelling in spellings {
        for key in ["status", "Status", "HEALTH", "next_action", "last_review"] {
            let mut props = Map::new();
            props.insert(key.to_owned(), json!("Paused"));
            let op = AgentOp::UpdateProps {
                path: spelling.into(),
                props,
            };
            let single = k.agent_run(&s, &op, NOW);
            let batched = k.agent_run(&s, &batch(vec![op]), NOW);
            if cfg!(windows) || cfg!(target_os = "macos") {
                // The same file by another spelling: still refused.
                assert!(single.is_err(), "{spelling} {key}");
                assert!(batched.is_err(), "{spelling} {key} in a batch");
            }
        }
    }
    assert!(
        snapshot(t.vault.root()) == before,
        "no spelling of the page's path got a state key written (page: {page_path})"
    );
}

#[test]
fn comments_flow_lists_over_lines_and_a_repeated_key_are_handled() {
    let (t, k, _s) = open();
    // A flow list over two lines, with a comment after it and another key below.
    let multi = HANDBOOK_TEXT.replace(
        "icon: 📘\n",
        "children_order: [OLD1,\n  OLD2]  # by hand\nicon: 📘\n",
    );
    handbook(&t, &k, &multi);
    let a = page(&k, "Alpha", None, Some(HANDBOOK));
    k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&a)], NOW)
        .unwrap();
    let text = fs::read_to_string(t.vault.root().join(HANDBOOK)).unwrap();
    assert_eq!(
        text,
        HANDBOOK_TEXT.replace(
            "icon: 📘\n",
            &format!("children_order: [{}]\nicon: 📘\n", id_of(&a))
        ),
        "the two lines are replaced and the key after them is as it was"
    );

    // A key written twice (broken YAML): nothing gets worse and nothing panics.
    let twice = HANDBOOK_TEXT.replace(
        "icon: 📘\n",
        "children_order: [X]\nicon: 📘\nchildren_order: [Y]\n",
    );
    handbook(&t, &k, &twice);
    let _ = k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&a)], NOW);
    let after = fs::read_to_string(t.vault.root().join(HANDBOOK)).unwrap();
    assert!(
        after.contains("icon: 📘\n") && after.ends_with("More.\n"),
        "{after}"
    );
}

#[test]
fn undo_puts_a_reordered_parent_back_to_the_byte() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let a = page(&k, "Alpha", None, Some(HANDBOOK));
    let b = page(&k, "Beta", None, Some(HANDBOOK));
    let before = snapshot(t.vault.root());
    k.reorder_children(&Actor::Human, HANDBOOK, &[id_of(&b), id_of(&a)], NOW)
        .unwrap();
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn two_engines_reordering_one_parent_leave_a_whole_file() {
    let (t, k, _s) = open();
    handbook(&t, &k, HANDBOOK_TEXT);
    let kids: Vec<String> = ["Alpha", "Beta", "Gamma"]
        .iter()
        .map(|title| id_of(&page(&k, title, None, Some(HANDBOOK))))
        .collect();
    let other = Kasten::open(t.vault.root()).unwrap();
    let reversed: Vec<String> = kids.iter().rev().cloned().collect();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for _ in 0..8 {
                k.reorder_children(&Actor::Human, HANDBOOK, &kids, NOW)
                    .unwrap();
            }
        });
        scope.spawn(|| {
            for _ in 0..8 {
                other
                    .reorder_children(&Actor::Human, HANDBOOK, &reversed, NOW)
                    .unwrap();
            }
        });
    });
    let text = fs::read_to_string(t.vault.root().join(HANDBOOK)).unwrap();
    let list = k.read(HANDBOOK).unwrap().meta.children_order;
    assert!(list == kids || list == reversed, "{list:?}");
    assert_eq!(order_text(&text, &[]).unwrap().unwrap(), HANDBOOK_TEXT);
}

#[test]
fn a_cache_written_by_the_previous_version_is_rebuilt_and_nothing_is_lost() {
    let t = dev_vault();
    let root = t.vault.root();
    fs::write(root.join(HANDBOOK), HANDBOOK_TEXT).unwrap();
    fs::write(root.join("library/kid.md"), kid_text("KID1", "Kid")).unwrap();
    let cache = root.join(".kasten/cache");
    fs::create_dir_all(&cache).unwrap();
    {
        let conn = Connection::open(cache.join("index.sqlite")).unwrap();
        conn.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO meta VALUES ('schema', '6');
             CREATE TABLE notes (num INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL);
             INSERT INTO notes (path, title) VALUES ('library/ghost.md', 'Ghost');
             CREATE TABLE agent_marks (path TEXT PRIMARY KEY, head TEXT NOT NULL, blob TEXT NOT NULL, marks TEXT NOT NULL);",
        )
        .unwrap();
    }
    let k = Kasten::open(root).unwrap();
    let notes = k.list().unwrap();
    assert!(notes.iter().all(|n| n.title != "Ghost"));
    assert!(notes.iter().any(|n| n.path == "library/kid.md"));
    k.start_history().unwrap();
    k.reorder_children(&Actor::Human, HANDBOOK, &["KID1".to_owned()], NOW)
        .unwrap();
    assert_eq!(k.read(HANDBOOK).unwrap().meta.children_order, ["KID1"]);
    // And a second open finds the new index as it is.
    drop(k);
    let k = Kasten::open(root).unwrap();
    assert_eq!(k.read(HANDBOOK).unwrap().meta.children_order, ["KID1"]);
    let listed = k.list().unwrap();
    let held = listed.iter().find(|n| n.path == HANDBOOK).unwrap();
    assert_eq!(held.children_order, ["KID1"]);
}

#[test]
fn project_titles_with_odd_names_make_a_folder_inside_projects_or_are_refused() {
    let (t, k, s) = open();
    let long = "x".repeat(200);
    for title in [
        "CON",
        "nul",
        "..",
        "../../escape",
        "a/b\\c",
        "Ünïcode ✓",
        "...",
        long.as_str(),
    ] {
        let op = AgentOp::CreateProject {
            title: title.into(),
            setup: None,
        };
        if let Ok(outcome) = k.agent_run(&s, &op, NOW) {
            let told = done(outcome);
            let path = told["path"].as_str().unwrap().to_owned();
            assert!(
                path.starts_with("projects/") && path.ends_with("/_project.md"),
                "{title:?}: {path}"
            );
            assert!(!path.contains(".."), "{title:?}: {path}");
            assert!(k.vault_has(&path));
        }
    }
    // Nothing outside the vault was made.
    let outside = t.vault.root().parent().unwrap().join("escape");
    assert!(!outside.exists());
}
