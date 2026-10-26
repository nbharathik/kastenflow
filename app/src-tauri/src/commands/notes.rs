//! Note commands: thin wrappers over the kasten-core engine, which locks,
//! indexes and commits every write. Errors travel to the frontend as their
//! message.

use kasten_core::history::Actor;
use kasten_core::index::{Related, TaskRow};
use kasten_core::{
    Backlink, DayMention, Emptied, Hit, Instant, Kasten, NewNote, NoteFile, NoteMeta, Placed,
    Renamed, Saved, Trashed,
};
use tauri::State;

pub use crate::open_vault::OpenVault;

pub(crate) const HUMAN: Actor = Actor::Human;

#[tauri::command(async)]
pub fn list_notes(state: State<'_, OpenVault>) -> Result<Vec<NoteMeta>, String> {
    state.run(Kasten::list)
}

#[tauri::command(async)]
pub fn notes_at(state: State<'_, OpenVault>, paths: Vec<String>) -> Result<Vec<NoteMeta>, String> {
    state.run(|k| k.notes_at(&paths))
}

#[tauri::command(async)]
pub fn read_note(state: State<'_, OpenVault>, path: String) -> Result<NoteFile, String> {
    state.run(|k| k.read(&path))
}

/// A new note; with a body, tags or properties, they are checked and
/// written in the same commit. A page first written in arrives with its
/// body, so its first input is one file and one commit.
#[tauri::command(async)]
pub fn create_note(
    state: State<'_, OpenVault>,
    new: NewNote,
    body: Option<String>,
    tags: Option<Vec<String>>,
    props: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<NoteFile, String> {
    let body = body.unwrap_or_default();
    let (tags, props) = (tags.unwrap_or_default(), props.unwrap_or_default());
    state.run(|k| {
        if body.trim().is_empty() && tags.is_empty() && props.is_empty() {
            k.create(&HUMAN, &new, Instant::now())
        } else {
            k.create_with_body(&HUMAN, &new, &body, &tags, &props, "create", Instant::now())
        }
    })
}

/// A quick note as a card, in the inbox or in `project`'s cards.
#[tauri::command(async)]
pub fn capture_note(
    state: State<'_, OpenVault>,
    markdown: String,
    tags: Vec<String>,
    project: Option<String>,
) -> Result<NoteFile, String> {
    state.run(|k| k.capture_in(&HUMAN, &markdown, &tags, project.as_deref(), Instant::now()))
}

#[tauri::command(async)]
pub fn save_note_body(
    state: State<'_, OpenVault>,
    path: String,
    body: String,
    base_hash: String,
) -> Result<Saved, String> {
    state.run(|k| k.save_body(&HUMAN, &path, &body, &base_hash, Instant::now()))
}

#[tauri::command(async)]
pub fn set_note_meta(
    state: State<'_, OpenVault>,
    path: String,
    key: String,
    value: Option<String>,
) -> Result<NoteFile, String> {
    state.run(|k| k.set_meta(&HUMAN, &path, &key, value.as_deref(), Instant::now()))
}

#[tauri::command(async)]
pub fn trash_note(state: State<'_, OpenVault>, path: String) -> Result<String, String> {
    state.run(|k| k.trash(&HUMAN, &path, Instant::now()))
}

#[tauri::command(async)]
pub fn journal_day(state: State<'_, OpenVault>, date: String) -> Result<NoteFile, String> {
    state.run(|k| k.journal(&HUMAN, &date, Instant::now()))
}

#[tauri::command(async)]
pub fn search_notes(
    state: State<'_, OpenVault>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<Hit>, String> {
    state.run(|k| k.search(&query, limit.unwrap_or(20)))
}

/// Notes whose links go to the note at `path`.
#[tauri::command(async)]
pub fn note_backlinks(state: State<'_, OpenVault>, path: String) -> Result<Vec<Backlink>, String> {
    state.run(|k| k.backlinks(&path))
}

/// Notes about the same things as the note at `path`, linked or not.
#[tauri::command(async)]
pub fn related_notes(
    state: State<'_, OpenVault>,
    path: String,
    limit: Option<usize>,
) -> Result<Vec<Related>, String> {
    state.run(|k| k.related(&path, limit.unwrap_or(8)))
}

#[tauri::command(async)]
pub fn note_mentions(
    state: State<'_, OpenVault>,
    title: String,
    path: String,
) -> Result<Vec<Backlink>, String> {
    state.run(|k| k.mentions(&title, &path))
}

/// Notes that link each day from `from` to `to`, outside to-dos (the calendar).
#[tauri::command(async)]
pub fn day_mentions(
    state: State<'_, OpenVault>,
    from: String,
    to: String,
) -> Result<Vec<DayMention>, String> {
    state.run(|k| k.day_mentions(&from, &to))
}

#[tauri::command(async)]
pub fn list_tasks(state: State<'_, OpenVault>) -> Result<Vec<TaskRow>, String> {
    state.run(Kasten::tasks)
}

#[tauri::command(async)]
pub fn apply_template(
    state: State<'_, OpenVault>,
    path: String,
    template: String,
    date: String,
) -> Result<NoteFile, String> {
    state.run(|k| k.apply_template(&HUMAN, &path, &template, &date, Instant::now()))
}

#[tauri::command(async)]
pub fn list_trash(state: State<'_, OpenVault>) -> Result<Vec<Trashed>, String> {
    state.run(Kasten::list_trash)
}

/// The text of something in the trash, to look at before restoring it.
#[tauri::command(async)]
pub fn read_trashed(state: State<'_, OpenVault>, trashed: String) -> Result<String, String> {
    state.run(|k| k.read_trashed(&trashed))
}

/// Empties the trash, which only the person at the window can do. What
/// goes stays in history, and undoing the commit brings it all back.
#[tauri::command(async)]
pub fn empty_trash(state: State<'_, OpenVault>) -> Result<Emptied, String> {
    state.run(|k| k.empty_trash(&HUMAN, Instant::now()))
}

#[tauri::command(async)]
pub fn restore_note(state: State<'_, OpenVault>, trashed: String) -> Result<NoteFile, String> {
    state.run(|k| k.restore_trashed(&HUMAN, &trashed))
}

#[tauri::command(async)]
pub fn rename_note(
    state: State<'_, OpenVault>,
    path: String,
    title: String,
) -> Result<Renamed, String> {
    state.run(|k| k.rename(&HUMAN, &path, &title, Instant::now()))
}

/// The note turned into a card or page, with every file it moved.
#[tauri::command(async)]
pub fn convert_note(
    state: State<'_, OpenVault>,
    path: String,
    kind: String,
) -> Result<Placed, String> {
    state.run(|k| k.convert_placed(&HUMAN, &path, &kind, Instant::now()))
}

/// The note moved, with its sub-pages: every file it moved.
#[tauri::command(async)]
pub fn move_note(
    state: State<'_, OpenVault>,
    path: String,
    project: Option<String>,
) -> Result<Placed, String> {
    state.run(|k| k.move_placed(&HUMAN, &path, project.as_deref()))
}

/// Moves a note back into the inbox, as Undo of filing it out asks.
#[tauri::command(async)]
pub fn move_to_inbox(state: State<'_, OpenVault>, path: String) -> Result<Placed, String> {
    state.run(|k| k.move_to_inbox(&HUMAN, &path))
}

/// Puts the page at `path` inside the page at `parent`, or with none makes
/// it a page of its own; says where every file went.
#[tauri::command(async)]
pub fn nest_note(
    state: State<'_, OpenVault>,
    path: String,
    parent: Option<String>,
) -> Result<Placed, String> {
    state.run(|k| k.nest_placed(&HUMAN, &path, parent.as_deref(), Instant::now()))
}

/// Stores the order the sub-pages of the page at `parent` show in (their
/// ids, first to last); the page's file is the only one that changes.
#[tauri::command(async)]
pub fn reorder_children(
    state: State<'_, OpenVault>,
    parent: String,
    ids: Vec<String>,
) -> Result<NoteFile, String> {
    state.run(|k| k.reorder_children(&HUMAN, &parent, &ids, Instant::now()))
}

#[tauri::command(async)]
pub fn duplicate_note(state: State<'_, OpenVault>, path: String) -> Result<NoteFile, String> {
    state.run(|k| k.duplicate(&HUMAN, &path, Instant::now()))
}
