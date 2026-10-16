//! The changes a chat thread has staged for the person to review, apply or
//! discard. A chat that previews its changes writes nothing to the vault: its
//! writes wait here, file by file, with the text they started from, until the
//! person applies them together (one commit, approved by them) or throws them
//! away. The window reads them with `chat_changes`.

use kasten_core::agent::{ApplyOutcome, ChangeSet, Dropped, FileKind};
use kasten_core::diff::unified;
use kasten_core::{Instant, Kasten};
use serde::Serialize;
use tauri::State;

use super::state::{ChatState, blocking};
use super::threads::Changes;
use crate::commands::agents::owner;
use crate::commands::notes::OpenVault;

/// One file of the set, before and after.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileView {
    pub path: String,
    /// What it is: `note`, `deck`, `diagram` or `board`.
    pub kind: FileKind,
    pub title: String,
    /// The chat makes this file; it is not in the vault.
    pub new: bool,
    /// The file as the vault had it when the chat first changed it; none for a new file.
    pub before: Option<String>,
    /// The file as the set would leave it.
    pub after: String,
    /// The change as a unified diff.
    pub diff: String,
    /// The vault changed this file since, in a way that cannot be put
    /// together with the set's change.
    pub stale: bool,
    /// A diagram as the program draws it before and after the change, for
    /// looking at the change as pictures. Left out for other files, and when
    /// the program cannot draw that version.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_svg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_svg: Option<String>,
}

/// A picture the chat added.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PictureView {
    pub path: String,
    pub name: String,
    pub bytes: u64,
}

/// One thing the chat did, in words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StepView {
    pub summary: String,
    pub paths: Vec<String>,
}

/// Everything a thread has staged.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangesView {
    pub id: String,
    pub files: Vec<FileView>,
    pub pictures: Vec<PictureView>,
    pub steps: Vec<StepView>,
}

/// What recalculating a set kept and what it could not make again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Recalculated {
    pub dropped: Vec<Dropped>,
}

fn title_of(kasten: &Kasten, set: &ChangeSet, path: &str, kind: FileKind, text: &str) -> String {
    let named = match kind {
        FileKind::Note => kasten
            .staged_note(set, path)
            .map(|note| note.meta.title)
            .filter(|t| !t.is_empty()),
        FileKind::Deck => kasten_core::deck::head_of(text).ok().and_then(|h| h.title),
        FileKind::Diagram => Some(kasten_core::diagrams::title_of(path)),
        FileKind::Board => None,
    };
    named.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| {
        let name = path.rsplit('/').next().unwrap_or(path);
        name.rsplit_once('.')
            .map_or(name, |(stem, _)| stem)
            .to_owned()
    })
}

/// The program's drawings of a diagram's two versions; none for any other file.
fn drawn(kind: FileKind, before: Option<&str>, after: &str) -> (Option<String>, Option<String>) {
    if kind != FileKind::Diagram {
        return (None, None);
    }
    let draw = |xml: &str| crate::commands::diagrams::draft_svg(xml).ok();
    (before.and_then(draw), draw(after))
}

/// What the set holds, file by file, with the vault's changes since marked.
pub(crate) fn view_of(kasten: &Kasten, set: &ChangeSet) -> Result<ChangesView, String> {
    let stale = kasten
        .stale_changes(set, Instant::now())
        .map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for (path, file) in &set.files {
        let (before_svg, after_svg) = drawn(file.kind, Some(&file.base), &file.text);
        files.push(FileView {
            title: title_of(kasten, set, path, file.kind, &file.text),
            diff: unified(path, &file.base, &file.text, 3),
            before: Some(file.base.clone()),
            after: file.text.clone(),
            kind: file.kind,
            new: false,
            stale: stale.contains(path),
            path: path.clone(),
            before_svg,
            after_svg,
        });
    }
    for file in &set.created_files {
        let (before_svg, after_svg) = drawn(file.kind, None, &file.text);
        files.push(FileView {
            title: title_of(kasten, set, &file.provisional, file.kind, &file.text),
            diff: unified(&file.provisional, "", &file.text, 3),
            before: None,
            after: file.text.clone(),
            kind: file.kind,
            new: true,
            stale: stale.contains(&file.provisional),
            path: file.provisional.clone(),
            before_svg,
            after_svg,
        });
    }
    Ok(ChangesView {
        id: set.id.clone(),
        files,
        pictures: set
            .assets
            .iter()
            .map(|a| PictureView {
                path: a.provisional.clone(),
                name: a.name.clone(),
                bytes: a.bytes,
            })
            .collect(),
        steps: set
            .steps
            .iter()
            .map(|s| StepView {
                summary: s.summary.clone(),
                paths: s.paths.clone(),
            })
            .collect(),
    })
}

