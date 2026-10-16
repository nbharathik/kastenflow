//! The property that matters most: whatever is done to a deck, undoing it
//! puts back exactly the bytes there were, redoing gives the bytes there were
//! after, and the changes an operation reports are enough to bring a copy of
//! the deck up to date.
//!
//! This file holds the driver and its checks. The actions it does are in
//! `undo/actions.rs` (the `Action` enum and the strategy that picks them), and
//! `undo/plan.rs` maps each action to the operation it stands for, the table actions through
//! `undo/tables.rs` and the page and storyboard actions through `undo/pages.rs`.

mod actions;
mod pages;
mod plan;
mod tables;

use proptest::prelude::*;

use self::actions::{Action, action};
use self::plan::plan;
use super::bytes;
use crate::canonical;
use crate::model::Deck;
use crate::ops::{Changes, Engine};

fn check_mirror(mirror: &mut Deck, changes: &Changes, engine: &Engine) {
    changes.apply_to(mirror);
    assert_eq!(
        bytes(mirror),
        bytes(engine.deck()),
        "the reported changes bring a copy up to date"
    );
}

fn run(actions: &[Action]) {
    let mut engine = Engine::create("Property", "Light", 7).unwrap();
    let mut mirror = engine.deck().clone();
    let mut states = vec![bytes(engine.deck())];
    let mut at = 0;
    for action in actions {
        match action {
            Action::Undo => match engine.undo() {
                Some(changes) => {
                    assert!(at > 0, "an undo happened with nothing to undo");
                    at -= 1;
                    assert_eq!(
                        bytes(engine.deck()),
                        states[at],
                        "undo restores the bytes exactly"
                    );
                    check_mirror(&mut mirror, &changes, &engine);
                }
                None => assert_eq!(at, 0),
            },
            Action::Redo => match engine.redo() {
                Some(changes) => {
                    at += 1;
                    assert_eq!(
                        bytes(engine.deck()),
                        states[at],
                        "redo restores the bytes exactly"
                    );
                    check_mirror(&mut mirror, &changes, &engine);
                }
                None => assert_eq!(at + 1, states.len(), "a redo was possible"),
            },
            other => {
                let Some((name, input)) = plan(engine.deck(), other) else {
                    continue;
                };
                let before = bytes(engine.deck());
                match engine.apply(name, input) {
                    Ok(applied) => {
                        canonical::check_structure(engine.deck())
                            .unwrap_or_else(|e| panic!("{name} broke the deck: {e}"));
                        let text = bytes(engine.deck());
                        assert_eq!(
                            bytes(&canonical::parse(&text).unwrap()),
                            text,
                            "{name} left the deck writing back differently"
                        );
                        check_mirror(&mut mirror, &applied.changes, &engine);
                        if text != before {
                            states.truncate(at + 1);
                            states.push(text);
                            at += 1;
                        }
                    }
                    Err(_) => assert_eq!(
                        bytes(engine.deck()),
                        before,
                        "{name} failed and still changed the deck"
                    ),
                }
            }
        }
    }
    // Undo everything, then redo everything.
    let last = states.len() - 1;
    while engine.undo().is_some() {}
    assert_eq!(bytes(engine.deck()), states[0]);
    while engine.redo().is_some() {}
    assert_eq!(bytes(engine.deck()), states[last.min(states.len() - 1)]);
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, ..ProptestConfig::default() })]

    #[test]
    fn any_run_of_operations_can_be_undone_and_redone_exactly(actions in proptest::collection::vec(action(), 1..40)) {
        run(&actions);
    }
}
