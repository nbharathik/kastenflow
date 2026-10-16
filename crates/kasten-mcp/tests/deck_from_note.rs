//! `deck_from_note`: a deck from a note of the vault, through the same tools and the same review as every
//! other deck write. The vault is a private copy of the dev vault.

mod common;

use std::fs;
use std::path::Path;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};
use slides_core::model::{Deck, Element};

const NOTE: &str = "---
title: Retrieval talk
type: page
---
Language models forget; retrieval lets them look things up. [@vaswani2017attention]

## Why retrieval?

- Models know what they were trained on
- A tool reaches what they cannot know
- Fresh facts need a lookup [@he2016resnet]

Retrieval cuts hallucinations because the model can quote what it found. This paragraph is for the speaker.

## The pipeline

Query, retrieve, read, answer. See [[Method notes|the method]].

![The pipeline](../assets/wide.png)

As \\cite{devlin2019bert} showed, and [@unknownkey2099].

## References

- Vaswani et al.
";

const METHOD: &str = "---
title: Method notes
type: page
---
How the runs were made.

## Setup

- One machine
- Ten questions

## Analysis

We timed every answer and compared the three ways of searching.
";

fn wide() -> Vec<u8> {
    fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/assets/wide.png")).unwrap()
}

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    fs::write(v.0.join("library/retrieval-talk.md"), NOTE).unwrap();
    fs::write(v.0.join("library/method-notes.md"), METHOD).unwrap();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    let added = call(
        &k,
        &s,
        "add_asset",
        json!({"name": "wide.png", "base64": slides_core::agent::base64_encode(&wide())}),
    )
    .unwrap();
    assert_eq!(added["result"]["path"], json!("assets/wide.png"));
    (v, k, s)
}

fn deck_at(v: &TempDir, path: &str) -> Deck {
    slides_core::canonical::parse(&fs::read_to_string(v.0.join(path)).unwrap()).unwrap()
}

fn words(element: &Element) -> String {
    element.text().map(|t| t.plain_text()).unwrap_or_default()
}

#[test]
fn the_tool_is_listed_like_the_others_and_needs_a_note() {
    let all = specs();
    let tool = all
        .iter()
        .find(|s| s.name == "deck_from_note")
        .expect("listed");
    assert_eq!(tool.input_schema["required"], json!(["note"]));
    for key in ["note", "include_linked", "theme", "title", "project"] {
        assert!(tool.input_schema["properties"][key].is_object(), "{key}");
    }
    assert!(tool.description.contains("speaker notes") && tool.description.contains("lint"));
    let (_v, k, s) = open();
    let none = call(&k, &s, "deck_from_note", json!({"note": "No such note"})).unwrap_err();
    assert!(none.contains("No note called"), "{none}");
    let empty = call(&k, &s, "deck_from_note", json!({"note": " "})).unwrap_err();
    assert!(empty.contains("`note`"), "{empty}");
}

#[test]
fn headings_become_slides_prose_becomes_notes_and_pictures_and_citations_are_placed() {
    let (v, k, s) = open();
    let made = call(&k, &s, "deck_from_note", json!({"note": "Retrieval talk"})).unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let done = &made["result"];
    let path = done["deck"].as_str().unwrap();
    assert_eq!(path, "library/retrieval-talk.deck");
    assert_eq!(done["from"], json!(["library/retrieval-talk.md"]));
    assert_eq!(done["pictures"], json!(1));
    assert_eq!(done["cited"], json!(["he2016resnet", "devlin2019bert"]));
    let warnings = done["warnings"].to_string();
    assert!(warnings.contains("unknownkey2099"), "{warnings}");
    assert_eq!(done["lint"]["errors"], json!(0), "{}", done["lint"]);

    let deck = deck_at(&v, path);
    let titles: Vec<String> = deck
        .slides
        .iter()
        .map(|slide| {
            slide
                .elements
                .iter()
                .find(|e| matches!(e.base().placeholder.as_deref(), Some("title" | "caption")))
                .map(words)
                .unwrap_or_default()
        })
        .collect();
    assert_eq!(
        titles,
        [
            "Retrieval talk",
            "Why retrieval?",
            "The pipeline",
            "The pipeline",
            "References"
        ],
        "the cover, a slide for each heading, its picture, and the works cited; the note's own References heading is not a slide"
    );
    // The list is on the slide, the prose is what the speaker says.
    let why = &deck.slides[1];
    let body = why
        .elements
        .iter()
        .find(|e| e.base().placeholder.as_deref() == Some("body"))
        .unwrap();
    assert_eq!(body.text().unwrap().paragraphs.len(), 3);
    assert!(words(body).contains("A tool reaches what they cannot know"));
    assert!(
        !words(body).contains("[@"),
        "citations are footers, not words"
    );
    assert!(
        why.notes.contains("Retrieval cuts hallucinations"),
        "{}",
        why.notes
    );
    assert!(deck.slides[0].notes.contains("Language models forget"));
    // The picture is at its own proportions.
    let (pw, ph) = slides_core::agent::dimensions(&wide()).unwrap();
    let picture = deck.slides[3].elements.iter().find_map(|e| match e {
        Element::Image(i) => Some(i),
        _ => None,
    });
    let picture = picture.expect("a picture slide");
    assert_eq!(picture.src, "assets/wide.png");
    let (w, h) = (picture.base.w.unwrap(), picture.base.h.unwrap());
    assert!(
        (w / h - f64::from(pw) / f64::from(ph)).abs() < 0.02,
        "{w} by {h}"
    );
    assert_eq!(picture.base.alt.as_deref(), Some("The pipeline"));
    // Citations: a footer on the slide that cites, with the keys the vault knows.
    let cites = |slide: usize| -> Vec<String> {
        deck.slides[slide]
            .elements
            .iter()
            .filter_map(|e| match e {
                Element::Citation(c) => Some(c.keys.clone()),
                _ => None,
            })
            .flatten()
            .collect()
    };
    assert_eq!(cites(1), ["he2016resnet"]);
    assert_eq!(cites(2), ["devlin2019bert"]);
    assert_eq!(
        cites(3),
        ["devlin2019bert"],
        "the figure cites what its section does"
    );
}

