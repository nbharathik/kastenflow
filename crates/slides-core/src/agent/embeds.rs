//! The embeds an agent makes from a link. The agent gives any web address as the `url` of an `embed`; the editor turns a link of a video
//! or document site into that site's own embed when it shows it, so nothing has to be converted here. What is added is the note of which
//! site it is (`provider`), so that the agent that reads the deck next, and the person, can see it without working it out from the link.

use serde_json::Value;

use crate::composites::provider_of;

/// Notes the site on each `embed` among `elements` (and in the groups among them) that has a link of a known site and no `provider`.
pub(super) fn note_providers(elements: &mut Value) {
    let Some(list) = elements.as_array_mut() else {
        return;
    };
    for element in list {
        let Some(map) = element.as_object_mut() else {
            continue;
        };
        if map.get("type").and_then(Value::as_str) == Some("embed")
            && !map.contains_key("provider")
            && let Some(site) = map.get("url").and_then(Value::as_str).and_then(provider_of)
        {
            map.insert("provider".to_owned(), Value::String(site.to_owned()));
        }
        if let Some(children) = map.get_mut("children") {
            note_providers(children);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_embed_of_a_known_site_gets_its_site_noted_and_the_rest_is_left_alone() {
        let mut elements = json!([
            { "type": "embed", "url": "https://youtu.be/dQw4w9WgXcQ?t=30", "x": 0, "y": 0, "w": 640, "h": 360 },
            { "type": "embed", "url": "https://example.com/docs" },
            { "type": "embed", "url": "https://vimeo.com/76979871", "provider": "custom" },
            { "type": "video", "src": "https://youtu.be/dQw4w9WgXcQ" },
            { "type": "group", "children": [{ "type": "embed", "url": "https://www.loom.com/share/0123456789abcdef" }] },
            "not an element",
        ]);
        note_providers(&mut elements);
        assert_eq!(elements[0]["provider"], "youtube");
        assert!(elements[1].get("provider").is_none());
        assert_eq!(
            elements[2]["provider"], "custom",
            "what the agent said stays"
        );
        assert!(elements[3].get("provider").is_none());
        assert_eq!(elements[4]["children"][0]["provider"], "loom");
        assert_eq!(
            elements[0]["url"], "https://youtu.be/dQw4w9WgXcQ?t=30",
            "the link is kept as it was given"
        );
        // Nothing to do for what is not a list.
        let mut other = json!({ "type": "embed" });
        note_providers(&mut other);
        assert_eq!(other, json!({ "type": "embed" }));
    }

    #[test]
    fn the_note_is_a_field_the_deck_keeps() {
        let mut elements = json!([{ "type": "embed", "url": "https://youtu.be/dQw4w9WgXcQ", "x": 0, "y": 0, "w": 640, "h": 360 }]);
        note_providers(&mut elements);
        let element: crate::model::Element =
            serde_json::from_value(elements[0].clone()).expect("an element");
        let crate::model::Element::Embed(embed) = element else {
            panic!("an embed")
        };
        assert_eq!(embed.provider.as_deref(), Some("youtube"));
    }
}
