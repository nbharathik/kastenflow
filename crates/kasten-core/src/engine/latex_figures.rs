//! Agents adding a picture to a LaTeX document. The picture lands in the
//! document's `figures/` folder (made when it is missing, never through a
//! link): a PNG, JPEG or PDF as it is, an SVG cleaned of scripts and outside
//! links and flagged, since TeX cannot read it without a converter. What the
//! bytes are is looked at, not taken from the name; a program is never kept.
//! The same bytes already in `figures/` are the same file and nothing is
//! written. A picture adds a file and changes none, so it is held in no mode;
//! the limits on an agent's pictures (size, count, bytes in ten minutes) and
//! the lock of the document hold it instead.

use std::fs;
use std::io::ErrorKind;

use serde_json::{Value, json};

use super::review::Preview;
use super::{Change, Kasten, MAX_ASSET_BYTES};
use crate::agent::{AgentOp, Session, Target};
use crate::atomic::create_atomic;
use crate::diagrams::sanitize;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::latex::{FigureKind, LatexDoc, base64_decode, figure_name, is_link};
use crate::policy::{self, Commit, Decision, OpClass};
use crate::time::Instant;
use crate::vault::Vault;

/// The folder of a document that holds its pictures.
const FIGURES: &str = "figures";

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// A picture as an op names it, checked: its name, kind and bytes.
struct Picture {
    stem: String,
    kind: FigureKind,
    bytes: Vec<u8>,
}

impl Picture {
    fn file_name(&self) -> String {
        format!("{}.{}", self.stem, self.kind.ext())
    }
}

/// The picture in `dir` (a vault path) with exactly these bytes: links are not
/// followed, and nothing but plain files is read.
fn find_same(vault: &Vault, dir: &str, bytes: &[u8]) -> Option<String> {
    for entry in fs::read_dir(vault.root().join(dir)).ok()?.flatten() {
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if is_link(&meta) || !meta.is_file() || meta.len() != bytes.len() as u64 {
            continue;
        }
        if fs::read(entry.path()).is_ok_and(|held| held == bytes) {
            return Some(format!("{dir}/{}", entry.file_name().to_string_lossy()));
        }
    }
    None
}

impl Kasten {
    /// The document in the folder `folder`, exactly as the listing names it.
    pub(super) fn doc_in_folder(&self, folder: &str) -> Result<LatexDoc> {
        let wanted = folder.trim().trim_end_matches('/');
        self.latex_docs()?
            .into_iter()
            .find(|doc| doc.folder == wanted)
            .ok_or_else(|| {
                invalid(format!(
                    "{wanted} is not a LaTeX document folder. latex_list shows the documents"
                ))
            })
    }

    /// A plain picture file of the vault, by its path: never through a link,
    /// never outside the vault.
    fn read_vault_picture(&self, path: &str) -> Result<Vec<u8>> {
        let shown = path.trim();
        let file = self
            .vault
            .file_of(shown, &[""])
            .map_err(|_| invalid(format!("“{shown}” is not a path inside the vault")))?;
        let meta = fs::symlink_metadata(&file)
            .map_err(|_| Error::NotFound(format!("There is no file {shown} in the vault")))?;
        if is_link(&meta) || !meta.is_file() {
            return Err(invalid(format!(
                "“{shown}” is not a plain file of the vault (a link is never followed)"
            )));
        }
        if meta.len() > MAX_ASSET_BYTES as u64 {
            return Err(too_big(shown));
        }
        Ok(fs::read(file)?)
    }

    /// The picture an op carries, checked before the vault is touched.
    fn picture_of(
        &self,
        name: &str,
        base64: Option<&str>,
        vault_path: Option<&str>,
    ) -> Result<Picture> {
        let bytes = match (base64, vault_path) {
            (Some(_), Some(_)) | (None, None) => {
                return Err(invalid(
                    "Give the picture either as base64 (its bytes) or as vault_path (a picture already in the vault), not both",
                ));
            }
            (Some(data), None) => {
                if data.len() > MAX_ASSET_BYTES / 3 * 4 + 16 {
                    return Err(too_big(name.trim()));
                }
                base64_decode(data)?
            }
            (None, Some(path)) => self.read_vault_picture(path)?,
        };
        if bytes.is_empty() {
            return Err(invalid(format!("“{}” is empty", name.trim())));
        }
        if bytes.len() > MAX_ASSET_BYTES {
            return Err(too_big(name.trim()));
        }
        let (stem, kind) = figure_name(name, &bytes)?;
        let bytes = if kind == FigureKind::Svg {
            // What is kept is the drawing, and nothing that runs or fetches.
            let text = std::str::from_utf8(&bytes)
                .map_err(|_| invalid(format!("“{}” is not an SVG: it is not text", name.trim())))?;
            sanitize::sanitize(text)?.svg.into_bytes()
        } else {
            bytes
        };
        Ok(Picture { stem, kind, bytes })
    }

    /// The `figures/` folder of a document must be a plain folder, spelled as it
    /// is on disk, or not there yet.
    fn check_figures_dir(&self, folder: &str) -> Result<()> {
        let dir = format!("{folder}/{FIGURES}");
        match fs::symlink_metadata(self.vault.root().join(&dir)) {
            Ok(meta) if is_link(&meta) => Err(invalid(format!(
                "{dir} is a link, so nothing is put there. Replace it with a plain folder"
            ))),
            Ok(meta) if !meta.is_dir() => Err(invalid(format!(
                "{dir} is a file, so no pictures can go there"
            ))),
            Ok(_) => self.check_spelling(&dir),
            Err(err) if err.kind() == ErrorKind::NotFound => self.check_spelling(&dir),
            Err(err) => Err(err.into()),
        }
    }

