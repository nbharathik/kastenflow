//! Tauri commands for projects: their state and summaries, and the setups that
//! start one. Each maps to one kasten-core op.

use kasten_core::{
    AppliedSetup, Instant, NoteFile, ProjectState, ProjectSummary, SavedSetup, SetupGone,
    SetupInfo, SetupPlan, SetupSource, SetupTarget,
};
use tauri::State;

use super::notes::{HUMAN, OpenVault};

/// Changes a project page's status, health, next action and review days in
/// one commit. `change` leaves a key out to keep it and sends null to remove it.
#[tauri::command(async)]
pub fn set_project_state(
    state: State<'_, OpenVault>,
    path: String,
    change: ProjectState,
) -> Result<NoteFile, String> {
    state.run(|k| k.set_project_state(&HUMAN, &path, &change, Instant::now()))
}

/// Every project with its counts and state. `today` is the person's day.
#[tauri::command(async)]
pub fn project_summaries(
    state: State<'_, OpenVault>,
    today: String,
) -> Result<Vec<ProjectSummary>, String> {
    state.run(|k| k.project_summaries(&today))
}

/// The setups on offer: the built-in ones, then the ones saved from projects.
#[tauri::command(async)]
pub fn list_setups(state: State<'_, OpenVault>) -> Result<Vec<SetupInfo>, String> {
    state.run(|k| k.list_setups())
}

/// What a project has that a setup could keep: its pages, tags and properties.
#[tauri::command(async)]
pub fn preview_project_setup(
    state: State<'_, OpenVault>,
    project: String,
) -> Result<SetupSource, String> {
    state.run(|k| k.preview_project_setup(&project))
}

/// Saves a project as a setup, keeping the pages in `pages`, in one commit.
#[tauri::command(async)]
pub fn save_project_setup(
    state: State<'_, OpenVault>,
    project: String,
    slug: String,
    title: String,
    pages: Vec<String>,
) -> Result<SavedSetup, String> {
    state.run(|k| k.save_project_setup(&HUMAN, &project, &slug, &title, &pages, Instant::now()))
}

/// Gives a saved setup another name.
#[tauri::command(async)]
pub fn rename_setup(
    state: State<'_, OpenVault>,
    id: String,
    name: String,
) -> Result<SetupInfo, String> {
    state.run(|k| k.rename_setup(&HUMAN, &id, &name, Instant::now()))
}

/// Moves a saved setup to the trash.
#[tauri::command(async)]
pub fn trash_setup(state: State<'_, OpenVault>, id: String) -> Result<SetupGone, String> {
    state.run(|k| k.trash_setup(&HUMAN, &id, Instant::now()))
}

/// What applying a setup would write and keep.
#[tauri::command(async)]
pub fn preview_setup(
    state: State<'_, OpenVault>,
    id: String,
    target: SetupTarget,
) -> Result<SetupPlan, String> {
    state.run(|k| k.preview_setup(&id, &target))
}

/// Adds a setup's files in one commit that undo takes back.
#[tauri::command(async)]
pub fn apply_setup(
    state: State<'_, OpenVault>,
    id: String,
    target: SetupTarget,
) -> Result<AppliedSetup, String> {
    state.run(|k| k.apply_setup(&HUMAN, &id, &target, Instant::now()))
}