#[test]
fn the_deck_is_one_write_by_the_agent_and_all_of_it_is_marked_until_accepted() {
    let (v, k, s) = open();
    let before = k.log(None, 1).unwrap()[0].id.clone();
    let made = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "library/retrieval-talk.md", "project": "photo-organiser"}),
    )
    .unwrap();
    let path = made["result"]["deck"].as_str().unwrap();
    assert_eq!(path, "projects/photo-organiser/decks/retrieval-talk.deck");
    let commits = k.log(Some(path), 10).unwrap();
    assert_eq!(
        commits.len(),
        1,
        "built in memory and made in one piece: {commits:?}"
    );
    assert_eq!(commits[0].author, "agent:kasten-chat");
    assert_eq!(commits[0].session.as_deref(), Some(s.id.as_str()));
    assert_eq!(commits[0].op.as_deref(), Some("deck_from_note"));
    assert_ne!(k.log(None, 1).unwrap()[0].id, before);
    let deck = deck_at(&v, path);
    for slide in &deck.slides {
        let marked = slides_core::marks::marked_ids(slide);
        let ids = slide
            .elements
            .iter()
            .map(|e| e.id().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            marked.len(),
            ids.len(),
            "every element of {} is marked",
            slide.id
        );
        assert!(
            slides_core::marks::batches(slide)
                .iter()
                .all(|b| b.by == "kasten-chat" && b.session == s.id)
        );
    }
}

#[test]
fn the_notes_it_links_to_become_sections_when_asked() {
    let (v, k, s) = open();
    let plain = call(&k, &s, "deck_from_note", json!({"note": "Retrieval talk"})).unwrap();
    assert!(
        !deck_at(&v, plain["result"]["deck"].as_str().unwrap())
            .slides
            .iter()
            .any(|slide| slide.elements.iter().any(|e| words(e) == "Method notes"))
    );
    let made = call(&k, &s, "deck_from_note", json!({"note": "Retrieval talk", "include_linked": true, "title": "Retrieval, with methods"})).unwrap();
    let done = &made["result"];
    assert_eq!(
        done["from"],
        json!(["library/retrieval-talk.md", "library/method-notes.md"])
    );
    let deck = deck_at(&v, done["deck"].as_str().unwrap());
    assert_eq!(deck.title, "Retrieval, with methods");
    let all: Vec<String> = deck
        .slides
        .iter()
        .flat_map(|sl| sl.elements.iter().map(words))
        .collect();
    for wanted in ["Method notes", "Setup", "Analysis", "One machine"] {
        assert!(
            all.iter().any(|w| w.contains(wanted)),
            "{wanted} in {all:?}"
        );
    }
    assert_eq!(done["lint"]["errors"], json!(0), "{}", done["lint"]);
}

