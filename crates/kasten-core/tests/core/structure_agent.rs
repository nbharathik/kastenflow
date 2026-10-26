//! What an agent may do with `set_parent` and `reorder_children` under the
//! three modes, and with the structure ops in a batch. Projects are in
//! `structure_projects`, tag views in `structure_views`.

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::structure::{commits, done, id_of, page, pending};
use kasten_core::Kasten;
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::{AgentMode, AgentsConfig};

pub(crate) trait Has {
    /// Whether the vault has a file at `path`.
    fn vault_has(&self, path: &str) -> bool;
}

impl Has for Kasten {
    fn vault_has(&self, path: &str) -> bool {
        self.root().join(path).exists()
    }
}

pub(crate) fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

pub(crate) fn batch(ops: Vec<AgentOp>) -> AgentOp {
    AgentOp::Batch {
        ops,
        reason: Some("test".into()),
    }
}

#[test]
fn a_cycle_is_refused_in_every_mode_and_a_good_move_waits_only_in_review() {
    let (_t, k, s) = open();
    let outer = page(&k, "Outer", None, None);
    let inner = page(&k, "Inner", None, Some(&outer.meta.path));
    let free = page(&k, "Free", None, None);
    let cycle = AgentOp::SetParent {
        path: outer.meta.path.clone(),
        parent: Some(inner.meta.path.clone()),
    };
    for mode in [
        AgentMode::Balanced,
        AgentMode::Review,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        assert!(k.agent_run(&s, &cycle, NOW).is_err(), "{mode:?}");
        assert!(k.proposals().unwrap().is_empty(), "{mode:?}");
    }
    let nest = AgentOp::SetParent {
        path: free.meta.path.clone(),
        parent: Some(outer.meta.path.clone()),
    };
    set_mode(&k, AgentMode::Review);
    let id = pending(k.agent_run(&s, &nest, NOW).unwrap());
    assert_eq!(k.read(&free.meta.path).unwrap().meta.parent, None);
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(k.read(&free.meta.path).unwrap().meta.parent, outer.meta.id);
    // The order too: a proposal in Review, and the same bytes once accepted.
    let order = AgentOp::ReorderChildren {
        parent: outer.meta.path.clone(),
        ids: vec![id_of(&free), id_of(&inner)],
    };
    let id = pending(k.agent_run(&s, &order, NOW).unwrap());
    assert!(
        k.read(&outer.meta.path)
            .unwrap()
            .meta
            .children_order
            .is_empty()
    );
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(
        k.read(&outer.meta.path).unwrap().meta.children_order,
        [id_of(&free), id_of(&inner)]
    );
}

#[test]
fn the_structure_ops_are_in_the_batch_registry() {
    for name in ["set_parent", "reorder_children", "set_tag_views"] {
        assert!(kasten_core::batch::BATCHABLE.contains(&name), "{name}");
    }
    for name in ["create_project", "set_project_state"] {
        assert!(!kasten_core::batch::BATCHABLE.contains(&name), "{name}");
    }
}

