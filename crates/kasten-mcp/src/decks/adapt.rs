//! The deck tools as Kasten lists them: slides-core's list, described for a
//! vault. The tools keep their names, arguments and code; what changes is
//! the words that mention a folder of decks, a deck named by its file, and
//! where a file goes, plus the `project` a new deck may be made in and a
//! note on the two tools that wait for review.

use std::sync::OnceLock;

use serde_json::{Value, json};
use slides_core::agent::{self, ToolSpec};

const DECK_WORDS: &str = "The deck: its path as list_decks shows it (such as library/talk.deck), or its title. May be left out when the vault has only one deck.";

const PROJECT_WORDS: &str = "The project to make the deck in, as list_notes names a note's project (its folder under projects/). Without one the deck goes to the library.";

/// Words a description uses for a folder, and what they say in a vault. The longer phrase comes first.
const REWORDED: [(&str, &str); 5] = [
    ("inside the folder the decks are in", "inside the vault"),
    ("in the folder the decks are in", "in the vault"),
    ("The decks in the folder:", "The decks in the vault:"),
    (
        "Writes the deck as a file beside it:",
        "Writes the deck as a file in the vault's assets/ folder:",
    ),
    (
        "The pictures in the store's assets",
        "The pictures in the vault's assets/ folder",
    ),
];

/// Said of the tools that can take slides out of a deck: by removing them, or by leaving them with nothing on them.
const REMOVING_NOTE: &str = " In KastenFlow a call that takes slides out of decks (removes them, or leaves them with nothing on them) waits, as a whole, for the person's review once the slides you have taken out in the last 10 minutes come to more than 3 (the person sets the number).";

/// Said of the tool that writes a deck out: a Markdown outline is not kept as a file, since a vault reads every `.md` file as a note.
const EXPORT_NOTE: &str = " In a vault only pptx is kept as a file; get_outline gives the outline as Markdown, and create_note keeps it as a note.";

/// Said of the tool that puts a deck in the trash.
const TRASH_DECK_NOTE: &str = " In KastenFlow this always waits for the person to accept it.";

fn adapt(mut spec: ToolSpec) -> ToolSpec {
    if let Some(deck) = spec.input_schema.pointer_mut("/properties/deck") {
        deck["description"] = json!(DECK_WORDS);
    }
    for (was, now) in REWORDED {
        spec.description = spec.description.replace(was, now);
    }
    match spec.name.as_str() {
        "create_deck" | "import_pptx" => {
            if let Some(Value::Object(properties)) = spec.input_schema.get_mut("properties") {
                properties.insert(
                    "project".to_owned(),
                    json!({ "type": "string", "description": PROJECT_WORDS }),
                );
            }
        }
        "delete_slides" | "delete_elements" | "update_elements" => {
            spec.description.push_str(REMOVING_NOTE);
        }
        "trash_deck" => spec.description.push_str(TRASH_DECK_NOTE),
        "export" => {
            spec.description = spec.description.replace(" or `markdown` (the outline)", "");
            spec.description.push_str(EXPORT_NOTE);
            if let Some(format) = spec.input_schema.pointer_mut("/properties/format") {
                format["enum"] = json!(["pptx"]);
            }
        }
        _ => {}
    }
    spec
}

/// Every deck tool, described for a vault.
pub(crate) fn specs() -> &'static [ToolSpec] {
    static SPECS: OnceLock<Vec<ToolSpec>> = OnceLock::new();
    SPECS.get_or_init(|| {
        let mut all: Vec<ToolSpec> = agent::tools().into_iter().map(adapt).collect();
        // The one tool only Kasten has, listed after the one it goes with.
        let at = all
            .iter()
            .position(|t| t.name == "create_deck")
            .map_or(all.len(), |i| i + 1);
        all.insert(at, super::from_note::spec());
        all
    })
}

/// The deck tool called `name`.
pub(crate) fn find(name: &str) -> Option<&'static ToolSpec> {
    specs().iter().find(|s| s.name == name)
}

/// Whether `name` is a deck tool.
pub(crate) fn is_tool(name: &str) -> bool {
    find(name).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(name: &str) -> &'static ToolSpec {
        find(name).unwrap_or_else(|| panic!("no tool {name}"))
    }

    #[test]
    fn a_deck_is_named_by_its_path_or_title_and_no_tool_speaks_of_a_folder_of_decks() {
        for tool in specs() {
            let text = format!("{} {}", tool.description, tool.input_schema);
            assert!(
                !text.contains("the folder the decks"),
                "{}: {text}",
                tool.name
            );
            assert!(
                !text.contains("file name, such as talk.deck"),
                "{}",
                tool.name
            );
        }
        let deck = &spec("get_deck").input_schema["properties"]["deck"];
        assert!(
            deck["description"]
                .as_str()
                .unwrap()
                .contains("library/talk.deck")
        );
        assert!(spec("list_decks").description.contains("in the vault"));
        assert!(spec("export").description.contains("assets/"));
    }

    #[test]
    fn new_decks_may_be_made_in_a_project() {
        for name in ["create_deck", "import_pptx"] {
            let project = &spec(name).input_schema["properties"]["project"];
            assert_eq!(project["type"], "string", "{name}");
        }
        assert!(
            spec("get_deck").input_schema["properties"]
                .get("project")
                .is_none()
        );
    }

    #[test]
    fn the_tools_that_can_take_slides_out_and_the_one_that_trashes_a_deck_say_they_wait() {
        for name in ["delete_slides", "delete_elements", "update_elements"] {
            assert!(
                spec(name)
                    .description
                    .contains("waits, as a whole, for the person's review"),
                "{name}"
            );
        }
        assert!(spec("trash_deck").description.contains("always waits"));
    }

    #[test]
    fn a_deck_is_exported_only_as_powerpoint() {
        let export = spec("export");
        assert_eq!(
            export.input_schema["properties"]["format"]["enum"],
            json!(["pptx"])
        );
        assert!(
            export.description.contains("get_outline"),
            "{}",
            export.description
        );
        assert!(
            !export.description.contains("or `markdown`"),
            "{}",
            export.description
        );
    }

    #[test]
    fn no_deck_tool_takes_the_name_of_a_note_tool() {
        let notes = [
            "search",
            "read_note",
            "list_notes",
            "query_tag",
            "get_journal",
            "get_history",
            "list_tags",
            "list_templates",
            "capture",
            "create_note",
            "append",
            "replace_section",
            "update_props",
            "add_tags",
            "remove_tags",
            "rename_note",
            "move_note",
            "journal_append",
            "trash_note",
            "propose_edit",
            "update_tag_schema",
            "create_template",
            "update_template",
            "apply_template",
            "list_boards",
            "read_board",
            "create_board",
            "add_to_board",
            "connect",
            "group_on_board",
            "list_diagrams",
            "get_diagram",
            "create_diagram",
            "update_diagram",
            "trash_diagram",
            "server_status",
        ];
        for tool in specs() {
            assert!(
                !notes.contains(&tool.name.as_str()),
                "{} is taken",
                tool.name
            );
        }
    }
}
