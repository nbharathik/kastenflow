//! What an op says about itself: its name, the note it changes and how many
//! bytes of text the agent sends.

use super::AgentOp;
use crate::pages::PageStep;

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
            AgentOp::BoardChanges { .. } => "board_changes",
            AgentOp::Template { .. } => "template",
            AgentOp::EditDeck { .. } => "edit_deck",
            AgentOp::CreateDeck { .. } => "create_deck",
            AgentOp::CreateDiagram { .. } => "create_diagram",
            AgentOp::UpdateDiagram { .. } => "update_diagram",
            AgentOp::EditDiagram { .. } => "edit_diagram",
            AgentOp::SaveSource { .. } => "save_source",
            AgentOp::SmartCreate { .. } => "smart_create",
            AgentOp::SmartWrite { .. } => "smart_write",
            AgentOp::SmartDelete { .. } => "smart_delete",
            AgentOp::EditPage { .. } => "edit_page",
            AgentOp::Batch { .. } => "batch",
            AgentOp::SetParent { .. } => "set_parent",
            AgentOp::ReorderChildren { .. } => "reorder_children",
            AgentOp::CreateProject { .. } => "create_project",
            AgentOp::SetProjectState { .. } => "set_project_state",
            AgentOp::SetTagViews { .. } => "set_tag_views",
            AgentOp::SetViewOrder { .. } => "set_view_order",
            AgentOp::DuplicateNote { .. } => "duplicate_note",
            AgentOp::RestoreNote { .. } => "restore_note",
            AgentOp::SetNoteMeta { .. } => "set_note_meta",
            AgentOp::ApplyTemplate { .. } => "apply_template",
            AgentOp::JournalDay { .. } => "journal_day",
            AgentOp::SetTask { .. } => "set_task",
            AgentOp::AddComment { .. } => "add_comment",
            AgentOp::ResolveComment { .. } => "resolve_comment",
            AgentOp::CreateCollection { .. } => "create_collection",
            AgentOp::UpdateCollection { .. } => "update_collection",
            AgentOp::AddReference { .. } => "add_reference",
            AgentOp::RenameDiagram { .. } => "rename_diagram",
            AgentOp::MoveDiagram { .. } => "move_diagram",
            AgentOp::DuplicateDiagram { .. } => "duplicate_diagram",
            AgentOp::UndoSession { .. } => "undo_session",
            AgentOp::SaveProjectSetup { .. } => "save_project_setup",
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
            | AgentOp::EditDiagram { path, .. }
            | AgentOp::EditPage { path, .. }
            | AgentOp::SetParent { path, .. }
            | AgentOp::SetProjectState { path, .. }
            | AgentOp::ReorderChildren { parent: path, .. }
            | AgentOp::DuplicateNote { path }
            | AgentOp::SetNoteMeta { path, .. }
            | AgentOp::ApplyTemplate { path, .. }
            | AgentOp::SetTask { path, .. }
            | AgentOp::AddComment { path, .. }
            | AgentOp::ResolveComment { path, .. }
            | AgentOp::RenameDiagram { path, .. }
            | AgentOp::MoveDiagram { path, .. }
            | AgentOp::DuplicateDiagram { path }
            | AgentOp::EditDeck { path, .. } => Some(path),
            // The smart page whose folder changes; the file is inside it.
            AgentOp::SmartWrite { page, .. } | AgentOp::SmartDelete { page, .. } => Some(page),
            // A new file has no file yet.
            AgentOp::SaveSource { path, base, .. } if !base.is_empty() => Some(path),
            AgentOp::AddToBoard { board, .. }
            | AgentOp::Connect { board, .. }
            | AgentOp::Group { board, .. }
            | AgentOp::BoardChanges { board, .. } => Some(board),
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
            AgentOp::BoardChanges { changes, .. } => {
                serde_json::to_string(changes).map_or(0, |c| c.len())
            }
            AgentOp::Template { text, .. } => text.len(),
            AgentOp::EditDeck { sent, .. } | AgentOp::CreateDeck { sent, .. } => *sent,
            AgentOp::CreateDiagram { title, xml, .. } => title.len() + xml.len(),
            AgentOp::UpdateDiagram { xml, .. } => xml.len(),
            AgentOp::SaveSource { text, .. } => text.len(),
            AgentOp::SmartCreate { title, files, .. } => {
                title.len()
                    + files
                        .iter()
                        .map(|f| f.path.len() + f.content.len())
                        .sum::<usize>()
            }
            AgentOp::SmartWrite { content, .. } => content.len(),
            AgentOp::SmartDelete { .. } => 0,
            AgentOp::EditPage { steps, .. } => steps.iter().map(PageStep::bytes).sum(),
            // What the agent sent: the steps as they travel.
            AgentOp::EditDiagram { steps, .. } => {
                serde_json::to_string(steps).map_or(0, |s| s.len())
            }
            AgentOp::Move { .. } | AgentOp::Trash { .. } | AgentOp::SetParent { .. } => 0,
            AgentOp::Batch { ops, .. } => ops.iter().map(AgentOp::bytes).sum(),
            AgentOp::ReorderChildren { ids, .. } => sum(ids),
            AgentOp::CreateProject { title, setup } => {
                title.len() + setup.as_ref().map_or(0, String::len)
            }
            AgentOp::SetProjectState { state, .. } => {
                serde_json::to_string(state).map_or(0, |s| s.len())
            }
            AgentOp::SetTagViews { tag, views } => {
                tag.len() + serde_json::to_string(views).map_or(0, |v| v.len())
            }
            AgentOp::SetViewOrder { tag, view, ids } => tag.len() + view.len() + sum(ids),
            AgentOp::DuplicateNote { .. }
            | AgentOp::RestoreNote { .. }
            | AgentOp::JournalDay { .. }
            | AgentOp::SetTask { .. }
            | AgentOp::ResolveComment { .. }
            | AgentOp::MoveDiagram { .. }
            | AgentOp::DuplicateDiagram { .. }
            | AgentOp::UndoSession { .. } => 0,
            AgentOp::SetNoteMeta { key, value, .. } => {
                key.len() + value.as_ref().map_or(0, String::len)
            }
            AgentOp::ApplyTemplate { template, .. } => template.len(),
            AgentOp::AddComment { anchor, text, .. } => {
                text.len() + anchor.quote.as_ref().map_or(0, String::len) + anchor.section.len()
            }
            AgentOp::CreateCollection { name, edits } => {
                name.len() + serde_json::to_string(edits).map_or(0, |e| e.len())
            }
            AgentOp::UpdateCollection { edits, .. } => {
                serde_json::to_string(edits).map_or(0, |e| e.len())
            }
            AgentOp::AddReference { key, fields, .. } => {
                key.len() + fields.iter().map(|(k, v)| k.len() + v.len()).sum::<usize>()
            }
            AgentOp::RenameDiagram { title, .. } => title.len(),
            AgentOp::SaveProjectSetup {
                project,
                slug,
                title,
                pages,
            } => {
                project.len()
                    + slug.len()
                    + title.len()
                    + pages.as_ref().map_or(0, |list| sum(list))
            }
        }
    }
}