#[test]
fn a_sub_page_is_moved_and_reordered_in_one_batch_that_is_one_commit_and_one_undo() {
    let (t, k, s) = open();
    let holder = page(&k, "Holder", Some("photo-organiser"), None);
    let first = page(&k, "First", None, Some(&holder.meta.path));
    let loose = page(&k, "Loose", None, None);
    let loose_note = page(&k, "Loose child", None, Some(&loose.meta.path));
    let before = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let order = vec![id_of(&loose), id_of(&first), id_of(&holder)];

    let ops = vec![
        AgentOp::SetParent {
            path: loose.meta.path.clone(),
            parent: Some(holder.meta.path.clone()),
        },
        AgentOp::ReorderChildren {
            parent: holder.meta.path.clone(),
            ids: order.clone(),
        },
    ];
    let told = done(k.agent_run(&s, &batch(ops), NOW).unwrap());
    assert_eq!(told["changes"], 2);
    assert_eq!(commits(&k), commits_before + 1, "one commit for both");
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(head.op.as_deref(), Some("batch"));

    // The page and its own sub-page moved into the project, and the order is kept.
    let moved = "projects/photo-organiser/pages/loose.md";
    let moved_child = "projects/photo-organiser/pages/loose-child.md";
    assert!(k.vault_has(moved) && k.vault_has(moved_child));
    assert!(!k.vault_has(&loose.meta.path) && !k.vault_has(&loose_note.meta.path));
    let holder_now = k.read(&holder.meta.path).unwrap();
    assert_eq!(
        holder_now.meta.children_order,
        vec![id_of(&loose), id_of(&first)],
        "the holder's own id and strangers are not sub-pages"
    );
    assert_eq!(k.read(moved).unwrap().meta.parent, holder_now.meta.id);

    // One undo takes the lot back, to the byte.
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(undone.reverted.len(), 1);
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn one_refused_change_in_a_structure_batch_changes_nothing() {
    let (t, k, s) = open();
    let outer = page(&k, "Outer", None, None);
    let inner = page(&k, "Inner", None, Some(&outer.meta.path));
    let free = page(&k, "Free", None, None);
    let before = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let ops = vec![
        AgentOp::SetParent {
            path: free.meta.path.clone(),
            parent: Some(outer.meta.path.clone()),
        },
        AgentOp::SetParent {
            path: outer.meta.path.clone(),
            parent: Some(inner.meta.path.clone()),
        },
    ];
    let err = k.agent_run(&s, &batch(ops), NOW).unwrap_err().to_string();
    assert!(
        err.contains("Change 2 of 2 (set_parent)") && err.contains("inside itself"),
        "{err}"
    );
    assert_eq!(snapshot(t.vault.root()), before);
    assert_eq!(commits(&k), commits_before);
}

#[test]
fn a_failure_part_way_through_a_structure_batch_puts_every_file_back() {
    let (t, k, s) = open();
    let holder = page(&k, "Holder", Some("photo-organiser"), None);
    let loose = page(&k, "Loose", None, None);
    let before = snapshot(t.vault.root());
    let commits_before = commits(&k);
    let ops = vec![
        AgentOp::SetParent {
            path: loose.meta.path.clone(),
            parent: Some(holder.meta.path.clone()),
        },
        AgentOp::ReorderChildren {
            parent: holder.meta.path.clone(),
            ids: vec![id_of(&loose)],
        },
    ];
    k.fail_batch_after(1);
    assert!(k.agent_run(&s, &batch(ops), NOW).is_err());
    assert_eq!(snapshot(t.vault.root()), before);
    assert_eq!(commits(&k), commits_before);
}

#[test]
fn review_everything_holds_a_structure_batch_as_one_proposal() {
    let (t, k, s) = open();
    let holder = page(&k, "Holder", Some("photo-organiser"), None);
    let loose = page(&k, "Loose", None, None);
    set_mode(&k, AgentMode::Review);
    let before = snapshot(t.vault.root());
    let ops = vec![
        AgentOp::SetParent {
            path: loose.meta.path.clone(),
            parent: Some(holder.meta.path.clone()),
        },
        AgentOp::ReorderChildren {
            parent: holder.meta.path.clone(),
            ids: vec![id_of(&loose)],
        },
    ];
    let id = pending(k.agent_run(&s, &batch(ops), NOW).unwrap());
    assert_eq!(k.proposals().unwrap().len(), 1);
    let kept = snapshot(t.vault.root());
    // Only the proposal's own file differs from before.
    assert_eq!(kept.len(), before.len() + 1);
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(k.vault_has("projects/photo-organiser/pages/loose.md"));
    // The batch was one commit (the proposal's move to the archive is the other).
    let log = k.log(None, 3).unwrap();
    assert_eq!(
        log.iter()
            .filter(|c| c.op.as_deref() == Some("batch"))
            .count(),
        1,
        "{log:?}"
    );
}
