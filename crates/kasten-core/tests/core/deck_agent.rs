//! Agents and decks: the update that reads a deck, lets the caller change it
//! and writes it back under one hold of the write lock, and the guardrails
//! that weigh a deck change (size, review, trust).

use crate::common::NOW;
use crate::deck_support::{SIX, deck, edit, open, pending, with_slide};

use kasten_core::assets::NewAsset;
use kasten_core::deck::DeckSaved;
use kasten_core::history::Actor;
use kasten_core::{Error, Outcome};
use serde_json::json;

#[test]
fn an_update_reads_the_deck_as_it_is_and_commits_as_the_agent() {
    let (_t, k, s, path, text) = open();
    let more = deck("Tool use", &[&SIX[..], &[("g", "Questions")]].concat());
    let saved = k
        .update_deck(
            &s.actor(),
            &path,
            "add_diagram",
            "deck: edit Tool use § add diagram",
            NOW,
            |there| {
                assert_eq!(there.text, text);
                Ok(Some(more.clone()))
            },
        )
        .unwrap();
    let DeckSaved::Written { deck: written } = saved else {
        panic!("{saved:?}")
    };
    assert_eq!(written.text, more);
    assert_eq!(k.deck(&path).unwrap().hash, written.hash);
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(last.author, "agent:claude-code");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert_eq!(last.op.as_deref(), Some("add_diagram"));
    assert_eq!(last.summary, "deck: edit Tool use § add diagram");
    assert!(last.message.contains(&format!("Kasten-Session: {}", s.id)));
    assert!(last.message.contains("Kasten-Op: add_diagram"));
}

#[test]
fn an_update_starts_from_what_a_person_saved_a_moment_ago_and_makes_no_conflict_copy() {
    let (_t, k, s, path, text) = open();
    let hash = k.deck(&path).unwrap().hash;
    let person = text.replace("Method", "Method, edited by a person");
    k.save_deck(&Actor::Human, &path, &person, &hash, NOW)
        .unwrap();
    // The change is made to the deck as it is now, not to a version read earlier.
    let saved = k
        .update_deck(
            &s.actor(),
            &path,
            "set_text",
            "deck: edit Tool use",
            NOW,
            |there| {
                assert!(there.text.contains("Method, edited by a person"));
                Ok(Some(there.text.replace("Thanks", "Thank you")))
            },
        )
        .unwrap();
    assert!(matches!(saved, DeckSaved::Written { .. }), "{saved:?}");
    let now_there = k.deck(&path).unwrap().text;
    assert!(now_there.contains("Method, edited by a person"));
    assert!(now_there.contains("Thank you"));
    assert!(
        k.decks()
            .unwrap()
            .iter()
            .all(|d| !d.path.contains("conflict"))
    );
}

#[test]
fn updates_made_at_the_same_time_lose_neither_change() {
    let (_t, k, s, path, _text) = open();
    let start = std::sync::Barrier::new(4);
    std::thread::scope(|scope| {
        for n in 0..4 {
            let (k, s, path, start) = (&k, &s, &path, &start);
            scope.spawn(move || {
                start.wait();
                k.update_deck(&s.actor(), path, "add_slide", "deck: edit", NOW, |there| {
                    // Each adds its own slide to whatever is there when its turn comes.
                    Ok(Some(with_slide(
                        &there.text,
                        &format!("n{n}"),
                        &format!("Extra {n}"),
                    )))
                })
                .unwrap();
            });
        }
    });
    let after = k.deck(&path).unwrap().text;
    for n in 0..4 {
        assert!(after.contains(&format!("Extra {n}")), "{n} was lost");
    }
    assert!(
        k.decks()
            .unwrap()
            .iter()
            .all(|d| !d.path.contains("conflict"))
    );
}

#[test]
fn an_update_with_nothing_to_change_writes_and_commits_nothing() {
    let (_t, k, s, path, text) = open();
    let head = k.log(None, 1).unwrap()[0].id.clone();
    for change in [None, Some(text.clone())] {
        let saved = k
            .update_deck(
                &s.actor(),
                &path,
                "set_text",
                "deck: edit Tool use",
                NOW,
                |_| Ok(change.clone()),
            )
            .unwrap();
        assert!(matches!(saved, DeckSaved::Unchanged { .. }), "{saved:?}");
    }
    assert_eq!(k.log(None, 1).unwrap()[0].id, head);
    assert_eq!(k.deck(&path).unwrap().text, text);
}

