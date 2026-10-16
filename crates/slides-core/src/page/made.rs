//! What an element made from a page said when it was made, as a fingerprint. An element that carries a page source can
//! be told apart from the page's words afterwards: if its fingerprint no longer matches the one it was made with, a
//! person changed it by hand, and bringing it up to date with the page would throw that work away.
//!
//! Only what the element says counts: its words, its pictures, its looks. Where it stands, how big it is, what it is
//! called, which steps it appears at and the page it points at are not content, so moving an element, renaming it or
//! giving it steps is not an edit.

use serde_json::Value;

use crate::model::Element;

/// The fields every element has that say where it is or how it is told apart, not what it says.
const NOT_CONTENT: [&str; 16] = [
    "id",
    "x",
    "y",
    "w",
    "h",
    "rotation",
    "flipH",
    "flipV",
    "placeholder",
    "stepStates",
    "name",
    "alt",
    "locked",
    "link",
    "morphId",
    "source",
];

/// Takes the fields that are not content off an element's JSON, and off the elements of a group.
fn strip(value: &mut Value) {
    let Value::Object(map) = value else {
        return;
    };
    for key in NOT_CONTENT {
        map.remove(key);
    }
    if let Some(Value::Array(children)) = map.get_mut("children") {
        children.iter_mut().for_each(strip);
    }
}

/// The JSON with its keys in order and no spaces: the same for the same content however the file was written.
fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                canonical(&map[key], out);
            }
            out.push('}');
        }
        Value::Array(list) => {
            out.push('[');
            for (i, item) in list.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

/// Whether a `made` is a fingerprint of the kind `made_of` gives (16 lower-case hex digits), as against any other word a host may put
/// there for how an element came to be: only a fingerprint can tell that the element was changed by hand, and only a storyboard writes one.
pub fn is_fingerprint(made: &str) -> bool {
    made.len() == 16 && made.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// What the element says, as 16 hex digits of FNV-1a over its content written in a fixed order.
pub fn made_of(element: &Element) -> String {
    let mut value = serde_json::to_value(element).unwrap_or(Value::Null);
    strip(&mut value);
    let mut text = String::new();
    canonical(&value, &mut text);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Base, GroupEl, Paragraph, Run, SourceKind, Text};

    fn words(id: &str, words: &str) -> Element {
        Element::text_el(
            Base::new(id).place(10.0, 20.0, 300.0, 80.0),
            Text::from_paragraphs(vec![Paragraph {
                runs: vec![Run::plain(words)],
                ..Paragraph::plain("")
            }]),
        )
    }

    #[test]
    fn moving_an_element_is_not_an_edit() {
        let before = made_of(&words("e-1", "Same words"));
        let mut moved = words("e-2", "Same words");
        {
            let base = moved.base_mut();
            base.x = Some(400.0);
            base.y = Some(300.0);
            base.w = Some(120.0);
            base.rotation = Some(10.0);
            base.flip_h = true;
            base.name = Some("Renamed".to_owned());
            base.alt = Some("Described".to_owned());
            base.locked = true;
            base.link = Some("https://example.com".to_owned());
            base.placeholder = Some("body".to_owned());
            base.step_states
                .insert(1, crate::model::StepState::Highlighted);
            base.source = Some(crate::model::PageSource::new(
                "library/plan.md",
                SourceKind::Section,
            ));
        }
        assert_eq!(made_of(&moved), before);
        assert_eq!(before.len(), 16);
    }

    #[test]
    fn other_words_or_another_look_are_an_edit() {
        let before = made_of(&words("e-1", "Same words"));
        assert_ne!(made_of(&words("e-1", "Other words")), before);
        let mut bold = words("e-1", "Same words");
        if let Element::Text(t) = &mut bold {
            t.text.paragraphs[0].runs[0].bold = true;
        }
        assert_ne!(made_of(&bold), before);
        let mut filled = words("e-1", "Same words");
        filled.base_mut().style = Some(crate::model::Style {
            opacity: Some(0.5),
            ..crate::model::Style::default()
        });
        assert_ne!(made_of(&filled), before);
    }

    #[test]
    fn a_group_counts_its_children_by_what_they_say_and_not_by_where_they_stand() {
        let group = |child: Element| {
            Element::Group(GroupEl {
                base: Base::new("g-1").place(0.0, 0.0, 400.0, 200.0),
                children: vec![child],
                extra: crate::model::Extra::new(),
            })
        };
        let before = made_of(&group(words("a", "Child")));
        let mut moved = words("b", "Child");
        moved.base_mut().x = Some(99.0);
        assert_eq!(made_of(&group(moved)), before);
        assert_ne!(made_of(&group(words("a", "Another child"))), before);
    }
}
