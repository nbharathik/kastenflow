//! The window's commands for making and changing smart pages by hand: start
//! one from a starter or a template of the person's own, turn an ordinary
//! page into one, keep one as a template, and the code editor's reads and
//! writes of a page's files. Each runs as a person through the core's ops
//! (`Kasten::smart_*`), which hold every limit and path check; only the
//! window's own code can call them (a page's frame has no way to a command).

use kasten_core::history::Actor;
use kasten_core::smart::SmartListing;
use kasten_core::smart::ops::{Deleted, Written};
use kasten_core::{Instant, Kasten, MadeSmart, NewSmartPage, SavedSmartTemplate};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::{kit, page, starters, trust};
use crate::commands::notes::OpenVault;

/// A starter or template, as the picker lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterInfo {
    /// What the other commands take: a starter's name, or `mine:<slug>`.
    pub id: String,
    pub name: String,
    pub summary: String,
    /// A template of the person's own.
    pub mine: bool,
}

/// What a starter or template makes a page from.
struct Material {
    name: String,
    body: Option<String>,
    files: Vec<(String, Vec<u8>)>,
    /// A file of the person's template the files come from; a starter has none.
    source: Option<String>,
}

/// The starters the app ships, then the person's own templates.
pub fn list(kasten: Option<&Kasten>) -> Vec<StarterInfo> {
    let mut out: Vec<StarterInfo> = starters::STARTERS
        .iter()
        .map(|s| StarterInfo {
            id: s.id.to_owned(),
            name: s.name.to_owned(),
            summary: s.summary.to_owned(),
            mine: false,
        })
        .collect();
    if let Some(Ok(mine)) = kasten.map(Kasten::smart_templates) {
        out.extend(mine.into_iter().map(|t| StarterInfo {
            id: format!("{}{}", starters::MINE, t.slug),
            name: t.name,
            summary: "Your own template".to_owned(),
            mine: true,
        }));
    }
    out
}

fn material(kasten: &Kasten, id: &str) -> Result<Material, String> {
    if let Some(slug) = id.strip_prefix(starters::MINE) {
        let template = kasten.smart_template(slug).map_err(|e| e.to_string())?;
        return Ok(Material {
            // So a page made from a template of an agent's page is still told as the agent's.
            source: Some(template.source()),
            name: template.name,
            body: template.body,
            files: template.files,
        });
    }
    let starter =
        starters::find(id).ok_or_else(|| format!("There is no starter called “{id}”."))?;
    Ok(Material {
        name: starter.name.to_owned(),
        body: Some(starter.body.to_owned()),
        files: starter
            .files
            .iter()
            .map(|(path, text)| ((*path).to_owned(), text.as_bytes().to_vec()))
            .collect(),
        source: None,
    })
}

fn pairs(files: &[(String, Vec<u8>)]) -> Vec<(&str, &[u8])> {
    files
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect()
}

/// Makes a smart page from the starter or template `starter`, in `project`
/// (a folder under `projects/`) if given, and returns it. `title` names it;
/// the starter's own name is the default.
pub fn make(
    kasten: &Kasten,
    starter: &str,
    project: Option<&str>,
    title: Option<&str>,
    now: Instant,
) -> Result<MadeSmart, String> {
    let from = material(kasten, starter)?;
    let named = title.map(str::trim).filter(|t| !t.is_empty());
    let request = NewSmartPage {
        title: named.unwrap_or(&from.name),
        project,
        parent: None,
        body: from.body.as_deref(),
        files: &pairs(&from.files),
        copy_of: from.source.as_deref(),
    };
    kasten
        .smart_new_page(&Actor::Human, &request, now)
        .map_err(|e| e.to_string())
}

/// With History off nothing says who made a page, so where agents are held to
/// Review every smart page waits for "Allow to run". A page the person has
/// just made from a starter the app ships is theirs for certain: it is allowed
/// at once. One made from a template of their own is not (the template may
/// have been made of an agent's page), and keeps asking. Says whether the page
/// was allowed.
pub fn allow_a_page_just_made(
    kasten: &Kasten,
    dir: &std::path::Path,
    made: &MadeSmart,
    starter: &str,
) -> Result<bool, String> {
    if kasten.has_history() || starter.starts_with(starters::MINE) {
        return Ok(false);
    }
    let Some(id) = made.id.as_deref() else {
        return Ok(false);
    };
    super::settings::set_allowed(dir, id)?;
    Ok(true)
}

/// The starters and the person's own templates.
#[tauri::command(async)]
pub fn smart_starters(state: State<'_, OpenVault>) -> Vec<StarterInfo> {
    list(state.require().ok().as_deref())
}

/// Makes a smart page from a starter or template, in one commit that Undo
/// takes back.
#[tauri::command(async)]
pub fn smart_new_page(
    app: AppHandle,
    state: State<'_, OpenVault>,
    starter: String,
    project: Option<String>,
    title: Option<String>,
) -> Result<MadeSmart, String> {
    let kasten = state.require()?;
    let made = make(
        &kasten,
        &starter,
        project.as_deref(),
        title.as_deref(),
        Instant::now(),
    )?;
    // A choice kept in the app's data folder; a failure to keep it only means one more click.
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = allow_a_page_just_made(&kasten, &dir, &made, &starter);
    }
    Ok(made)
}