    /// What no mode lifts for a picture: a document that is locked, a picture
    /// that is not one, a folder that is not plain.
    pub(super) fn latex_figures_refusals(&self, op: &AgentOp) -> Result<()> {
        self.figure_checked(op).map(|_| ())
    }

    fn figure_checked(&self, op: &AgentOp) -> Result<(LatexDoc, Picture)> {
        let AgentOp::AddLatexAsset {
            doc,
            name,
            base64,
            vault_path,
            ..
        } = op
        else {
            return Err(invalid(format!("{} is not a picture op", op.name())));
        };
        let doc = self.doc_in_folder(doc)?;
        let probe = format!("{}/{FIGURES}/x", doc.folder);
        Self::writable_form(&probe)?;
        super::latex_source::visible(&probe)?;
        if let Some(locked) = self.latex_locked_above(&probe) {
            return Err(super::latex_source::locked_for_agents(&locked));
        }
        self.check_figures_dir(&doc.folder)?;
        let picture = self.picture_of(name, base64.as_deref(), vault_path.as_deref())?;
        Ok((doc, picture))
    }

    /// A picture is committed in every mode: Review holds notes it would
    /// change, and this changes none (a proposal would also have to carry the
    /// picture into history). The limits on pictures and the lock still hold.
    pub(super) fn decide_figure(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Decision> {
        let mut projects = self.touched_projects(op)?;
        projects.extend(self.floor_of(session));
        let mode = self.mode_among(&projects, now);
        Ok(match policy::decide(mode, OpClass::Ordinary) {
            Decision::Propose(_) => Decision::Commit(Commit {
                autonomous: false,
                auto_accepted: false,
            }),
            other => other,
        })
    }

    /// What a reviewer would see (a picture is never held, so this is for the words).
    pub(super) fn latex_figures_preview(&self, op: &AgentOp) -> Preview {
        let AgentOp::AddLatexAsset { doc, name, .. } = op else {
            unreachable!("only a picture op is previewed here")
        };
        Preview {
            diff: format!(
                "Add the picture {} to the figures of {}",
                name.trim(),
                doc.trim()
            ),
            target: Some(Target {
                path: doc.trim().to_owned(),
                title: name.trim().to_owned(),
            }),
            before: None,
            after: None,
        }
    }

    /// Keeps the picture and says where it is.
    pub(super) fn latex_figures_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let (doc, picture) = self.figure_checked(op)?;
        let dir = format!("{}/{FIGURES}", doc.folder);
        let mut allowance = self.allowance(actor, now);
        let (path, created) = self.apply(actor, "add_latex_asset", false, now.millis, |vault| {
            if let Some(same) = find_same(vault, &dir, &picture.bytes) {
                return Ok(Change {
                    value: (same, false),
                    paths: Vec::new(),
                    message: String::new(),
                });
            }
            if let Some(room) = allowance.as_mut() {
                room.take(&picture.file_name(), picture.bytes.len() as u64)?;
            }
            fs::create_dir_all(vault.root().join(&dir))?;
            for n in 1.. {
                let file = match n {
                    1 => picture.file_name(),
                    n => format!("{}-{n}.{}", picture.stem, picture.kind.ext()),
                };
                let rel = format!("{dir}/{file}");
                // A name in use is passed over, a link too (it is never written through).
                if fs::symlink_metadata(vault.root().join(&rel)).is_ok() {
                    continue;
                }
                let target = vault.file_of(&rel, &[&format!(".{}", picture.kind.ext())])?;
                match create_atomic(&target, &picture.bytes) {
                    Ok(()) => {
                        return Ok(Change {
                            message: format!("figure: {file}"),
                            paths: vec![rel.clone()],
                            value: (rel, true),
                        });
                    }
                    Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
                    Err(err) => return Err(err.into()),
                }
            }
            unreachable!("names run out only after usize::MAX files")
        })?;
        if created && let Some(room) = &allowance {
            self.count_pictures(actor, room, now);
        }
        let figure = path
            .strip_prefix(&format!("{}/", doc.folder))
            .unwrap_or(&path)
            .to_owned();
        let mut out = json!({
            "status": if created { "added" } else { "existing" },
            "path": path,
            "figure": figure,
            "kind": picture.kind.ext(),
            "bytes": picture.bytes.len(),
            "include": format!("\\includegraphics[width=\\linewidth]{{{figure}}}"),
        });
        if picture.kind == FigureKind::Svg {
            out["note"] = json!(
                "An SVG is kept as the drawing it is, but TeX cannot read it without the svg package and a program that converts it, which Tectonic does not have. Send a PNG instead"
            );
        } else if !created {
            out["note"] =
                json!("The same picture is in the figures already, so nothing new was written");
        }
        Ok(out)
    }
}

fn too_big(name: &str) -> Error {
    invalid(format!(
        "“{name}” is over {} MB; keep big files outside the vault and link to them",
        MAX_ASSET_BYTES / 1024 / 1024
    ))
}
