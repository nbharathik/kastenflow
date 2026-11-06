//! Telling an agent plainly why a deck cannot be read. A deck made by a newer KastenFlow Slides is refused by
//! the reader with words that already name the field and the value and say to update; they are passed on as they are.

use super::ToolError;
use crate::error::Error;

/// Why the deck `name` cannot be read.
pub(super) fn unreadable(name: &str, error: &Error) -> ToolError {
    match error {
        Error::TooNew { found, supported } => ToolError::new(format!(
            "The deck `{name}` was made by a newer KastenFlow Slides (format {found}; this one reads up to {supported}). Update KastenFlow to work on it. Nothing was changed."
        )),
        other => ToolError::new(format!("The deck `{name}` cannot be read: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical;

    fn deck_with_a_chart_of_kind(kind: &str) -> String {
        let mut e = crate::ops::Engine::create("Newer", "Light", 3).unwrap();
        let slide = e.deck().slides[0].id.clone();
        e.apply(
            "add_elements",
            serde_json::json!({ "slide": slide, "elements": [{ "type": "chart", "id": "c-1", "x": 0, "y": 0, "w": 200, "h": 100, "kind": "bar", "categories": ["a"], "series": [{ "name": "S", "values": [1] }] }] }),
        )
        .unwrap();
        let text = canonical::write(e.deck()).unwrap();
        text.replace("\"kind\": \"bar\"", &format!("\"kind\": \"{kind}\""))
    }

    #[test]
    fn a_kind_this_version_does_not_know_is_named_with_its_field_and_the_advice_is_to_update() {
        let text = deck_with_a_chart_of_kind("waterfall");
        let error = canonical::parse(&text).unwrap_err();
        let told = unreadable("talk.deck", &error).message;
        assert!(
            told.starts_with("The deck `talk.deck` cannot be read:")
                && told.contains(".kind` is `waterfall`")
                && told.contains("update KastenFlow"),
            "{told}"
        );
        assert!(!told.contains("unknown variant"), "{told}");
    }

    #[test]
    fn a_newer_format_says_so_and_any_other_fault_keeps_its_own_words() {
        let told = unreadable(
            "talk.deck",
            &Error::TooNew {
                found: 9,
                supported: 2,
            },
        )
        .message;
        assert!(
            told.contains("format 9") && told.contains("reads up to 2") && told.contains("Update"),
            "{told}"
        );
        let broken = unreadable("talk.deck", &canonical::parse("{").unwrap_err()).message;
        assert!(
            broken.starts_with("The deck `talk.deck` cannot be read:"),
            "{broken}"
        );
    }
}
