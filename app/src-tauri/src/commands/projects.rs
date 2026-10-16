//! Tauri commands for projects: their state and summaries, and the setups that
//! start one. Each maps to one kasten-core op.

use kasten_core::{
    AppliedSetup, Instant, NoteFile, ProjectState, ProjectSummary, SetupInfo, SetupPlan,
    SetupTarget,
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

/// The setups on offer.
#[tauri::command]
pub fn list_setups() -> Vec<SetupInfo> {
    kasten_core::setups()
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