/// Turns the page at `page` into a smart page, keeping its text: a minimal
/// folder from the starter or template, unless the page already has one.
#[tauri::command(async)]
pub fn smart_turn_into(
    state: State<'_, OpenVault>,
    page: String,
    starter: String,
) -> Result<MadeSmart, String> {
    let kasten = state.require()?;
    let from = material(&kasten, &starter)?;
    kasten
        .smart_turn_into(&Actor::Human, &page, &pairs(&from.files), Instant::now())
        .map_err(|e| e.to_string())
}

/// A page an agent made that no person has allowed to run yet is not turned
/// into a page of a person's own by keeping it as a template (a page made from
/// a template counts as the person's, and runs without asking).
pub fn may_keep(
    kasten: &Kasten,
    note: &kasten_core::NoteFile,
    data_dir: Option<&std::path::Path>,
    now: Instant,
) -> Result<(), String> {
    let held = trust::trust(kasten, note, data_dir, now);
    if held.needs_allow {
        return Err(format!(
            "“{}” was made by {} and has not been allowed to run yet. Allow it first, then keep it as a template.",
            note.meta.title,
            held.made_by.unwrap_or_else(|| "an agent".to_owned())
        ));
    }
    Ok(())
}

/// Keeps the smart page at `page` as a template of the person's own.
#[tauri::command(async)]
pub fn smart_save_template(
    app: AppHandle,
    state: State<'_, OpenVault>,
    page: String,
    name: String,
) -> Result<SavedSmartTemplate, String> {
    let kasten = state.require()?;
    let note = page::read(&kasten, &page)?;
    may_keep(
        &kasten,
        &note,
        app.path().app_local_data_dir().ok().as_deref(),
        Instant::now(),
    )?;
    kasten
        .smart_save_template(&Actor::Human, &page, &name, Instant::now())
        .map_err(|e| e.to_string())
}

/// The files of the page's code folder.
#[tauri::command(async)]
pub fn smart_files(state: State<'_, OpenVault>, page: String) -> Result<SmartListing, String> {
    let kasten = state.require()?;
    page::read(&kasten, &page)?;
    kasten.smart_read(&page).map_err(|e| e.to_string())
}

/// One file of the folder: its text when it is text, its bytes when it is a picture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub hash: String,
    pub text: Option<String>,
    pub bytes: Option<Vec<u8>>,
}

#[tauri::command(async)]
pub fn smart_file_read(
    state: State<'_, OpenVault>,
    page: String,
    path: String,
) -> Result<FileContent, String> {
    let kasten = state.require()?;
    page::read(&kasten, &page)?;
    let file = kasten.smart_file(&page, &path).map_err(|e| e.to_string())?;
    let text = file.text().map(str::to_owned);
    Ok(FileContent {
        path: file.path,
        hash: file.hash,
        bytes: text.is_none().then_some(file.bytes),
        text,
    })
}

/// Why a write did not happen: the file changed on disk since it was read
/// (the editor offers a choice), or any other reason in plain words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WriteRefused {
    pub code: &'static str,
    pub message: String,
}

/// Saves a file of the page against the hash it was read with (`""` for a new
/// file). A file that is no longer what the editor read is refused with the
/// code `conflict` and nothing is written.
pub fn write_file(
    kasten: &Kasten,
    page: &str,
    path: &str,
    text: &str,
    base_hash: Option<&str>,
    now: Instant,
) -> Result<Written, WriteRefused> {
    let refuse = |message: String| WriteRefused {
        code: "refused",
        message,
    };
    page::read(kasten, page).map_err(refuse)?;
    kasten
        .smart_write_file(&Actor::Human, page, path, text.as_bytes(), base_hash, now)
        .map_err(|err| {
            // A file read earlier that is not what the editor read (`conflict`), or is not there any
            // more (`gone`: "Keep mine" makes it again).
            let now = base_hash
                .filter(|base| !base.is_empty())
                .map(|base| (base, kasten.smart_file(page, path)));
            let code = match now {
                Some((_, Err(kasten_core::Error::NotFound(_)))) => "gone",
                Some((base, Ok(file))) if file.hash != base => "conflict",
                _ => "refused",
            };
            WriteRefused {
                code,
                message: err.to_string(),
            }
        })
}

#[tauri::command(async)]
pub fn smart_file_write(
    state: State<'_, OpenVault>,
    page: String,
    path: String,
    text: String,
    base_hash: Option<String>,
) -> Result<Written, WriteRefused> {
    let kasten = state.require().map_err(|message| WriteRefused {
        code: "refused",
        message,
    })?;
    write_file(
        &kasten,
        &page,
        &path,
        &text,
        base_hash.as_deref(),
        Instant::now(),
    )
}

/// Takes a file out of the folder; it goes to the trash and can come back.
#[tauri::command(async)]
pub fn smart_file_delete(
    state: State<'_, OpenVault>,
    page: String,
    path: String,
) -> Result<Deleted, String> {
    let kasten = state.require()?;
    page::read(&kasten, &page)?;
    kasten
        .smart_delete_file(&Actor::Human, &page, &path, Instant::now())
        .map_err(|e| e.to_string())
}

/// The kit's files, by path, for a copy of a page that has to stand alone.
#[tauri::command(async)]
pub fn smart_kit_files() -> Vec<(String, String)> {
    kit::FILES
        .iter()
        .map(|(path, text)| ((*path).to_owned(), (*text).to_owned()))
        .collect()
}
