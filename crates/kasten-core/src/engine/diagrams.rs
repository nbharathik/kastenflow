//! Diagrams through the engine, for the app and the MCP tools: a person's
//! saves are written at once and committed after a pause, like typing; an
//! agent's are committed at once. A diagram is two files, and every op that
//! touches one says so in its commit.

use super::{Change, Kasten};
use crate::diagrams::{
    self, DiagramFile, DiagramInfo, DiagramMoved, DiagramSaved, Moves, sidecar_of, title_of,
};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;
use crate::vault::Vault;

/// Both ends of every move, then the rest.
fn touched(moves: &[(String, String)], rest: &[String]) -> Vec<String> {
    moves
        .iter()
        .flat_map(|(from, to)| [from.clone(), to.clone()])
        .chain(rest.iter().cloned())
        .collect()
}

/// Rewrites the pages' links and the boards' cards that named the source
/// after it moved; returns what was written.
fn relink(vault: &Vault, moves: &[(String, String)], bare_follows: bool) -> Result<Vec<String>> {
    let Some((old, new)) = moves.first() else {
        return Ok(Vec::new());
    };
    let mut written = diagrams::relink_pages(vault, old, new, bare_follows)?;
    written.extend(crate::board::relink_boards(vault, moves)?);
    Ok(written)
}

impl Kasten {
    /// Every diagram, by title.
    pub fn diagrams(&self) -> Result<Vec<DiagramInfo>> {
        diagrams::list(&self.vault)
    }

    /// The diagram at `path`, with the hash a save brings back.
    pub fn diagram(&self, path: &str) -> Result<DiagramFile> {
        diagrams::read_diagram(&self.vault, path)
    }

    /// The picture beside the diagram at `path`, if it has one.
    pub fn diagram_preview(&self, path: &str) -> Result<Option<String>> {
        diagrams::read_preview(&self.vault, path)
    }

