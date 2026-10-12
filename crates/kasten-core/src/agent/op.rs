//! The ops agents may run: the MCP write tools, stored as they are in
//! proposals. There is deliberately no raw file
//! write, no permanent delete and no git command.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentOp {
    Capture {
        markdown: String,
        #[serde(default)]
        tags: Vec<String>,
    },
    CreateNote {
        /// `card` or `page`.
        #[serde(rename = "type")]
        note_type: String,
        title: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        tags: Vec<String>,
        #[serde(default)]
        props: Map<String, Value>,
        /// Path of the parent page.
        #[serde(default)]
        parent: Option<String>,
        /// A template in `templates/` to start from, by name; its body is
        /// used when `body` is empty.
        #[serde(default)]
        template: Option<String>,
    },
    Append {
        path: String,
        markdown: String,
        #[serde(default)]
        heading: Option<String>,
    },
    ReplaceSection {
        path: String,
        heading: String,
        markdown: String,
    },
    UpdateProps {
        path: String,
        props: Map<String, Value>,
    },
    Tags {
        path: String,
        #[serde(default)]
        add: Vec<String>,
        #[serde(default)]
        remove: Vec<String>,
    },
    Rename {
        path: String,
        title: String,
    },
    Move {
        path: String,
        #[serde(default)]
        project: Option<String>,
    },
    JournalAppend {
        date: String,
        markdown: String,
        #[serde(default)]
        heading: Option<String>,
    },
    Trash {
        path: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A full rewrite (`propose_edit`); `base` is the body it was written
    /// against, so accepting it later merges with edits made meanwhile.
    Edit {
        path: String,
        body: String,
        base: String,
        #[serde(default)]
        reason: Option<String>,
    },
    TagSchema {
        tag: String,
        schema: Value,
    },
    CreateBoard {
        title: String,
        #[serde(default)]
        project: Option<String>,
    },
    /// Notes (by path) as cards: `grid`, `cluster_by_tag`, or one position each.
    AddToBoard {
        board: String,
        notes: Vec<String>,
        #[serde(default)]
        layout: Option<String>,
        #[serde(default)]
        positions: Option<Vec<[i64; 2]>>,
    },
    /// Nodes named by id, file or title.
    Connect {
        board: String,
        from: String,
        to: String,
        #[serde(default)]
        label: Option<String>,
    },
    Group {
        board: String,
        nodes: Vec<String>,
        label: String,
    },
    /// A template made (`create_template`) or rewritten
    /// (`update_template`), as its whole file. It always waits for review:
    /// agents never write `templates/` themselves.
    Template {
        /// The template's name: the file is `templates/<slug>.md`.
        name: String,
        /// The file as it should be, frontmatter and body.
        text: String,
        /// The file it was written against; none for a new template.
        #[serde(default)]
        base: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A deck changed by one of the deck tools. The tool has already run:
    /// this is the deck as it was (`base`) and as the tool leaves it
    /// (`text`), so a review can show both and accepting can merge the change
    /// with what a person did meanwhile.
    EditDeck {
        /// The deck's vault path.
        path: String,
        /// The tool, as the commit names it: `update_elements`.
        tool: String,
        /// What the tool did, in a few words for the history and the review.
        #[serde(default)]
        summary: String,
        base: String,
        text: String,
        /// How many bytes the agent sent to ask for it. The size limit counts
        /// these and not the deck, which a few bytes of request can grow.
        #[serde(default)]
        sent: usize,
        /// The deck as the agent leaves it with the marks that badge its work
        /// (an editor shows what an agent made until a person changes it or
        /// accepts it). An agent's own write is this version. A change a
        /// person accepted in the review is `text`: they have looked at it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        marked: Option<String>,
    },
    /// A new deck, as a tool made it.
    CreateDeck {
        title: String,
        /// The project folder to put it in; none means the library.
        #[serde(default)]
        project: Option<String>,
        tool: String,
        text: String,
        #[serde(default)]
        sent: usize,
        /// As for `EditDeck`: the deck with the agent's marks.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        marked: Option<String>,
    },
    /// A new diagram, as its `mxfile` XML (a blank page when `xml` is empty).
    CreateDiagram {
        title: String,
        /// The project folder to put it in; none means the library.
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        xml: String,
    },
    /// A diagram's source written whole. `base` is the XML the agent read, so
    /// accepting a proposal later keeps what a person drew meanwhile: if the
    /// file is no longer `base`, the agent's version goes to a copy beside it.
    UpdateDiagram {
        path: String,
        xml: String,
        base: String,
        #[serde(default)]
        reason: Option<String>,
    },
}

impl AgentOp {
    /// The op's name, as in the `Kasten-Op` trailer.
    pub fn name(&self) -> &'static str {
        match self {
            AgentOp::Capture { .. } => "capture",
            AgentOp::CreateNote { .. } => "create_note",
            AgentOp::Append { .. } => "append",
            AgentOp::ReplaceSection { .. } => "replace_section",
            AgentOp::UpdateProps { .. } => "update_props",
            AgentOp::Tags { .. } => "tags",
            AgentOp::Rename { .. } => "rename_note",
            AgentOp::Move { .. } => "move_note",
            AgentOp::JournalAppend { .. } => "journal_append",
            AgentOp::Trash { .. } => "trash_note",
            AgentOp::Edit { .. } => "propose_edit",
            AgentOp::TagSchema { .. } => "update_tag_schema",
            AgentOp::CreateBoard { .. } => "create_board",
            AgentOp::AddToBoard { .. } => "add_to_board",
            AgentOp::Connect { .. } => "connect",
            AgentOp::Group { .. } => "group_on_board",
            AgentOp::Template { .. } => "template",
            AgentOp::EditDeck { .. } => "edit_deck",
            AgentOp::CreateDeck { .. } => "create_deck",
            AgentOp::CreateDiagram { .. } => "create_diagram",
            AgentOp::UpdateDiagram { .. } => "update_diagram",
        }
    }

    /// The existing note the op changes, if it names one.
    pub fn path(&self) -> Option<&str> {
        match self {
            AgentOp::Append { path, .. }
            | AgentOp::ReplaceSection { path, .. }
            | AgentOp::UpdateProps { path, .. }
            | AgentOp::Tags { path, .. }
            | AgentOp::Rename { path, .. }
            | AgentOp::Move { path, .. }
            | AgentOp::Trash { path, .. }
            | AgentOp::Edit { path, .. }
            | AgentOp::UpdateDiagram { path, .. }
            | AgentOp::EditDeck { path, .. } => Some(path),
            AgentOp::AddToBoard { board, .. }
            | AgentOp::Connect { board, .. }
            | AgentOp::Group { board, .. } => Some(board),
            _ => None,
        }
    }

    /// How many bytes of text the agent sends, for the size limit.
    pub fn bytes(&self) -> usize {
        let sum = |items: &[String]| items.iter().map(String::len).sum::<usize>();
        match self {
            AgentOp::Capture { markdown, tags } => markdown.len() + sum(tags),
            AgentOp::Append { markdown, .. }
            | AgentOp::ReplaceSection { markdown, .. }
            | AgentOp::JournalAppend { markdown, .. } => markdown.len(),
            AgentOp::CreateNote {
                title,
                body,
                tags,
                props,
                ..
            } => {
                title.len()
                    + body.len()
                    + sum(tags)
                    + serde_json::to_string(props).map_or(0, |p| p.len())
            }
            AgentOp::Edit { body, .. } => body.len(),
            AgentOp::UpdateProps { props, .. } => {
                serde_json::to_string(props).map_or(0, |p| p.len())
            }
            AgentOp::TagSchema { schema, .. } => {
                serde_json::to_string(schema).map_or(0, |p| p.len())
            }
            AgentOp::Tags { add, remove, .. } => sum(add) + sum(remove),
            AgentOp::Rename { title, .. } | AgentOp::CreateBoard { title, .. } => title.len(),
            AgentOp::AddToBoard { notes, .. } => sum(notes),
            AgentOp::Group { nodes, label, .. } => sum(nodes) + label.len(),
            AgentOp::Connect { label, .. } => label.as_ref().map_or(0, String::len),
            AgentOp::Template { text, .. } => text.len(),
            AgentOp::EditDeck { sent, .. } | AgentOp::CreateDeck { sent, .. } => *sent,
            AgentOp::CreateDiagram { title, xml, .. } => title.len() + xml.len(),
            AgentOp::UpdateDiagram { xml, .. } => xml.len(),
            AgentOp::Move { .. } | AgentOp::Trash { .. } => 0,
        }
    }

    /// Whether the op makes a new note rather than changing one.
    pub fn creates(&self) -> bool {
        matches!(
            self,
            AgentOp::Capture { .. }
                | AgentOp::CreateNote { .. }
                | AgentOp::JournalAppend { .. }
                | AgentOp::CreateBoard { .. }
                | AgentOp::CreateDeck { .. }
                | AgentOp::CreateDiagram { .. }
                | AgentOp::Template { base: None, .. }
        )
    }

    /// Where a template op writes: `templates/<slug>.md`; none for a name
    /// with no letters or digits.
    pub fn template_path(name: &str) -> Option<String> {
        name.chars()
            .any(char::is_alphanumeric)
            .then(|| format!("templates/{}.md", crate::slug::slugify(name)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ops_round_trip_as_json() {
        let op = AgentOp::ReplaceSection {
            path: "a.md".into(),
            heading: "Plan".into(),
            markdown: "x".into(),
        };
        let json = serde_json::to_value(&op).unwrap();
        assert_eq!(json["kind"], "replace_section");
        assert_eq!(serde_json::from_value::<AgentOp>(json).unwrap(), op);
        let create: AgentOp =
            serde_json::from_str(r#"{"kind":"create_note","type":"card","title":"T"}"#).unwrap();
        assert_eq!(create.name(), "create_note");
        assert!(create.creates());
        assert_eq!(op.path(), Some("a.md"));
        assert_eq!(op.bytes(), 1);
    }

    #[test]
    fn deck_ops_measure_what_was_sent_and_not_the_deck() {
        let edit: AgentOp = serde_json::from_str(
            r#"{"kind":"edit_deck","path":"library/a.deck","tool":"add_slide","base":"{}","text":"{ }   ","sent":42}"#,
        )
        .unwrap();
        assert_eq!(
            (edit.name(), edit.path(), edit.bytes()),
            ("edit_deck", Some("library/a.deck"), 42)
        );
        assert!(!edit.creates());
        // Older or hand-written proposals name no summary and no size.
        let made: AgentOp = serde_json::from_str(
            r#"{"kind":"create_deck","title":"T","tool":"create_deck","text":"{}"}"#,
        )
        .unwrap();
        assert_eq!(
            (made.name(), made.path(), made.bytes()),
            ("create_deck", None, 0)
        );
        assert!(made.creates());
    }
}
