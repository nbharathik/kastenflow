//! The structure, page-block and parity tools' calls in words for the person,
//! as the chat shows them: "Put “Notes” inside “Handbook”", "Ticked the to-do
//! on line 4 of “Chores”", and what a call set out to do.

use serde_json::Value;

/// How a call went, in a line and the files it touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Told {
    pub summary: String,
    pub paths: Vec<String>,
}

/// The tools of this file.
pub const TOOLS: [&str; 34] = [
    "activity_digest",
    "set_parent",
    "reorder_children",
    "create_project",
    "save_project_setup",
    "list_setups",
    "set_project_state",
    "set_tag_views",
    "set_view_order",
    "read_page_blocks",
    "edit_page",
    "duplicate_note",
    "restore_note",
    "set_note_meta",
    "apply_template",
    "journal_day",
    "set_task",
    "list_trash",
    "list_tasks",
    "list_projects",
    "add_comment",
    "resolve_comment",
    "list_comments",
    "list_collections",
    "create_collection",
    "update_collection",
    "list_references",
    "add_reference",
    "board_edit",
    "rename_diagram",
    "move_diagram",
    "duplicate_diagram",
    "list_sessions",
    "undo_session",
];

pub fn is_tool(name: &str) -> bool {
    TOOLS.contains(&name)
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn count(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

fn len(value: &Value) -> usize {
    value.as_array().map_or(0, Vec::len)
}

/// A note or file as the person would name it: a title as given, a path as
/// its file name without the ending.
fn named(reference: &str) -> String {
    let name = match reference.trim().rsplit_once('/') {
        Some((_, last)) => last
            .trim_end_matches(".md")
            .trim_end_matches(".drawio")
            .trim_end_matches(".canvas"),
        None => reference.trim(),
    };
    format!("“{name}”")
}

fn input_name(input: &Value, key: &str, default: &str) -> String {
    match text(input, key) {
        "" => default.to_owned(),
        given => named(given),
    }
}

/// What a call set out to do, in words that follow "Could not" or "Waiting for review:".
pub fn action(name: &str, input: &Value) -> Option<String> {
    if !is_tool(name) {
        return None;
    }
    let note = input_name(input, "note", "the note");
    let diagram = input_name(input, "diagram", "the diagram");
    Some(match name {
        "set_parent" => match text(input, "parent") {
            "" => format!("take {note} out of its page"),
            parent => format!("put {note} inside {}", named(parent)),
        },
        "reorder_children" => format!("put the sub-pages of {note} in order"),
        "create_project" => format!("create the project “{}”", text(input, "title")),
        "save_project_setup" => format!(
            "save the project {} as the setup “{}”",
            input_name(input, "project", "the project"),
            text(input, "name")
        ),
        "list_setups" => "list the ways a project can start".to_owned(),
        "set_project_state" => format!(
            "change the state of the project {}",
            input_name(input, "project", "the project")
        ),
        "set_tag_views" => format!(
            "change the views of #{}",
            text(input, "tag").trim_start_matches('#')
        ),
        "set_view_order" => format!(
            "put the rows of the view “{}” of #{} in order",
            text(input, "view"),
            text(input, "tag").trim_start_matches('#')
        ),
        "read_page_blocks" => format!("read the blocks of {note}"),
        "edit_page" => format!("edit the page {note}"),
        "duplicate_note" => format!("copy {note}"),
        "restore_note" => format!("bring {note} back from the trash"),
        "set_note_meta" => format!("set the {} of {note}", text(input, "key")),
        "apply_template" => format!(
            "fill {note} from the template “{}”",
            text(input, "template")
        ),
        "journal_day" => match text(input, "date") {
            "" => "open today's journal".to_owned(),
            day => format!("open the journal for {day}"),
        },
        "set_task" => format!(
            "{} a to-do in {note}",
            if input["done"] == false {
                "untick"
            } else {
                "tick"
            }
        ),
        "list_trash" => "look in the trash".to_owned(),
        "list_tasks" => "list the to-dos".to_owned(),
        "list_projects" => "list the projects".to_owned(),
        "add_comment" => format!("comment on {note}"),
        "resolve_comment" => format!(
            "{} a comment on {note}",
            if input["resolved"] == false {
                "reopen"
            } else {
                "resolve"
            }
        ),
        "list_comments" => format!("read the comments on {note}"),
        "list_collections" => "list the saved searches".to_owned(),
        "create_collection" => format!("save the search “{}”", text(input, "name")),
        "update_collection" => format!(
            "change the saved search {}",
            input_name(input, "collection", "the saved search")
        ),
        "list_references" => "list the references".to_owned(),
        "add_reference" => format!("add the reference {}", text(input, "key")),
        "board_edit" => format!(
            "change the board {} in {}",
            input_name(input, "board", "the board"),
            count(len(&input["steps"]), "step")
        ),
        "rename_diagram" => format!("rename the diagram {diagram} to “{}”", text(input, "title")),
        "move_diagram" => format!(
            "move the diagram {diagram} to {}",
            match text(input, "project") {
                "" => "the library".to_owned(),
                project => format!("the project {project}"),
            }
        ),
        "duplicate_diagram" => format!("copy the diagram {diagram}"),
        "list_sessions" => "list the sessions of agents".to_owned(),
        "activity_digest" => "see what agents have done lately".to_owned(),
        "undo_session" => "take back a session's changes".to_owned(),
        _ => return None,
    })
}

/// How a finished call went (`value` is what the tool answered, with its
/// `status` and `result` for a write); none for a tool that is not of this file.
pub fn told(name: &str, input: &Value, value: &Value) -> Option<Told> {
    if !is_tool(name) {
        return None;
    }
    let done = &value["result"];
    let note = input_name(input, "note", "the note");
    let diagram = input_name(input, "diagram", "the diagram");
    let title = || match text(done, "title") {
        "" => note.clone(),
        given => format!("“{given}”"),
    };
    let own = |path: &str| -> Vec<String> {
        (!path.is_empty())
            .then(|| path.to_owned())
            .into_iter()
            .collect()
    };
    let (summary, paths): (String, Vec<String>) = match name {
        "set_parent" => {
            let moved: Vec<String> = done["moved"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m.get(1).and_then(Value::as_str))
                .map(str::to_owned)
                .collect();
            let words = match text(input, "parent") {
                "" => format!("Took {} out of its page", title()),
                parent => format!("Put {} inside {}", title(), named(parent)),
            };
            (
                words,
                if moved.is_empty() {
                    own(text(done, "path"))
                } else {
                    moved
                },
            )
        }
        "reorder_children" => (
            format!("Put the sub-pages of {note} in order"),
            own(text(done, "path")),
        ),
        "create_project" => (
            format!("Created the project “{}”", text(done, "title")),
            own(text(done, "path")),
        ),
        "save_project_setup" => (
            format!("Saved the setup “{}”", text(done, "name")),
            own(text(done, "path")),
        ),
        "list_setups" => (
            format!("Listed {}", count(len(&value["setups"]), "setup")),
            vec![],
        ),
        "set_project_state" => (
            format!("Changed the state of the project {}", title()),
            own(text(done, "path")),
        ),
        "set_tag_views" => (
            format!(
                "Changed the views of #{}",
                text(input, "tag").trim_start_matches('#')
            ),
            own(text(done, "path")),
        ),
        "set_view_order" => (
            format!(
                "Put the rows of the view “{}” of #{} in order",
                text(input, "view"),
                text(input, "tag").trim_start_matches('#')
            ),
            own(text(done, "path")),
        ),
        "read_page_blocks" => (format!("Read the blocks of {note}"), vec![]),
        "edit_page" => (
            format!("Edited the page {}", title()),
            own(text(done, "path")),
        ),
        "duplicate_note" => (
            format!("Copied {note} as {}", title()),
            own(text(done, "path")),
        ),
        "restore_note" => (
            format!("Brought {} back from the trash", title()),
            own(text(done, "path")),
        ),
        "set_note_meta" => (
            format!("Set the {} of {}", text(input, "key"), title()),
            own(text(done, "path")),
        ),
        "apply_template" => (
            format!(
                "Filled {} from the template “{}”",
                title(),
                text(input, "template")
            ),
            own(text(done, "path")),
        ),
        "journal_day" => (
            format!("Opened the journal for {}", text(done, "title")),
            own(text(done, "path")),
        ),
        "set_task" => {
            let line = input["line"].as_u64().map_or(0, |n| n + 1);
            let verb = if input["done"] == false {
                "Unticked"
            } else {
                "Ticked"
            };
            (
                format!("{verb} the to-do on line {line} of {}", title()),
                own(text(done, "path")),
            )
        }
        "list_trash" => (
            format!(
                "Looked in the trash: {}",
                count(len(&value["trash"]), "note")
            ),
            vec![],
        ),
        "list_tasks" => {
            let shown = len(&value["tasks"]);
            let total = value["total"].as_u64().map_or(shown, |t| t as usize);
            let listed = if shown < total {
                format!("{shown} of {}", count(total, "to-do"))
            } else {
                count(total, "to-do")
            };
            (format!("Listed {listed}"), vec![])
        }
        "list_projects" => (
            format!("Listed {}", count(len(&value["projects"]), "project")),
            vec![],
        ),
        "add_comment" => (format!("Commented on {note}"), own(text(input, "note"))),
        "resolve_comment" => {
            let verb = if input["resolved"] == false {
                "Reopened"
            } else {
                "Resolved"
            };
            (
                format!("{verb} a comment on {note}"),
                own(text(input, "note")),
            )
        }
        "list_comments" => (
            format!(
                "Read {} on {note}",
                count(len(&value["comments"]), "comment")
            ),
            vec![],
        ),
        "list_collections" => (
            format!(
                "Listed {}",
                count(len(&value["collections"]), "saved search")
            ),
            vec![],
        ),
        "create_collection" => (
            format!("Saved the search “{}”", text(done, "name")),
            own(text(done, "path")),
        ),
        "update_collection" => (
            format!("Changed the saved search “{}”", text(done, "name")),
            own(text(done, "path")),
        ),
        "list_references" => (
            format!("Listed {}", count(len(&value["references"]), "reference")),
            vec![],
        ),
        "add_reference" => (
            format!(
                "Added the reference {} to the bibliography",
                text(done, "key")
            ),
            vec![],
        ),
        "board_edit" => (
            format!(
                "Changed the board {}",
                input_name(input, "board", "the board")
            ),
            vec![],
        ),
        "rename_diagram" => (
            format!(
                "Renamed the diagram {diagram} to “{}”",
                text(input, "title")
            ),
            own(text(done, "path")),
        ),
        "move_diagram" => (
            format!("Moved the diagram {diagram}"),
            own(text(done, "path")),
        ),
        "duplicate_diagram" => (
            format!("Copied the diagram {diagram}"),
            own(text(done, "path")),
        ),
        "list_sessions" => (
            format!("Listed {}", count(len(&value["sessions"]), "session")),
            vec![],
        ),
        "activity_digest" => (
            format!(
                "Looked at what agents did ({})",
                count(len(&value["sessions"]), "session")
            ),
            vec![],
        ),
        "undo_session" => {
            let took = format!("Took back {}", count(len(&done["reverted"]), "change"));
            // The undo stops at a note the person edited since, and says which.
            let summary = match done["conflict"]["path"].as_str() {
                Some(path) => format!("{took} and stopped at {}: it was edited since", named(path)),
                None => took,
            };
            (summary, vec![])
        }
        _ => return None,
    };
    Some(Told { summary, paths })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn every_tool_of_the_list_has_words() {
        for name in TOOLS {
            assert!(action(name, &json!({})).is_some(), "{name}");
            assert!(told(name, &json!({}), &json!({})).is_some(), "{name}");
        }
        assert!(action("search", &json!({})).is_none());
    }

    #[test]
    fn calls_read_as_a_person_would_say_them() {
        let input = json!({ "note": "projects/a/pages/handbook.md", "parent": "Guide" });
        assert_eq!(
            action("set_parent", &input).as_deref(),
            Some("put “handbook” inside “Guide”")
        );
        let done = json!({ "status": "done", "result": { "path": "x.md", "title": "Handbook" } });
        let told = told("set_parent", &input, &done).unwrap();
        assert_eq!(told.summary, "Put “Handbook” inside “Guide”");
        assert_eq!(told.paths, ["x.md"]);
        let task = json!({ "note": "Chores", "line": 3, "done": true });
        let told = told_of(
            "set_task",
            &task,
            &json!({ "result": { "path": "c.md", "title": "Chores" } }),
        );
        assert_eq!(told, "Ticked the to-do on line 4 of “Chores”");
    }

    #[test]
    fn an_undo_that_stopped_at_a_later_edit_says_so() {
        let input = json!({ "session": "s1" });
        let clean = json!({ "result": { "reverted": ["a", "b"], "conflict": null } });
        assert_eq!(
            told_of("undo_session", &input, &clean),
            "Took back 2 changes"
        );
        let stopped = json!({ "result": { "reverted": ["a"], "conflict": { "path": "library/plans.md", "commit": "c", "summary": "s", "detail": "d" } } });
        assert_eq!(
            told_of("undo_session", &input, &stopped),
            "Took back 1 change and stopped at “plans”: it was edited since"
        );
    }

    fn told_of(name: &str, input: &Value, value: &Value) -> String {
        told(name, input, value).unwrap().summary
    }
}