    /// A diagram's path from its path or title.
    pub fn resolve_diagram(&self, reference: &str) -> Result<String> {
        let r = reference.trim();
        if r.ends_with(diagrams::EXT)
            && self
                .vault
                .file_of(r, &[diagrams::EXT])
                .is_ok_and(|p| p.is_file())
        {
            return Ok(r.to_owned());
        }
        let found: Vec<DiagramInfo> = self
            .diagrams()?
            .into_iter()
            .filter(|d| d.title.eq_ignore_ascii_case(r))
            .collect();
        match found.as_slice() {
            [one] => Ok(one.path.clone()),
            [] => Err(Error::Invalid(format!("No diagram called “{r}”"))),
            many => Err(Error::Invalid(format!(
                "Several diagrams are called “{r}”; name one by path: {}",
                many.iter()
                    .map(|d| d.path.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }

    /// Creates a diagram titled `title` in `project` or the library, from
    /// `xml` or with one empty page; returns its path.
    pub fn create_diagram(
        &self,
        actor: &Actor,
        title: &str,
        project: Option<&str>,
        xml: Option<&str>,
        now: Instant,
    ) -> Result<String> {
        self.apply(actor, "create_diagram", false, now.millis, |vault| {
            let path = diagrams::create_diagram(vault, title, project, xml)?;
            Ok(Change {
                message: format!("diagram: create {}", title.trim()),
                paths: vec![path.clone()],
                value: path,
            })
        })
    }

    /// `create_diagram` for what an agent makes: with the source, the draft
    /// picture of it in the same commit, so the diagram can be seen at once
    /// (the editor draws the exact one the next time it is at hand).
    pub fn create_diagram_drawn(
        &self,
        actor: &Actor,
        title: &str,
        project: Option<&str>,
        xml: Option<&str>,
        now: Instant,
    ) -> Result<String> {
        self.apply(actor, "create_diagram", false, now.millis, |vault| {
            let path = diagrams::create_diagram(vault, title, project, xml)?;
            let mut paths = vec![path.clone()];
            // The picture is only derived: a source that cannot be drawn is kept without one.
            if let Some(svg) = xml.and_then(diagrams::draft_for)
                && diagrams::write_draft(vault, &path, &svg).unwrap_or(false)
            {
                paths.push(sidecar_of(&path));
            }
            Ok(Change {
                message: format!("diagram: create {}", title.trim()),
                paths,
                value: path,
            })
        })
    }

    /// Makes a diagram from a file another program wrote (`.drawio`, `.xml`,
    /// `.drawio.svg` or `.drawio.png`); returns its path.
    pub fn import_diagram(
        &self,
        actor: &Actor,
        name: &str,
        bytes: &[u8],
        project: Option<&str>,
        now: Instant,
    ) -> Result<String> {
        self.apply(actor, "import_diagram", false, now.millis, |vault| {
            let path = diagrams::import_diagram(vault, name, bytes, project)?;
            Ok(Change {
                message: format!("diagram: import {}", title_of(&path)),
                paths: diagrams::files_of(vault, &path),
                value: path,
            })
        })
    }

    /// Saves a diagram's source, and with it its picture, if the file is
    /// still the one read (`base_hash`); if it changed, the editor's version
    /// goes to a copy and the file is left alone.
    pub fn save_diagram(
        &self,
        actor: &Actor,
        path: &str,
        xml: &str,
        svg: Option<&str>,
        base_hash: &str,
        now: Instant,
    ) -> Result<DiagramSaved> {
        self.apply(actor, "save_diagram", true, now.millis, |vault| {
            let saved = diagrams::write_diagram(vault, path, xml, svg, base_hash, now)?;
            let mut paths = vec![path.to_owned()];
            if svg.is_some() {
                paths.push(sidecar_of(path));
            }
            if let DiagramSaved::Conflict { copy, .. } = &saved {
                paths.push(copy.clone());
                if svg.is_some() {
                    paths.push(sidecar_of(copy));
                }
            }
            Ok(Change {
                message: format!("diagram: edit {}", title_of(path)),
                paths,
                value: saved,
            })
        })
    }

    /// Saves a picture drawn again for the source the diagram has now
    /// (`source_hash`); a source that changed meanwhile refuses it.
    pub fn save_diagram_preview(
        &self,
        actor: &Actor,
        path: &str,
        svg: &str,
        source_hash: &str,
        now: Instant,
    ) -> Result<DiagramFile> {
        self.apply(actor, "save_diagram", true, now.millis, |vault| {
            let diagram = diagrams::write_preview(vault, path, svg, source_hash)?;
            Ok(Change {
                message: format!("diagram: preview {}", title_of(path)),
                paths: vec![sidecar_of(path)],
                value: diagram,
            })
        })
    }

    /// Gives a diagram a new title: both files take its name, and every
    /// embed, link and board card that named the file follows.
    pub fn rename_diagram(
        &self,
        actor: &Actor,
        path: &str,
        title: &str,
        now: Instant,
    ) -> Result<DiagramMoved> {
        self.apply(actor, "rename_diagram", false, now.millis, |vault| {
            let old = title_of(path);
            let bare = diagrams::has_unique_name(vault, path);
            let (new_path, moves): Moves = diagrams::rename_diagram(vault, path, title)?;
            let relinked = relink(vault, &moves, bare)?;
            let paths = if moves.is_empty() {
                vec![path.to_owned()]
            } else {
                touched(&moves, &relinked)
            };
            Ok(Change {
                message: format!("rename: {old} → {}", title_of(&new_path)),
                paths,
                value: DiagramMoved {
                    path: new_path,
                    moves,
                    relinked,
                },
            })
        })
    }

    /// Moves a diagram, both files, into `project` or the library; links
    /// keep going where they went.
    pub fn move_diagram(
        &self,
        actor: &Actor,
        path: &str,
        project: Option<&str>,
        now: Instant,
    ) -> Result<DiagramMoved> {
        self.apply(actor, "move_diagram", false, now.millis, |vault| {
            let bare = diagrams::has_unique_name(vault, path);
            let (new_path, moves): Moves = diagrams::move_diagram(vault, path, project)?;
            let relinked = relink(vault, &moves, bare)?;
            let paths = if moves.is_empty() {
                vec![path.to_owned()]
            } else {
                touched(&moves, &relinked)
            };
            Ok(Change {
                message: format!(
                    "move: {} to {}",
                    title_of(&new_path),
                    project.unwrap_or("library")
                ),
                paths,
                value: DiagramMoved {
                    path: new_path,
                    moves,
                    relinked,
                },
            })
        })
    }

    /// Copies a diagram beside itself, with its picture; returns the copy's path.
    pub fn duplicate_diagram(&self, actor: &Actor, path: &str, now: Instant) -> Result<String> {
        self.apply(actor, "duplicate_diagram", false, now.millis, |vault| {
            let copy = diagrams::duplicate_diagram(vault, path)?;
            Ok(Change {
                message: format!("duplicate: {}", title_of(path)),
                paths: diagrams::files_of(vault, &copy),
                value: copy,
            })
        })
    }

    /// Puts a trashed diagram back with its picture; returns its path.
    pub fn restore_diagram(&self, actor: &Actor, trashed: &str) -> Result<String> {
        self.apply(
            actor,
            "restore_diagram",
            false,
            Instant::now().millis,
            |vault| {
                let (path, moves) = crate::trash::restore_diagram(vault, trashed)?;
                Ok(Change {
                    // Named as it was trashed, not by the free name it came back under.
                    message: format!("restore: {}", title_of(trashed)),
                    paths: touched(&moves, &[]),
                    value: path,
                })
            },
        )
    }
}