fn locked(changes: &Changes) -> std::sync::MutexGuard<'_, ChangeSet> {
    changes.lock().unwrap_or_else(|p| p.into_inner())
}

/// An empty set for the same thread, in place of one that was applied or
/// discarded.
fn emptied(old: &ChangeSet) -> ChangeSet {
    let now = Instant::now();
    ChangeSet::new(
        kasten_core::ulid_at(now.millis),
        &old.session,
        &old.client,
        now.millis,
    )
}

/// Applies the thread's set as the person: written together, or left alone
/// and said stale. A set that was written is replaced by an empty one.
pub(crate) fn apply(kasten: &Kasten, changes: &Changes) -> Result<ApplyOutcome, String> {
    let mut set = locked(changes);
    let outcome = kasten
        .apply_changes(&set, &owner(), Instant::now())
        .map_err(|e| e.to_string())?;
    if matches!(outcome, ApplyOutcome::Applied { .. }) {
        *set = emptied(&set);
    }
    Ok(outcome)
}

/// Plans the thread's steps again on the vault as it is now.
pub(crate) fn recalculate(kasten: &Kasten, changes: &Changes) -> Result<Recalculated, String> {
    let mut set = locked(changes);
    let (fresh, dropped) = kasten
        .rebase_changes(&set, Instant::now())
        .map_err(|e| e.to_string())?;
    *set = fresh;
    Ok(Recalculated { dropped })
}

/// Throws the thread's set away.
pub(crate) fn discard(kasten: &Kasten, changes: &Changes) -> Result<(), String> {
    let mut set = locked(changes);
    kasten.discard_changes(&set).map_err(|e| e.to_string())?;
    *set = emptied(&set);
    Ok(())
}

/// The thread's set, or why there is none.
fn changes_of(state: &ChatState, chat: &str) -> Result<Changes, String> {
    state
        .chats
        .changes(chat)
        .ok_or_else(|| "This chat has no staged changes".to_owned())
}

/// Changes that wait while the chat is answering would be changed under it.
fn idle(state: &ChatState, chat: &str) -> Result<(), String> {
    if state.chats.running(chat) {
        return Err("This chat is still answering; stop it first".to_owned());
    }
    Ok(())
}

/// What the chat has staged, to look at.
#[tauri::command]
pub async fn chat_changes(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    chat: String,
) -> Result<ChangesView, String> {
    let kasten = vault.require()?;
    let Some(changes) = state.chats.changes(&chat) else {
        return Ok(ChangesView {
            id: String::new(),
            files: Vec::new(),
            pictures: Vec::new(),
            steps: Vec::new(),
        });
    };
    blocking(move || view_of(&kasten, &locked(&changes))).await
}

/// Writes what the chat staged, as one commit approved by the person.
#[tauri::command]
pub async fn chat_apply_changes(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    chat: String,
) -> Result<ApplyOutcome, String> {
    let kasten = vault.require()?;
    idle(&state, &chat)?;
    let changes = changes_of(&state, &chat)?;
    blocking(move || apply(&kasten, &changes)).await
}

/// Plans the chat's staged steps again on the vault as it is now.
#[tauri::command]
pub async fn chat_recalc_changes(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    chat: String,
) -> Result<Recalculated, String> {
    let kasten = vault.require()?;
    idle(&state, &chat)?;
    let changes = changes_of(&state, &chat)?;
    blocking(move || recalculate(&kasten, &changes)).await
}

/// Throws away what the chat staged. The vault is not touched.
#[tauri::command]
pub async fn chat_discard_changes(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    chat: String,
) -> Result<(), String> {
    let kasten = vault.require()?;
    idle(&state, &chat)?;
    let changes = changes_of(&state, &chat)?;
    blocking(move || discard(&kasten, &changes)).await
}
