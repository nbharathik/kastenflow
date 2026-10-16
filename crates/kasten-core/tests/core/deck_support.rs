//! Decks for the agent-deck tests, in the form the Slides engine writes them
//! (sorted keys, two-space indent), so that a line-based merge sees what a
//! person and an agent each touched: every slide has lines of its own, and
//! every id is different.

use kasten_core::agent::{AgentOp, Session};
use kasten_core::{Kasten, Outcome};
use serde_json::{Value, json};

use crate::common::{self, NOW, dev_vault};

/// One slide: an id and the words of its title.
pub type Slide<'a> = (&'a str, &'a str);

fn slide(id: &str, words: &str) -> Value {
    json!({
        "elements": [{
            "id": format!("e-{id}"),
            "placeholder": "title",
            "text": { "paragraphs": [{ "runs": [{ "t": words }] }] },
            "type": "text",
        }],
        "id": format!("s-{id}"),
        "layout": "title-body",
    })
}

/// A deck's text with these slides.
pub fn deck(title: &str, slides: &[Slide]) -> String {
    let slides: Vec<Value> = slides.iter().map(|(id, words)| slide(id, words)).collect();
    let mut text = serde_json::to_string_pretty(&json!({
        "format": "kasten-deck",
        "formatVersion": 1,
        "id": "d-test0001",
        "size": { "h": 540, "w": 960 },
        "slides": slides,
        "title": title,
    }))
    .unwrap();
    text.push('\n');
    text
}

/// `text` with one more slide at the end.
pub fn with_slide(text: &str, id: &str, words: &str) -> String {
    let mut value: Value = serde_json::from_str(text).unwrap();
    value["slides"]
        .as_array_mut()
        .unwrap()
        .push(slide(id, words));
    let mut out = serde_json::to_string_pretty(&value).unwrap();
    out.push('\n');
    out
}

/// Six slides, `a` to `f`.
pub const SIX: [Slide<'static>; 6] = [
    ("a", "Intro"),
    ("b", "Method"),
    ("c", "Data"),
    ("d", "Results"),
    ("e", "Limits"),
    ("f", "Thanks"),
];

/// A private copy of the dev vault with history, an agent session, and a
/// deck of six slides made by a person; returns its path and text.
pub fn open() -> (common::TempVault, Kasten, Session, String, String) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let s = Session::start("claude-code", NOW);
    let text = deck("Tool use", &SIX);
    let path = k
        .create_deck(
            &kasten_core::history::Actor::Human,
            "Tool use",
            None,
            &text,
            NOW,
        )
        .unwrap();
    (t, k, s, path, text)
}

/// The edit of a deck from `base` to `text`, as a tool makes it.
pub fn edit(path: &str, base: &str, text: &str) -> AgentOp {
    AgentOp::EditDeck {
        path: path.into(),
        tool: "update_elements".into(),
        summary: "update elements".into(),
        base: base.into(),
        text: text.into(),
        sent: 200,
        marked: None,
    }
}

/// `op` with the version of the deck that carries the agent's marks, as the store of a connection makes it.
pub fn marked(mut op: AgentOp, with_marks: &str) -> AgentOp {
    if let AgentOp::EditDeck { marked, .. } | AgentOp::CreateDeck { marked, .. } = &mut op {
        *marked = Some(with_marks.to_owned());
    }
    op
}

/// The proposal an outcome made, or a failure saying what it was instead.
pub fn pending(outcome: &Outcome) -> (&str, &str) {
    match outcome {
        Outcome::PendingReview { proposal, reason } => (proposal, reason),
        other => panic!("expected a proposal, got {other:?}"),
    }
}
