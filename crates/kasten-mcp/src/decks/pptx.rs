//! PowerPoint files for the vault's decks: a deck written out, and a file of
//! the vault read in as a new deck. slides-pptx does the format; this only
//! gives it the vault's pictures to read and takes the pictures it finds to
//! `assets/`, where every picture of a vault lives.

use std::sync::Mutex;

use kasten_core::agent::{ChangeSet, DeckImport, Session};
use kasten_core::assets::NewAsset;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use slides_core::agent::{StoreError, StoreResult};
use slides_core::lint::Refs;
use slides_core::{Deck, canonical};
use slides_pptx::import::{ImportOptions, import};
use slides_pptx::{Media, Options, export_with};

use super::marks;
use super::store::{Request, failed};
use crate::tools::locked;

/// The pictures of a deck, read from the vault's `assets/`, and from the
/// pictures a chat has staged and not yet applied.
struct Pictures<'a>(&'a Kasten, Option<&'a Mutex<ChangeSet>>);

impl Media for Pictures<'_> {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        if let Some(set) = self.1
            && let Ok(Some(bytes)) = self.0.staged_asset_bytes(&locked(set), path)
        {
            return Some(bytes);
        }
        self.0.read_asset(path).ok()
    }
}

fn describe(slide: &Option<String>, element: &Option<String>, message: &str) -> String {
    let slide = slide
        .as_deref()
        .map(|s| format!("slide {s}: "))
        .unwrap_or_default();
    let element = element
        .as_deref()
        .map(|e| format!("element {e}: "))
        .unwrap_or_default();
    format!("{slide}{element}{message}")
}

/// The deck as a PowerPoint file, and what could not be written exactly. Citations are written as
/// the editor shows them when the vault has a bibliography.
pub(super) fn export(
    kasten: &Kasten,
    staged: Option<&Mutex<ChangeSet>>,
    deck: &Deck,
    refs: Option<&Refs>,
) -> StoreResult<(Vec<u8>, Vec<String>)> {
    let made = export_with(deck, &Pictures(kasten, staged), &Options::default(), refs)
        .map_err(|e| StoreError::Invalid(e.to_string()))?;
    let warnings = made
        .warnings
        .iter()
        .map(|w| describe(&w.slide, &w.element, &w.message))
        .collect();
    Ok((made.bytes, warnings))
}

/// A file kept from an export: a PowerPoint file goes to `assets/`. A Markdown outline is not kept as
/// a file, since a vault reads every `.md` file as a note.
pub(super) fn keep_export(
    kasten: &Kasten,
    actor: &Actor,
    deck: &str,
    extension: &str,
    bytes: &[u8],
) -> StoreResult<slides_core::agent::Written> {
    if extension != "pptx" {
        return Err(StoreError::Unavailable(format!(
            "A .{extension} file is not kept in a vault. get_outline gives a deck's outline as Markdown, and create_note keeps it as a note."
        )));
    }
    let name = deck.rsplit('/').next().unwrap_or(deck);
    let stem = name.strip_suffix(".deck").unwrap_or(name);
    let added = kasten
        .add_asset(
            actor,
            &format!("{stem}.{extension}"),
            bytes,
            &NewAsset::default(),
            Instant::now(),
        )
        .map_err(failed)?;
    Ok(slides_core::agent::Written {
        path: added.path,
        bytes: bytes.len() as u64,
    })
}

/// A picture a PowerPoint file brings, before it is kept.
pub(super) struct Picture {
    /// The path the deck names it by.
    pub path: String,
    pub bytes: Vec<u8>,
}

impl Picture {
    /// The name it is kept under in `assets/`.
    pub fn name(&self) -> &str {
        self.path.strip_prefix("assets/").unwrap_or(&self.path)
    }
}

/// A deck read from a PowerPoint file. Nothing of it is kept yet.
pub(super) struct Read {
    pub title: String,
    /// The deck's text, its pictures named as the file names them.
    pub text: String,
    pub pictures: Vec<Picture>,
    pub warnings: Vec<String>,
}

/// `text` with each picture that was kept under another name pointing at that name.
pub(super) fn renamed(text: String, moved: &[(String, String)]) -> String {
    moved.iter().fold(text, |text, (from, to)| {
        match (serde_json::to_string(from), serde_json::to_string(to)) {
            (Ok(from), Ok(to)) => text.replace(&from, &to),
            _ => text,
        }
    })
}

/// A title made of a file's name: what a title cannot hold (brackets, bars,
/// line breaks) becomes a space, and runs of spaces one.
fn title_of(stem: &str) -> String {
    stem.chars()
        .map(|c| {
            if matches!(c, '[' | ']' | '|' | '\n' | '\r') {
                ' '
            } else {
                c
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Reads the PowerPoint file `bytes` (from `path`) as a deck. A title that is
/// asked for is used as it is; otherwise the file's name makes one, cleaned of
/// what a title cannot hold. The title inside the file is not used: it is often
/// a template's, and one with brackets would make the import fail.
pub(super) fn read(path: &str, bytes: &[u8], title: Option<&str>, seed: u64) -> StoreResult<Read> {
    let stem = std::path::Path::new(path)
        .file_stem()
        .map(|s| title_of(&s.to_string_lossy()))
        .filter(|t| !t.is_empty());
    let options = ImportOptions {
        seed,
        title: title.map(str::to_owned).or(stem),
        ..ImportOptions::default()
    };
    let made = import(bytes, &options).map_err(|e| {
        StoreError::Invalid(format!(
            "`{path}` is not a PowerPoint file this can read: {e}"
        ))
    })?;
    let text = canonical::write(&made.deck).map_err(|e| StoreError::Invalid(e.to_string()))?;
    let warnings = made
        .report
        .warnings
        .iter()
        .map(|w| describe(&w.slide, &w.element, &w.message))
        .collect();
    Ok(Read {
        title: made.deck.title.clone(),
        text,
        pictures: made
            .media
            .into_iter()
            .map(|file| Picture {
                path: file.path,
                bytes: file.bytes,
            })
            .collect(),
        warnings,
    })
}

/// Makes a deck for `session` of the PowerPoint file `bytes` (from `path`),
/// with the pictures it holds: one commit, in the project the request names.
/// Answers the new deck's path and what was read.
pub(super) fn import_deck(
    kasten: &Kasten,
    session: &Session,
    request: &Request,
    path: &str,
    bytes: &[u8],
    title: Option<&str>,
    seed: u64,
) -> StoreResult<(String, Read)> {
    let read = read(path, bytes, title, seed)?;
    let pictures: Vec<(&str, &[u8])> = read
        .pictures
        .iter()
        .map(|p| (p.name(), p.bytes.as_slice()))
        .collect();
    let import = DeckImport {
        title: &read.title,
        project: request.project.as_deref(),
        tool: &request.tool,
        pictures: &pictures,
        sent: request.sent,
    };
    let now = Instant::now();
    let done = kasten
        .agent_import_deck(
            session,
            &import,
            |kept| {
                // A picture kept under another name is named so in the deck.
                let moved: Vec<(String, String)> = read
                    .pictures
                    .iter()
                    .zip(kept)
                    .filter(|(p, at)| p.path != **at)
                    .map(|(p, at)| (p.path.clone(), at.clone()))
                    .collect();
                let text = renamed(read.text.clone(), &moved);
                marks::marked_new(&text, session, now).unwrap_or(text)
            },
            now,
        )
        .map_err(failed)?;
    Ok((done.path, read))
}