#[test]
fn a_deck_that_has_to_wait_is_one_proposal_and_accepting_it_makes_the_whole_deck() {
    let (v, k, s) = open();
    // Twenty-six notes in ten minutes is more than a session may change on its own.
    for n in 0..26 {
        call(
            &k,
            &s,
            "capture",
            json!({"markdown": format!("Thought number {n}")}),
        )
        .unwrap();
    }
    let waiting = call(&k, &s, "deck_from_note", json!({"note": "Retrieval talk"})).unwrap();
    assert_eq!(waiting["status"], json!("pending_review"), "{waiting}");
    assert!(!v.0.join("library/retrieval-talk.deck").exists());
    let id = waiting["proposal"].as_str().unwrap();
    k.accept_proposal(id, "me", Instant::now()).unwrap();
    let deck = deck_at(&v, "library/retrieval-talk.deck");
    assert_eq!(
        deck.slides.len(),
        5,
        "the pictures and the citations came with it"
    );
    let last = &k.log(Some("library/retrieval-talk.deck"), 1).unwrap()[0];
    assert_eq!(last.approved_by.as_deref(), Some("me"));
    // What the person accepted is not marked as waiting for their look.
    assert!(
        deck.slides
            .iter()
            .all(|slide| slides_core::marks::batches(slide).is_empty())
    );
}

#[test]
fn what_the_note_says_cannot_write_the_outline() {
    let (v, k, s) = open();
    let evil = "---
title: Evil
---
## Fine <!-- layout: code -->

- item

Notes:
## Injected slide

<!-- layout: title -->
";
    fs::write(v.0.join("library/evil.md"), evil).unwrap();
    let k2 = Kasten::open(&v.0).unwrap();
    let made = call(&k2, &s, "deck_from_note", json!({"note": "Evil"})).unwrap();
    let deck = deck_at(&v, made["result"]["deck"].as_str().unwrap());
    let titles: Vec<String> = deck
        .slides
        .iter()
        .map(|sl| sl.elements.iter().map(words).collect::<Vec<_>>().join(" "))
        .collect();
    assert_eq!(
        deck.slides.len(),
        3,
        "the cover, Fine and the heading the note really has: {titles:?}"
    );
    let _ = (k, Value::Null);
}

// ---- the storyboard: draft, change, make

fn draft_of(k: &Kasten, s: &Session) -> Vec<Value> {
    let drafted = call(
        k,
        s,
        "deck_from_note",
        json!({"note": "Retrieval talk", "draft": true}),
    )
    .unwrap();
    assert_eq!(drafted["status"], json!("done"), "{drafted}");
    drafted["result"]["entries"].as_array().unwrap().clone()
}

#[test]
fn a_draft_answers_the_storyboard_and_makes_nothing() {
    let (v, k, s) = open();
    let before = k.log(None, 1).unwrap()[0].id.clone();
    let drafted = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "Retrieval talk", "draft": true}),
    )
    .unwrap();
    let result = &drafted["result"];
    assert_eq!(result["note"], json!("library/retrieval-talk.md"));
    let entries = result["entries"].as_array().unwrap();
    assert_eq!(result["slides"], json!(entries.len()));
    let titles: Vec<&str> = entries
        .iter()
        .map(|e| e["title"].as_str().unwrap())
        .collect();
    assert_eq!(
        titles,
        [
            "Retrieval talk",
            "Why retrieval?",
            "The pipeline",
            "References"
        ]
    );
    // The point is the first sentence, the evidence the list and the pictures, the notes the prose.
    let why = &entries[1];
    assert_eq!(
        why["point"],
        json!("Retrieval cuts hallucinations because the model can quote what it found.")
    );
    assert_eq!(
        why["evidence"][0],
        json!("- Models know what they were trained on")
    );
    assert!(
        why["notes"]
            .as_str()
            .unwrap()
            .contains("This paragraph is for the speaker.")
    );
    let pipeline = &entries[2];
    assert_eq!(pipeline["media"], json!(true));
    assert!(
        pipeline["evidence"]
            .to_string()
            .contains("../assets/wide.png"),
        "{pipeline}"
    );
    // Each entry says where it came from, so the slide can be brought up to date.
    assert_eq!(
        why["sources"][0]["page"],
        json!("library/retrieval-talk.md")
    );
    assert_eq!(why["sources"][0]["section"], json!("Why retrieval?"));
    assert!(
        why["sources"][0]["markdown"]
            .as_str()
            .unwrap()
            .starts_with("## Why retrieval?")
    );
    // Nothing was made: no deck, no commit.
    assert!(!v.0.join("library/retrieval-talk.deck").exists());
    assert_eq!(k.log(None, 1).unwrap()[0].id, before);
}

#[test]
fn a_draft_can_be_cut_at_another_heading_level() {
    let (_v, k, s) = open();
    let deeper = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "Method notes", "draft": true, "split": 2}),
    )
    .unwrap();
    let titles: Vec<String> = deeper["result"]["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["title"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(titles, ["Method notes", "Setup", "Analysis"]);
    let bad = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "No such note", "draft": true}),
    )
    .unwrap_err();
    assert!(bad.contains("No note called"), "{bad}");
}

