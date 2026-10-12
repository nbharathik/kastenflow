//! Diagrams: a `.drawio` source and the `.drawio.svg` picture beside it,
//! listed, read and saved together. The XML and the SVG are the editor's own;
//! the commands only carry them to and from the vault's ops.

use kasten_core::Instant;
use kasten_core::diagrams::{DiagramFile, DiagramInfo, DiagramMoved, DiagramSaved};
use tauri::State;
use tauri::ipc::{InvokeBody, Request};

use super::assets::percent_decode;
use super::notes::{HUMAN, OpenVault};

#[tauri::command(async)]
pub fn list_diagrams(state: State<'_, OpenVault>) -> Result<Vec<DiagramInfo>, String> {
    state.run(|k| k.diagrams())
}

/// The diagram at `path` with the hash a save must bring back.
#[tauri::command(async)]
pub fn read_diagram(state: State<'_, OpenVault>, path: String) -> Result<DiagramFile, String> {
    state.run(|k| k.diagram(&path))
}

/// The picture beside the diagram, as SVG text; None when it has none.
#[tauri::command(async)]
pub fn read_diagram_preview(
    state: State<'_, OpenVault>,
    path: String,
) -> Result<Option<String>, String> {
    state.run(|k| k.diagram_preview(&path))
}

/// Creates a diagram in `project` or the library, from `xml` or with one
/// empty page; returns its path.
#[tauri::command(async)]
pub fn create_diagram(
    state: State<'_, OpenVault>,
    title: String,
    project: Option<String>,
    xml: Option<String>,
) -> Result<String, String> {
    state.run(|k| {
        k.create_diagram(
            &HUMAN,
            &title,
            project.as_deref(),
            xml.as_deref(),
            Instant::now(),
        )
    })
}

/// Makes a diagram from the request's body, a file another program wrote.
/// Its name comes in the `x-name` header and the project, if any, in
/// `x-project`, both percent-encoded since header values are ASCII.
#[tauri::command(async)]
pub fn import_diagram(state: State<'_, OpenVault>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The file's bytes did not arrive".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(percent_decode)
    };
    let name = header("x-name").ok_or("The file's name did not arrive")?;
    let project = header("x-project");
    state.run(|k| k.import_diagram(&HUMAN, &name, bytes, project.as_deref(), Instant::now()))
}

/// Saves the editor's source (and with it its picture) if the file is still
/// the one it read; if not, they go to a copy and the file is left alone.
#[tauri::command(async)]
pub fn save_diagram(
    state: State<'_, OpenVault>,
    path: String,
    xml: String,
    svg: Option<String>,
    base_hash: String,
) -> Result<DiagramSaved, String> {
    state.run(|k| {
        k.save_diagram(
            &HUMAN,
            &path,
            &xml,
            svg.as_deref(),
            &base_hash,
            Instant::now(),
        )
    })
}

/// Saves a picture drawn again, only for the source that has `source_hash`.
#[tauri::command(async)]
pub fn save_diagram_preview(
    state: State<'_, OpenVault>,
    path: String,
    svg: String,
    source_hash: String,
) -> Result<DiagramFile, String> {
    state.run(|k| k.save_diagram_preview(&HUMAN, &path, &svg, &source_hash, Instant::now()))
}

/// Gives a diagram a new title; both files follow, and so do the links.
#[tauri::command(async)]
pub fn rename_diagram(
    state: State<'_, OpenVault>,
    path: String,
    title: String,
) -> Result<DiagramMoved, String> {
    state.run(|k| k.rename_diagram(&HUMAN, &path, &title, Instant::now()))
}

/// Moves a diagram into `project`, or with None into the library.
#[tauri::command(async)]
pub fn move_diagram(
    state: State<'_, OpenVault>,
    path: String,
    project: Option<String>,
) -> Result<DiagramMoved, String> {
    state.run(|k| k.move_diagram(&HUMAN, &path, project.as_deref(), Instant::now()))
}

/// Copies a diagram beside itself; returns the copy's path.
#[tauri::command(async)]
pub fn duplicate_diagram(state: State<'_, OpenVault>, path: String) -> Result<String, String> {
    state.run(|k| k.duplicate_diagram(&HUMAN, &path, Instant::now()))
}

/// Puts a trashed diagram back with its picture; returns where it went.
#[tauri::command(async)]
pub fn restore_diagram(state: State<'_, OpenVault>, trashed: String) -> Result<String, String> {
    state.run(|k| k.restore_diagram(&HUMAN, &trashed))
}
