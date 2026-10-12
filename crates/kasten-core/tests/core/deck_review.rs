//! Deck changes that wait for review: what a proposal shows, accepting it
//! (merged with what a person did meanwhile), rejecting it, a deck sent to
//! the trash, and a deck an agent makes.

use crate::common::NOW;
use crate::deck_support::{SIX, deck, edit, marked, open, pending, with_slide};

use kasten_core::agent::{AgentOp, ProposalStatus};
use kasten_core::history::Actor;
use kasten_core::{Error, Outcome};
use serde_json::json;

fn make(title: &str, project: Option<&str>, text: &str) -> AgentOp {
    AgentOp::CreateDeck {
        title: title.into(),
        project: project.map(str::to_owned),
        tool: "create_deck".into(),
        text: text.into(),
        sent: 300,
        marked: None,
    }
}

#[test]
fn a_proposal_says_what_it_does_and_keeps_both_versions_in_its_op() {
    let (_t, k, s, path, text) = open();
    let four_gone = deck("Tool use", &SIX[4..]);
    let waiting = k
        .agent_run(&s, &edit(&path, &text, &four_gone), NOW)
        .unwrap();
    let (id, _) = pending(&waiting);
    let proposal = k.proposals().unwrap().remove(0);
    assert_eq!(proposal.id, id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
    // In words for the review: what goes, by the slides' own titles.
    assert!(
        proposal
            .diff
            .starts_with("Update elements: removes 4 slides"),
        "{}",
        proposal.diff
    );
    assert!(
        proposal.diff.contains("“Intro”") && proposal.diff.contains("“Data”"),
        "{}",
        proposal.diff
    );
    // The op holds the two versions the review draws; the proposal's own text fields stay empty.
    assert_eq!(
        (proposal.before.as_deref(), proposal.after.as_deref()),
        (None, None)
    );
    let stored = serde_json::to_value(&proposal.op).unwrap();
    assert_eq!(stored["kind"], json!("edit_deck"));
    assert_eq!(stored["base"], json!(text));
    assert_eq!(stored["text"], json!(four_gone));
    let back: AgentOp = serde_json::from_value(stored).unwrap();
    assert_eq!(back, proposal.op);
}

#[test]
fn accepting_writes_the_change_as_the_agents_with_the_approval_in_the_commit() {
    let (_t, k, s, path, text) = open();
    let four_gone = deck("Tool use", &SIX[4..]);
    let waiting = k
        .agent_run(&s, &edit(&path, &text, &four_gone), NOW)
        .unwrap();
    let (id, _) = pending(&waiting);
    let id = id.to_owned();
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(k.deck(&path).unwrap().text, four_gone);
    let commits = k.log(Some(&path), 2).unwrap();
    let last = &commits[0];
    assert_eq!(last.author, "agent:claude-code");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert_eq!(last.approved_by.as_deref(), Some("me"));
    assert_eq!(last.op.as_deref(), Some("update_elements"));
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn accepting_merges_with_edits_a_person_made_meanwhile() {
    let (_t, k, s, path, text) = open();
    let four_gone = deck("Tool use", &SIX[4..]);
    let waiting = k
        .agent_run(&s, &edit(&path, &text, &four_gone), NOW)
        .unwrap();
    let id = pending(&waiting).0.to_owned();
    // While the proposal waits, the person retitles a slide it keeps.
    let hash = k.deck(&path).unwrap().hash;
    k.save_deck(
        &Actor::Human,
        &path,
        &text.replace("Thanks", "Thank you"),
        &hash,
        NOW,
    )
    .unwrap();
    k.accept_proposal(&id, "me", NOW).unwrap();
    let now_there = k.deck(&path).unwrap().text;
    assert!(now_there.contains("Thank you"), "{now_there}");
    assert!(
        !now_there.contains("Intro") && !now_there.contains("Data"),
        "{now_there}"
    );
    assert!(now_there.contains("Limits"), "{now_there}");
}

#[test]
fn accepting_stops_where_the_edits_overlap_and_the_proposal_stays_to_decide() {
    let (_t, k, s, path, text) = open();
    let four_gone = deck("Tool use", &SIX[4..]);
    let waiting = k
        .agent_run(&s, &edit(&path, &text, &four_gone), NOW)
        .unwrap();
    let id = pending(&waiting).0.to_owned();
    // The person edits a slide the proposal deletes.
    let hash = k.deck(&path).unwrap().hash;
    let edited = text.replace("Method", "Method, rewritten");
    k.save_deck(&Actor::Human, &path, &edited, &hash, NOW)
        .unwrap();
    let err = k.accept_proposal(&id, "me", NOW).unwrap_err();
    assert!(
        err.to_string().contains("changed on the same lines"),
        "{err}"
    );
    assert_eq!(
        k.deck(&path).unwrap().text,
        edited,
        "the person's version is untouched"
    );
    assert_eq!(k.proposals().unwrap().len(), 1, "still there to reject");
    k.reject_proposal(&id, "me", NOW).unwrap();
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn rejecting_writes_nothing_and_archives_the_proposal() {
    let (t, k, s, path, text) = open();
    let four_gone = deck("Tool use", &SIX[4..]);
    let waiting = k
        .agent_run(&s, &edit(&path, &text, &four_gone), NOW)
        .unwrap();
    let id = pending(&waiting).0.to_owned();
    k.reject_proposal(&id, "me", NOW).unwrap();
    assert_eq!(k.deck(&path).unwrap().text, text);
    assert!(
        t.vault
            .root()
            .join(format!(".kasten/proposals/archive/{id}.json"))
            .is_file()
    );
}

#[test]
fn trashing_a_deck_always_waits_and_accepting_moves_it_to_the_trash() {
    let (_t, k, s, path, text) = open();
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    let trash = AgentOp::Trash {
        path: path.clone(),
        reason: Some("out of date".into()),
    };
    let waiting = k.agent_run(&s, &trash, NOW).unwrap();
    let (id, reason) = pending(&waiting);
    assert!(
        reason.contains("deck") && reason.contains("always"),
        "{reason}"
    );
    assert_eq!(
        k.deck(&path).unwrap().text,
        text,
        "not moved before the review"
    );
    // The reviewer is shown the deck that would go, and the agent's reason.
    let proposal = k.proposals().unwrap().remove(0);
    assert_eq!(proposal.before.as_deref(), Some(text.as_str()));
    assert_eq!(proposal.after, None);
    assert_eq!(proposal.note.as_deref(), Some("out of date"));
    assert!(
        proposal
            .diff
            .contains("Move the deck “Tool use” to the trash"),
        "{}",
        proposal.diff
    );
    let id = id.to_owned();
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(k.deck(&path).is_err());
    let trashed = k.list_trash().unwrap();
    let gone = trashed
        .iter()
        .find(|t| t.original == path)
        .expect("in the trash");
    assert_eq!(
        k.read_trashed(&gone.trashed).unwrap(),
        text,
        "nothing is lost"
    );
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(last.approved_by.as_deref(), Some("me"));
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
}

#[test]
fn a_deck_an_agent_makes_goes_to_the_library_or_a_project_and_never_over_another() {
    let (_t, k, s, _path, _text) = open();
    let text = deck("Q3 review", &SIX[..2]);
    let Outcome::Done { result } = k
        .agent_run(&s, &make("Q3 review", None, &text), NOW)
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(result["path"], json!("library/q3-review.deck"));
    let Outcome::Done { result } = k
        .agent_run(&s, &make("Q3 review", None, &text), NOW)
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(result["path"], json!("library/q3-review-2.deck"));
    let Outcome::Done { result } = k
        .agent_run(&s, &make("Q3 review", Some("photo-organiser"), &text), NOW)
        .unwrap()
    else {
        panic!()
    };
    let made = result["path"].as_str().unwrap().to_owned();
    assert_eq!(made, "projects/photo-organiser/decks/q3-review.deck");
    assert_eq!(
        k.deck(&made).unwrap().text,
        text,
        "byte for byte what the tool made"
    );
    let last = &k.log(Some(&made), 1).unwrap()[0];
    assert_eq!(last.author, "agent:claude-code");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert_eq!(last.op.as_deref(), Some("create_deck"));
    assert_eq!(last.summary, "deck: create Q3 review");
}

#[test]
fn a_deck_that_is_not_one_or_has_a_bad_title_or_project_is_refused_before_anything_is_written() {
    let (_t, k, s, _path, _text) = open();
    let before = k.decks().unwrap().len();
    let good = deck("Q3 review", &SIX[..2]);
    for (op, why) in [
        (make("Q3 review", None, "{}"), "Not a KastenFlow deck"),
        (make("A|B", None, &good), "title"),
        (make("   ", None, &good), "title"),
        (make("Q3 review", Some("nope"), &good), "nope"),
    ] {
        let err = k.agent_run(&s, &op, NOW).unwrap_err();
        assert!(matches!(err, Error::Invalid(_)), "{err:?}");
        assert!(err.to_string().contains(why), "{why}: {err}");
    }
    assert_eq!(k.decks().unwrap().len(), before);
    // Making a deck counts as a new note for the limit, and waits when it is over.
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 1;
    k.set_config(config).unwrap();
    assert!(matches!(
        k.agent_run(&s, &make("One", None, &good), NOW).unwrap(),
        Outcome::Done { .. }
    ));
    assert!(matches!(
        k.agent_run(&s, &make("Two", None, &good), NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
}

#[test]
fn an_agents_own_write_is_the_version_with_its_marks() {
    let (_t, k, s, path, text) = open();
    let more = with_slide(&text, "g", "Questions");
    let with_marks = with_slide(&text, "g", "Questions, badged");
    let op = marked(edit(&path, &text, &more), &with_marks);
    assert!(matches!(
        k.agent_run(&s, &op, NOW).unwrap(),
        Outcome::Done { .. }
    ));
    assert_eq!(k.deck(&path).unwrap().text, with_marks);
    // A new deck too.
    let plain = deck("Q3 review", &SIX[..2]);
    let badged = deck("Q3 review, badged", &SIX[..2]);
    let Outcome::Done { result } = k
        .agent_run(&s, &marked(make("Q3 review", None, &plain), &badged), NOW)
        .unwrap()
    else {
        panic!("a new deck is made at once")
    };
    assert_eq!(
        k.deck(result["path"].as_str().unwrap()).unwrap().text,
        badged
    );
}

#[test]
fn a_proposal_keeps_both_versions_and_accepting_it_writes_the_one_without_the_marks() {
    let (_t, k, s, path, text) = open();
    let four_gone = deck("Tool use", &SIX[4..]);
    let badged = deck("Tool use, badged", &SIX[4..]);
    let op = marked(edit(&path, &text, &four_gone), &badged);
    let waiting = k.agent_run(&s, &op, NOW).unwrap();
    let (id, _) = pending(&waiting);
    let id = id.to_owned();
    assert_eq!(
        k.deck(&path).unwrap().text,
        text,
        "nothing is written before the review"
    );
    // What the review is shown is the change, not the marks.
    let proposal = k.proposals().unwrap().remove(0);
    assert!(
        proposal.diff.contains("removes 4 slides"),
        "{}",
        proposal.diff
    );
    let stored = serde_json::to_value(&proposal.op).unwrap();
    assert_eq!(stored["marked"], json!(badged));
    let back: AgentOp = serde_json::from_value(stored).unwrap();
    assert_eq!(back, proposal.op);
    // The person who accepts it has looked at it: the deck is the plain version.
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(k.deck(&path).unwrap().text, four_gone);
    // Proposals written before the marks existed read as they did.
    let old: AgentOp = serde_json::from_value(json!({
        "kind": "edit_deck", "path": path, "tool": "add_slide", "base": "{}", "text": "{ }"
    }))
    .unwrap();
    let AgentOp::EditDeck { marked, .. } = old else {
        panic!("an edit")
    };
    assert_eq!(marked, None);
}
