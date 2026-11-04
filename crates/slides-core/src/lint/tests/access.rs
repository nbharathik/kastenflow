//! A picture that is only decoration says so with empty alt text, and lint takes that for an answer.

use serde_json::json;

use super::{bench, expect, found, image};
use crate::lint::Severity::Info;

#[test]
fn empty_alt_text_on_purpose_is_decoration_but_spaces_are_still_missing() {
    let mut b = bench();
    b.add(json!([
        image("none", 64.0, 100.0, 200.0, 100.0, None),
        image("decor", 64.0, 300.0, 200.0, 100.0, Some("")),
        image("spaces", 300.0, 300.0, 100.0, 100.0, Some("  ")),
    ]));
    assert_eq!(
        found(&b.report()),
        expect(&[
            ("missing-alt", Info, Some("none")),
            ("missing-alt", Info, Some("spaces")),
        ])
    );
}