#[test]
fn an_update_refuses_what_is_not_a_deck_and_leaves_the_file_alone() {
    let (_t, k, s, path, text) = open();
    let refused = k.update_deck(&s.actor(), &path, "set_text", "deck: edit", NOW, |_| {
        Ok(Some("{}".to_owned()))
    });
    match refused {
        Err(Error::Invalid(why)) => assert!(why.starts_with("Not a KastenFlow deck"), "{why}"),
        other => panic!("{other:?}"),
    }
    // A failure of the caller's own is passed on, with nothing written.
    let failed = k.update_deck(&s.actor(), &path, "set_text", "deck: edit", NOW, |_| {
        Err(Error::Invalid("There is no slide s-x".into()))
    });
    assert!(matches!(failed, Err(Error::Invalid(m)) if m.contains("no slide")));
    assert_eq!(k.deck(&path).unwrap().text, text);
}

#[test]
fn an_update_needs_a_deck_that_is_there() {
    let (_t, k, s, _path, _text) = open();
    let never = |_: &kasten_core::deck::DeckFile| -> kasten_core::Result<Option<String>> {
        panic!("nothing to change")
    };
    let missing = k.update_deck(&s.actor(), "library/none.deck", "x", "m", NOW, never);
    assert!(matches!(missing, Err(Error::NotFound(_))), "{missing:?}");
    let note = k.update_deck(
        &s.actor(),
        "library/welcome-to-kasten.md",
        "x",
        "m",
        NOW,
        never,
    );
    assert!(matches!(note, Err(Error::InvalidPath(_))), "{note:?}");
}

#[test]
fn a_small_edit_runs_as_the_agent_and_says_what_it_did() {
    let (_t, k, s, path, text) = open();
    let changed = text.replace("Thanks", "Thank you");
    let Outcome::Done { result } = k.agent_run(&s, &edit(&path, &text, &changed), NOW).unwrap()
    else {
        panic!("a title changed: that runs")
    };
    assert_eq!(result["path"], json!(path));
    assert_eq!(result["changed"], json!(true));
    assert_eq!(result["hash"], json!(k.deck(&path).unwrap().hash));
    assert_eq!(k.deck(&path).unwrap().text, changed);
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(last.author, "agent:claude-code");
    assert_eq!(last.op.as_deref(), Some("update_elements"));
    assert_eq!(last.summary, "deck: edit Tool use § update elements");
    // The same text again changes nothing and says so.
    let again = k
        .agent_run(&s, &edit(&path, &changed, &changed), NOW)
        .unwrap();
    let Outcome::Done { result } = again else {
        panic!()
    };
    assert_eq!(result["changed"], json!(false));
}

#[test]
fn deleting_more_slides_than_the_limit_waits_for_review_even_in_a_trusted_session() {
    let (_t, k, s, path, text) = open();
    // Three slides at once are within the limit.
    let three_gone = deck("Tool use", &SIX[3..]);
    assert!(matches!(
        k.agent_run(&s, &edit(&path, &text, &three_gone), NOW)
            .unwrap(),
        Outcome::Done { .. }
    ));
    let (_t2, k, s, path, text) = open();
    let four_gone = deck("Tool use", &SIX[4..]);
    let waiting = k
        .agent_run(&s, &edit(&path, &text, &four_gone), NOW)
        .unwrap();
    let (id, reason) = pending(&waiting);
    assert!(
        reason.contains("4 slides") && reason.contains("limit is 3"),
        "{reason}"
    );
    assert_eq!(
        k.deck(&path).unwrap().text,
        text,
        "nothing is written before the review"
    );
    let proposal = &k.proposals().unwrap()[0];
    assert_eq!(proposal.id, id);
    assert_eq!(proposal.target.as_ref().unwrap().path, path);
    assert_eq!(proposal.target.as_ref().unwrap().title, "Tool use");
    // Trust lifts the soft limits, not this one.
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    let again = k
        .agent_run(&s, &edit(&path, &text, &four_gone), NOW)
        .unwrap();
    assert!(matches!(again, Outcome::PendingReview { .. }), "{again:?}");
    assert_eq!(k.deck(&path).unwrap().text, text);
}