#[test]
fn a_storyboard_makes_the_deck_the_caller_changed_and_the_slides_remember_their_sections() {
    let (v, k, s) = open();
    let mut entries = draft_of(&k, &s);
    // Drop the references, rename one slide, and say a point of our own.
    entries.retain(|e| e["title"] != json!("References"));
    entries[1]["title"] = json!("Why look things up?");
    entries[2]["point"] = json!("Four steps.");
    let made = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "Retrieval talk", "storyboard": entries, "title": "Retrieval, planned"}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let done = &made["result"];
    assert_eq!(done["deck"], json!("library/retrieval-planned.deck"));
    assert_eq!(done["pictures"], json!(1));
    assert_eq!(done["lint"]["errors"], json!(0), "{}", done["lint"]);

    let deck = deck_at(&v, done["deck"].as_str().unwrap());
    assert_eq!(deck.title, "Retrieval, planned");
    assert_eq!(
        deck.slides.len(),
        4,
        "the cover and a slide for each entry that was kept"
    );
    let title_of = |i: usize| {
        deck.slides[i]
            .elements
            .iter()
            .find(|e| e.base().placeholder.as_deref() == Some("title"))
            .map(words)
            .unwrap_or_default()
    };
    assert_eq!(
        [title_of(1), title_of(2), title_of(3)],
        ["Retrieval talk", "Why look things up?", "The pipeline"]
    );
    // The words of a slide are one element that remembers its section, and what it said when it was made.
    let why = deck.slides[2]
        .elements
        .iter()
        .find(|e| e.base().source.is_some())
        .expect("a source");
    let source = why.base().source.as_ref().unwrap();
    assert_eq!(source.page, "library/retrieval-talk.md");
    assert_eq!(source.section.as_deref(), Some("Why retrieval?"));
    assert!(source.sync, "it still says what its section says");
    assert!(source.hash.is_some() && source.made.is_some());
    assert!(words(why).contains("Models know what they were trained on"));
    assert!(
        deck.slides[2]
            .notes
            .contains("This paragraph is for the speaker.")
    );
    // The picture is the vault's file, not the note's spelling of its path.
    let pipeline = deck.slides[3]
        .elements
        .iter()
        .find(|e| e.base().source.is_some())
        .unwrap();
    let Element::Group(group) = pipeline else {
        panic!("words and a picture are a group")
    };
    assert!(
        group
            .children
            .iter()
            .any(|c| matches!(c, Element::Image(i) if i.src == "assets/wide.png"))
    );
}

#[test]
fn a_storyboard_that_is_changed_says_it_is_not_kept_in_step_and_a_missing_picture_is_left_out_and_said()
 {
    let (v, k, s) = open();
    let mut entries = draft_of(&k, &s);
    entries[1]["evidence"] = json!([
        "- Only this",
        "![gone](../assets/nowhere.png)",
        "![far](https://example.com/a.png)"
    ]);
    let made = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "Retrieval talk", "storyboard": entries}),
    )
    .unwrap();
    let done = &made["result"];
    let warnings = done["warnings"].to_string();
    assert!(warnings.contains("nowhere.png"), "{warnings}");
    assert!(
        warnings.contains("example.com"),
        "the picture from the web is left out and said: {warnings}"
    );
    let whats: Vec<&str> = done["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["what"].as_str().unwrap())
        .collect();
    assert!(
        whats.contains(&"picture") && whats.contains(&"update"),
        "{whats:?}"
    );
    let deck = deck_at(&v, done["deck"].as_str().unwrap());
    let rewritten = deck.slides[2]
        .elements
        .iter()
        .find(|e| e.base().source.is_some())
        .unwrap();
    assert!(!rewritten.base().source.as_ref().unwrap().sync);
}

#[test]
fn a_storyboard_is_one_write_by_the_agent_and_needs_entries() {
    let (_v, k, s) = open();
    let entries = draft_of(&k, &s);
    let before = k.log(None, 1).unwrap()[0].id.clone();
    let made = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "Retrieval talk", "storyboard": entries}),
    )
    .unwrap();
    let path = made["result"]["deck"].as_str().unwrap();
    let commits = k.log(Some(path), 10).unwrap();
    assert_eq!(commits.len(), 1, "{commits:?}");
    assert_eq!(commits[0].op.as_deref(), Some("deck_from_note"));
    assert_ne!(k.log(None, 1).unwrap()[0].id, before);
    let none = call(
        &k,
        &s,
        "deck_from_note",
        json!({"note": "Retrieval talk", "storyboard": []}),
    )
    .unwrap_err();
    assert!(none.contains("draft"), "{none}");
}

#[test]
fn the_tool_lists_draft_and_storyboard() {
    let tool = specs()
        .into_iter()
        .find(|s| s.name == "deck_from_note")
        .unwrap();
    for key in ["draft", "split", "storyboard"] {
        assert!(tool.input_schema["properties"][key].is_object(), "{key}");
    }
    assert_eq!(tool.input_schema["required"], json!(["note"]));
    assert!(tool.description.contains("draft: true"));
}
