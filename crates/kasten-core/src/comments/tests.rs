use super::*;

fn anchor(section: &str, nth: u32) -> Anchor {
    Anchor {
        section: section.to_owned(),
        nth,
        quote: None,
        prefix: None,
        suffix: None,
    }
}

fn new(text: &str) -> NewComment {
    NewComment {
        anchor: anchor("Method", 1),
        text: text.to_owned(),
    }
}

#[test]
fn names_the_sidecar_beside_its_page() {
    assert_eq!(
        sidecar_of("projects/x/pages/plan.md").unwrap(),
        "projects/x/pages/plan.comments.json"
    );
    assert!(sidecar_of("projects/x/boards/b.canvas").is_err());
}

#[test]
fn an_empty_file_has_a_format_and_no_comments() {
    assert_eq!(
        Comments::new().to_text(),
        "{\n  \"format\": \"kasten-comments\",\n  \"comments\": []\n}\n"
    );
    assert!(Comments::parse("{}").unwrap().comments().is_empty());
    assert!(Comments::parse("[]").is_err());
    assert!(Comments::parse(r#"{"comments": 3}"#).is_err());
    assert!(Comments::parse("not json").is_err());
}

#[test]
fn adds_a_comment_a_line_and_reads_it_back() {
    let mut file = Comments::new();
    let mut with_quote = new("Enough for crops?");
    with_quote.anchor.quote = Some("perceptual hash".to_owned());
    with_quote.anchor.prefix = Some("Use a ".to_owned());
    with_quote.anchor.suffix = Some(" to score".to_owned());
    let added = file
        .add("c-1", &with_quote, "you", "2026-10-10T09:12:00+02:00")
        .unwrap();
    assert_eq!(added.author, "you");
    assert_eq!(added.anchor.quote.as_deref(), Some("perceptual hash"));
    file.add(
        "c-2",
        &new("  Add the table  "),
        "agent:claude-code",
        "later",
    )
    .unwrap();
    let text = file.to_text();
    assert_eq!(text.lines().filter(|l| l.contains("\"id\"")).count(), 2);
    let again = Comments::parse(&text).unwrap().comments();
    assert_eq!(again.len(), 2);
    assert_eq!(again[1].text, "Add the table");
    assert_eq!(again[1].author, "agent:claude-code");
    assert_eq!(again[0].anchor.suffix.as_deref(), Some(" to score"));
}

#[test]
fn refuses_what_cannot_be_kept() {
    let mut file = Comments::new();
    assert!(file.add("c-1", &new("   "), "you", "t").is_err());
    assert!(
        file.add("c-1", &new(&"x".repeat(MAX_TEXT + 1)), "you", "t")
            .is_err()
    );
    let mut bad = new("ok");
    bad.anchor.nth = 0;
    assert!(file.add("c-1", &bad, "you", "t").is_err());
    let mut bad = new("ok");
    bad.anchor.section = "two\nlines".to_owned();
    assert!(file.add("c-1", &bad, "you", "t").is_err());
    let mut bad = new("ok");
    bad.anchor.quote = Some("q".repeat(MAX_QUOTE + 1));
    assert!(file.add("c-1", &bad, "you", "t").is_err());
    assert!(file.comments().is_empty());
}

#[test]
fn keeps_keys_it_does_not_know() {
    let text = r#"{"format": "kasten-comments", "zzz": {"a": 1}, "comments": [
  {"id": "c-1", "anchor": {"section": "A", "nth": 1, "future": true}, "text": "t", "author": "you", "created": "x", "color": "red"},
  {"no_id": true}
]}"#;
    let mut file = Comments::parse(text).unwrap();
    assert_eq!(file.comments().len(), 1);
    file.resolve("c-1", Some(("now", "you"))).unwrap();
    file.reanchor("c-1", &anchor("B", 2)).unwrap();
    file.add("c-2", &new("more"), "you", "later").unwrap();
    let out = file.to_text();
    assert!(out.contains("\"zzz\": {\"a\": 1}"), "{out}");
    assert!(out.contains("\"color\": \"red\""), "{out}");
    assert!(out.contains("\"future\": true"), "{out}");
    assert!(out.contains("{\"no_id\": true}"), "{out}");
}

#[test]
fn resolves_and_reopens_and_says_when_nothing_changed() {
    let mut file = Comments::new();
    file.add("c-1", &new("hm"), "you", "t").unwrap();
    let (resolved, changed) = file.resolve("c-1", Some(("T1", "you"))).unwrap();
    assert!(changed);
    assert_eq!(
        resolved.resolved,
        Some(Resolved {
            at: "T1".to_owned(),
            by: "you".to_owned()
        })
    );
    // Resolving again keeps who and when.
    let (again, changed) = file.resolve("c-1", Some(("T2", "agent:x"))).unwrap();
    assert!(!changed);
    assert_eq!(again.resolved.unwrap().at, "T1");
    let (open, changed) = file.resolve("c-1", None).unwrap();
    assert!(changed && open.resolved.is_none());
    assert!(!file.resolve("c-1", None).unwrap().1);
    assert!(file.resolve("nope", None).is_err());
}

#[test]
fn moves_a_comment_to_another_place() {
    let mut file = Comments::new();
    let mut first = new("hm");
    first.anchor.quote = Some("old words".to_owned());
    file.add("c-1", &first, "you", "t").unwrap();
    let mut to = anchor("Results", 2);
    to.quote = Some("new words".to_owned());
    let (moved, changed) = file.reanchor("c-1", &to).unwrap();
    assert!(changed);
    assert_eq!(moved.anchor, to);
    assert!(!file.reanchor("c-1", &to).unwrap().1);
    // The quote can go: the comment is then about the section.
    let (bare, _) = file.reanchor("c-1", &anchor("Results", 2)).unwrap();
    assert_eq!(bare.anchor.quote, None);
    assert!(file.reanchor("c-1", &anchor("Results", 0)).is_err());
}

#[test]
fn reads_hand_written_entries_leniently() {
    let file = Comments::parse(
        r#"{"comments": [{"id": "a", "text": "no anchor"}, {"id": "b", "anchor": {"nth": 0}, "resolved": true}, {"id": "bad id", "text": "x"}]}"#,
    )
    .unwrap();
    let all = file.comments();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].anchor, anchor("", 1));
    assert!(all[1].resolved.is_some());
    assert_eq!(all[1].anchor.nth, 1);
}

#[test]
fn an_id_that_cannot_sit_in_a_file_name_is_refused() {
    let mut file = Comments::new();
    assert!(file.add("not an id", &new("x"), "you", "t").is_err());
    assert!(file.add("", &new("x"), "you", "t").is_err());
    assert!(file.comments().is_empty());
}

#[test]
fn a_page_keeps_a_limited_number_of_comments() {
    let mut file = Comments::new();
    for n in 0..MAX_COMMENTS {
        file.add(&format!("c-{n}"), &new("x"), "you", "t").unwrap();
    }
    assert!(file.add("c-over", &new("x"), "you", "t").is_err());
}