#[test]
fn the_limit_is_a_setting_that_is_really_enforced() {
    let (_t, k, s, path, text) = open();
    let mut config = k.config();
    assert_eq!(config.guardrails.max_slides_removed, 3);
    config.guardrails.max_slides_removed = 1;
    k.set_config(config).unwrap();
    let two_gone = deck("Tool use", &SIX[2..]);
    assert!(matches!(
        k.agent_run(&s, &edit(&path, &text, &two_gone), NOW)
            .unwrap(),
        Outcome::PendingReview { .. }
    ));
    let mut config = k.config();
    config.guardrails.max_slides_removed = 5;
    k.set_config(config).unwrap();
    let four_gone = deck("Tool use", &SIX[4..]);
    assert!(matches!(
        k.agent_run(&s, &edit(&path, &text, &four_gone), NOW)
            .unwrap(),
        Outcome::Done { .. }
    ));
}

#[test]
fn the_size_limit_measures_the_batch_not_the_deck() {
    let (_t, k, s, path, text) = open();
    // A deck can be far larger than one write may be: what counts is what was sent.
    let names: Vec<(String, String)> = (0..700)
        .map(|i| (format!("x{i}"), format!("Slide {i}")))
        .collect();
    let slides: Vec<(&str, &str)> = names
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    let big = deck("Tool use", &[&SIX[..], &slides].concat());
    assert!(big.len() > 200 * 1024, "{} bytes", big.len());
    assert!(matches!(
        k.agent_run(&s, &edit(&path, &text, &big), NOW).unwrap(),
        Outcome::Done { .. }
    ));
    // A batch of more than 200 KB is refused, and trust does not change that.
    let mut huge = edit(&path, &big, &text);
    if let kasten_core::agent::AgentOp::EditDeck { sent, .. } = &mut huge {
        *sent = 300 * 1024;
    }
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    let refused = k.agent_run(&s, &huge, NOW).unwrap_err();
    assert!(refused.to_string().contains("200 KB"), "{refused}");
    assert_eq!(k.deck(&path).unwrap().text, big);
}

#[test]
fn agents_cannot_write_decks_in_hidden_folders_templates_or_that_are_not_there() {
    let (_t, k, s, path, text) = open();
    for (bad, why) in [
        ("templates/talk.deck", "read-only"),
        (".kasten/talk.deck", "read-only"),
        ("library/none.deck", "library/none.deck"),
    ] {
        let err = k.agent_run(&s, &edit(bad, &text, &text), NOW).unwrap_err();
        assert!(err.to_string().contains(why), "{bad}: {err}");
    }
    // A deck whose text is not a deck is refused whatever the tool said.
    let err = k.agent_run(&s, &edit(&path, &text, "{}"), NOW).unwrap_err();
    assert!(
        err.to_string().starts_with("Not a KastenFlow deck"),
        "{err}"
    );
    assert_eq!(k.deck(&path).unwrap().text, text);
}

#[test]
fn decks_count_against_the_notes_per_time_limit_and_trust_lifts_it() {
    let (_t, k, s, path, text) = open();
    let other = k
        .create_deck(&Actor::Human, "Other", None, &deck("Other", &SIX), NOW)
        .unwrap();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 1;
    k.set_config(config).unwrap();
    let first = text.replace("Thanks", "Thank you");
    assert!(matches!(
        k.agent_run(&s, &edit(&path, &text, &first), NOW).unwrap(),
        Outcome::Done { .. }
    ));
    // The same deck again is not another one.
    let again = first.replace("Thank you", "Thank you all");
    assert!(matches!(
        k.agent_run(&s, &edit(&path, &first, &again), NOW).unwrap(),
        Outcome::Done { .. }
    ));
    let second = deck("Other", &SIX).replace("Thanks", "Thank you");
    let other_text = deck("Other", &SIX);
    let waiting = k
        .agent_run(&s, &edit(&other, &other_text, &second), NOW)
        .unwrap();
    let (_, reason) = pending(&waiting);
    assert!(reason.contains("in the last 10 minutes"), "{reason}");
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    assert!(matches!(
        k.agent_run(&s, &edit(&other, &other_text, &second), NOW)
            .unwrap(),
        Outcome::Done { .. }
    ));
}

#[test]
fn pictures_an_agent_adds_do_not_count_as_notes_changed() {
    let (_t, k, s, path, text) = open();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 3;
    k.set_config(config).unwrap();
    // A picture and its sidecar are two files, and neither is a note.
    for n in 0..6u8 {
        let name = format!("figure-{n}.png");
        k.add_asset(&s.actor(), &name, &[n + 1; 24], &NewAsset::default(), NOW)
            .unwrap();
    }
    let changed = text.replace("Thanks", "Thank you");
    assert!(matches!(
        k.agent_run(&s, &edit(&path, &text, &changed), NOW).unwrap(),
        Outcome::Done { .. }
    ));
}
