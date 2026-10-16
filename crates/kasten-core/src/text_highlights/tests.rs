use super::*;

fn anchor(quote: &str) -> TextAnchor {
    TextAnchor {
        quote: quote.to_owned(),
        prefix: None,
        suffix: None,
        section: None,
    }
}

fn new(quote: &str, color: &str) -> NewTextHighlight {
    NewTextHighlight {
        anchor: anchor(quote),
        color: color.to_owned(),
        comment: None,
    }
}

#[test]
fn names_the_sidecar_beside_its_card() {
    assert_eq!(
        sidecar_of("inbox/an-article.md").unwrap(),
        "inbox/an-article.highlights.json"
    );
    assert!(sidecar_of("sources/x.pdf").is_err());
}

#[test]
fn an_empty_file_names_its_format() {
    assert_eq!(
        TextHighlights::new().to_text(),
        "{\n  \"format\": \"kasten-text-highlights\",\n  \"highlights\": []\n}\n"
    );
    assert!(TextHighlights::parse("[]").is_err());
    assert!(TextHighlights::parse(r#"{"highlights": "x"}"#).is_err());
    assert!(TextHighlights::parse("{}").unwrap().highlights().is_empty());
}

#[test]
fn adds_highlights_a_line_each_and_reads_them_back() {
    let mut file = TextHighlights::new();
    let mut first = new("the part marked", "yellow");
    first.anchor.prefix = Some("just before ".to_owned());
    first.anchor.suffix = Some(" just after".to_owned());
    first.anchor.section = Some("Method".to_owned());
    first.comment = Some("  check this  ".to_owned());
    let added = file
        .add("h-1", &first, "2026-10-10T09:12:00+02:00")
        .unwrap();
    assert_eq!(added.comment.as_deref(), Some("check this"));
    file.add("h-2", &new("another", "pink"), "later").unwrap();
    let text = file.to_text();
    assert_eq!(text.lines().filter(|l| l.contains("\"id\"")).count(), 2);
    let again = TextHighlights::parse(&text).unwrap().highlights();
    assert_eq!(again.len(), 2);
    assert_eq!(again[0].anchor, first.anchor);
    assert_eq!(again[1].color, "pink");
}

#[test]
fn refuses_what_cannot_be_kept() {
    let mut file = TextHighlights::new();
    assert!(file.add("h-1", &new("  ", "yellow"), "t").is_err());
    assert!(file.add("h-1", &new("words", "orange"), "t").is_err());
    assert!(
        file.add("h-1", &new(&"x".repeat(MAX_QUOTE + 1), "yellow"), "t")
            .is_err()
    );
    let mut long = new("words", "yellow");
    long.comment = Some("c".repeat(MAX_COMMENT + 1));
    assert!(file.add("h-1", &long, "t").is_err());
    assert!(file.highlights().is_empty());
}

#[test]
fn an_id_that_cannot_sit_in_a_file_name_is_refused() {
    let mut file = TextHighlights::new();
    assert!(file.add("not an id", &new("words", "pink"), "t").is_err());
    assert!(file.highlights().is_empty());
}

#[test]
fn edits_the_colour_and_the_comment() {
    let mut file = TextHighlights::new();
    let mut with_comment = new("words", "yellow");
    with_comment.comment = Some("hm".to_owned());
    file.add("h-1", &with_comment, "t").unwrap();
    let (edited, changed) = file
        .edit(
            "h-1",
            &TextHighlightEdit {
                color: Some("blue".to_owned()),
                comment: Some(String::new()),
            },
        )
        .unwrap();
    assert!(changed);
    assert_eq!((edited.color.as_str(), edited.comment), ("blue", None));
    let same = TextHighlightEdit {
        color: Some("blue".to_owned()),
        comment: None,
    };
    assert!(!file.edit("h-1", &same).unwrap().1);
    assert!(
        file.edit(
            "h-1",
            &TextHighlightEdit {
                color: Some("orange".to_owned()),
                comment: None
            }
        )
        .is_err()
    );
    assert!(file.edit("nope", &same).is_err());
}

#[test]
fn moves_a_highlight_and_removes_it() {
    let mut file = TextHighlights::new();
    file.add("h-1", &new("old words", "green"), "t").unwrap();
    file.add("h-2", &new("other", "green"), "t").unwrap();
    let mut to = anchor("new words");
    to.prefix = Some("before ".to_owned());
    let (moved, changed) = file.relocate("h-1", &to).unwrap();
    assert!(changed);
    assert_eq!(moved.anchor, to);
    assert!(!file.relocate("h-1", &to).unwrap().1);
    assert!(file.relocate("h-1", &anchor(" ")).is_err());

    let gone = file.remove("h-1").unwrap();
    assert_eq!(gone.anchor.quote, "new words");
    assert_eq!(file.highlights().len(), 1);
    assert!(file.remove("h-1").is_err());
}

#[test]
fn keeps_keys_it_does_not_know() {
    let text = r#"{"format": "kasten-text-highlights", "extra": [1, 2], "highlights": [
  {"id": "h-1", "anchor": {"quote": "q", "future": 1}, "color": "yellow", "note": "mine"},
  {"id": "no quote", "anchor": {}}
]}"#;
    let mut file = TextHighlights::parse(text).unwrap();
    assert_eq!(file.highlights().len(), 1);
    file.relocate("h-1", &anchor("q2")).unwrap();
    file.add("h-2", &new("z", "pink"), "t").unwrap();
    let out = file.to_text();
    assert!(out.contains("\"extra\": [1, 2]"), "{out}");
    assert!(out.contains("\"note\": \"mine\""), "{out}");
    assert!(out.contains("\"future\": 1"), "{out}");
    assert!(out.contains("\"id\": \"no quote\""), "{out}");
}
