use super::*;

const DECK: &str = r#"{
  "format": "kasten-deck",
  "formatVersion": 1,
  "slides": [
    {"id": "s1", "elements": [
      {"id": "c1", "type": "citation", "keys": ["a", "b"]},
      {"id": "g", "type": "group", "children": [{"id": "c2", "type": "citation", "keys": ["a"]}]},
      {"id": "t", "type": "text", "keys": ["a"]}
    ]}
  ],
  "theme": {"layouts": [{"name": "x", "elements": [{"id": "l", "type": "citation", "keys": ["a", "z"]}]}]},
  "title": "Talk"
}"#;

#[test]
fn a_key_is_counted_on_the_slides_and_in_the_layouts_apart() {
    assert_eq!(
        cited(DECK, "a"),
        Cited {
            slides: 2,
            layouts: 1
        }
    );
    assert_eq!(
        cited(DECK, "b"),
        Cited {
            slides: 1,
            layouts: 0
        }
    );
    assert_eq!(
        cited(DECK, "z"),
        Cited {
            slides: 0,
            layouts: 1
        }
    );
    assert_eq!(cited(DECK, "nobody"), Cited::default());
    assert_eq!(cited("not json", "a"), Cited::default());
    assert_eq!(keys(DECK).into_iter().collect::<Vec<_>>(), ["a", "b", "z"]);
}

#[test]
fn only_citation_elements_name_keys() {
    // The text element has a `keys` list too, and it is not a citation.
    assert!(
        keys(
            r#"{"slides": [{"id": "s", "elements": [{"id": "t", "type": "text", "keys": ["x"]}]}]}"#
        )
        .is_empty()
    );
}

#[test]
fn a_new_text_that_only_swaps_the_key_on_the_slides_is_the_same_but_for_keys() {
    let new = DECK
        .replace(r#""keys": ["a", "b"]"#, r#""keys": ["n", "b"]"#)
        .replace(
            r#"{"id": "c2", "type": "citation", "keys": ["a"]}"#,
            r#"{"id": "c2", "type": "citation", "keys": ["n"]}"#,
        );
    assert!(same_but_keys(DECK, &new, "a", "n"));
    // Other spacing, other order of keys, another format version number.
    let reordered = r#"{"title": "Talk", "slides": [{"elements": [{"keys": ["n", "b"], "type": "citation", "id": "c1"}, {"children": [{"keys": ["n"], "type": "citation", "id": "c2"}], "type": "group", "id": "g"}, {"keys": ["a"], "type": "text", "id": "t"}], "id": "s1"}], "theme": {"layouts": [{"name": "x", "elements": [{"id": "l", "type": "citation", "keys": ["a", "z"]}]}]}, "formatVersion": 2, "format": "kasten-deck"}"#;
    assert!(same_but_keys(DECK, reordered, "a", "n"));
}

#[test]
fn anything_else_different_is_not() {
    let swapped = DECK
        .replace(r#""keys": ["a", "b"]"#, r#""keys": ["n", "b"]"#)
        .replace(
            r#"{"id": "c2", "type": "citation", "keys": ["a"]}"#,
            r#"{"id": "c2", "type": "citation", "keys": ["n"]}"#,
        );
    assert!(
        !same_but_keys(DECK, DECK, "a", "n"),
        "the key was not swapped"
    );
    assert!(!same_but_keys(
        DECK,
        &swapped.replace("Talk", "Other"),
        "a",
        "n"
    ));
    assert!(
        !same_but_keys(
            DECK,
            &swapped.replace(
                r#""type": "text", "keys": ["a"]"#,
                r#""type": "text", "keys": ["n"]"#
            ),
            "a",
            "n"
        ),
        "the text element is not a citation"
    );
    assert!(
        !same_but_keys(
            DECK,
            &swapped.replace(r#""keys": ["a", "z"]"#, r#""keys": ["n", "z"]"#),
            "a",
            "n"
        ),
        "a layout's citation is left as it was"
    );
    assert!(!same_but_keys(
        DECK,
        &swapped.replace(r#""keys": ["n", "b"]"#, r#""keys": ["n"]"#),
        "a",
        "n"
    ));
    assert!(!same_but_keys(DECK, "{}", "a", "n"));
    assert!(!same_but_keys("nonsense", &swapped, "a", "n"));
}

#[test]
fn a_key_that_is_there_already_is_not_repeated() {
    let new = r#"{"format": "kasten-deck", "formatVersion": 1, "slides": [{"id": "s", "elements": [{"id": "c", "type": "citation", "keys": ["b", "a"]}]}]}"#;
    let old = r#"{"format": "kasten-deck", "formatVersion": 1, "slides": [{"id": "s", "elements": [{"id": "c", "type": "citation", "keys": ["a", "b", "n"]}]}]}"#;
    assert!(
        !same_but_keys(old, new, "a", "n"),
        "order is kept: [n, b] is not [b, a]"
    );
    let kept = r#"{"format": "kasten-deck", "formatVersion": 1, "slides": [{"id": "s", "elements": [{"id": "c", "type": "citation", "keys": ["n", "b"]}]}]}"#;
    assert!(same_but_keys(old, kept, "a", "n"));
}

#[test]
fn swapping_a_key_in_a_deck_that_comes_in_changes_slides_and_layouts() {
    let swapped = swap_keys(DECK, "a", "n").unwrap();
    assert_eq!(cited(&swapped, "a"), Cited::default());
    assert_eq!(
        cited(&swapped, "n"),
        Cited {
            slides: 2,
            layouts: 1
        }
    );
    assert!(swapped.ends_with("}\n"));
    assert_eq!(swap_keys(DECK, "nobody", "n"), None);
    assert_eq!(swap_keys("not json", "a", "n"), None);
}
