use super::*;

#[test]
fn the_default_database_is_the_one_a_first_capture_makes() {
    // New vaults are given this file with the other default tags, and a
    // vault without it gets the same text from its first capture.
    let made = crate::tags::schema_yaml(TAG, &schema()).unwrap();
    assert_eq!(made, include_str!("../../defaults/tags/capture.yaml"));
}

#[test]
fn text_becomes_paragraphs_that_start_no_block() {
    assert_eq!(
        paragraphs("a\r\nb\n\n\n# c\n- d\n1. e\n> f\n```\nplain"),
        "a  \nb\n\n\\# c  \n\\- d  \n\\1. e  \n\\> f  \n\\```  \nplain"
    );
    assert_eq!(paragraphs(" \n\t\n"), "");
}

#[test]
fn a_long_selection_is_quoted_in_whole_paragraphs() {
    let checked = Checked {
        url: "https://example.com/x".to_owned(),
        title: "T".to_owned(),
        site: "example.com".to_owned(),
        via: "browser".to_owned(),
        tags: Vec::new(),
        markdown: Some(format!(
            "{}\n\n{}\n",
            "a".repeat(40_000),
            "b".repeat(40_000)
        )),
    };
    let text = quote(&checked, "2026-09-24");
    assert!(text.contains("*The rest of the selection was left out.*"));
    assert!(!text.contains('b'.to_string().repeat(100).as_str()));
    assert!(text.ends_with("> — [T](https://example.com/x), 2026-09-24"));
}
