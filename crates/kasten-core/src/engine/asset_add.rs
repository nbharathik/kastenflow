//! Keeping a picture: its bytes are hashed, the same bytes are looked for
//! anywhere in `assets/`, and a new picture is written with its sidecar in
//! one commit. A picture pasted twice is one asset.

use std::fs;
use std::io::ErrorKind;

use slides_assets::{Clip, Sidecar, clean, probe, sha256_hex, sidecar_path};

use super::asset_files::{ASSETS, Card, Papers, info_of, walk};
use super::assets::{asset_name, original_name};
use super::{Change, Kasten, MAX_ASSET_BYTES};
use crate::assets::{AddedAsset, AssetSource, NewAsset};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::id::ulid_at;
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

/// What a new picture remembers, checked.
struct Checked {
    source: AssetSource,
    created_by: String,
    tags: Vec<String>,
    caption: Option<String>,
    key: Option<String>,
    clip: Option<Clip>,
    deck: Option<String>,
}

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// A clip with its corners in order, if it names a page and has some area.
fn check_clip(clip: &Clip) -> Result<Clip> {
    crate::sources::sidecar_of(&clip.pdf)?;
    if clip.page == 0 {
        return Err(invalid("Pages count from 1"));
    }
    let [x1, y1, x2, y2] = clip.rect;
    if clip.rect.iter().any(|n| !n.is_finite()) || x1 == x2 || y1 == y2 {
        return Err(invalid("A clip is a rectangle with some size"));
    }
    Ok(Clip {
        pdf: clip.pdf.clone(),
        page: clip.page,
        rect: [x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2)],
    })
}

fn check_meta(actor: &Actor, meta: &NewAsset) -> Result<Checked> {
    let source = meta.source.unwrap_or(if actor.is_agent() {
        AssetSource::Agent
    } else {
        AssetSource::File
    });
    match (actor.is_agent(), source) {
        (false, AssetSource::Agent) => {
            return Err(invalid("Only an agent's pictures have the source agent"));
        }
        (true, AssetSource::Pasted | AssetSource::File) => {
            return Err(invalid(
                "An agent's pictures come from the agent, a figure in a paper or an import",
            ));
        }
        _ => {}
    }
    let clip = match (source, &meta.clip) {
        (AssetSource::PdfClip, Some(clip)) => Some(check_clip(clip)?),
        (AssetSource::PdfClip, None) => {
            return Err(invalid(
                "A figure clipped from a paper needs the paper, the page and the rectangle",
            ));
        }
        (_, Some(_)) => return Err(invalid("Only a figure clipped from a paper has a clip")),
        (_, None) => None,
    };
    let deck = match (&meta.deck, source) {
        (Some(deck), AssetSource::PptxImport) => {
            Some(deck.trim().to_owned()).filter(|d| !d.is_empty())
        }
        (Some(_), _) => {
            return Err(invalid(
                "Only a picture from an imported deck names the deck",
            ));
        }
        (None, _) => None,
    };
    Ok(Checked {
        source,
        created_by: actor
            .session()
            .map_or_else(|| "person".to_owned(), |session| format!("agent:{session}")),
        tags: clean::tags(&meta.tags).map_err(invalid)?,
        caption: meta
            .caption
            .as_deref()
            .map(clean::caption)
            .transpose()
            .map_err(invalid)?
            .flatten(),
        key: meta
            .citation_key
            .as_deref()
            .map(clean::citation_key)
            .transpose()
            .map_err(invalid)?
            .flatten(),
        clip,
        deck,
    })
}

/// The path of a file in `assets/` with this extension and exactly these
/// bytes, the first in path order.
fn find_same(vault: &Vault, ext: &str, bytes: &[u8]) -> Option<String> {
    let suffix = format!(".{ext}");
    walk(vault).into_iter().find_map(|found| {
        let same_kind = found.meta.len() == bytes.len() as u64
            && found.rel.to_ascii_lowercase().ends_with(&suffix);
        (same_kind && fs::read(vault.root().join(&found.rel)).is_ok_and(|held| held == bytes))
            .then_some(found.rel)
    })
}

/// A picture whose name, size and notes are checked, ready to be kept.
pub(super) struct Prepared<'a> {
    /// The name it came with, for saying which picture.
    name: String,
    stem: String,
    ext: String,
    original: String,
    sha: String,
    bytes: &'a [u8],
    checked: Checked,
}

/// Checks a new picture before the vault is touched.
pub(super) fn prepare<'a>(
    actor: &Actor,
    name: &str,
    bytes: &'a [u8],
    meta: &NewAsset,
) -> Result<Prepared<'a>> {
    if bytes.is_empty() {
        return Err(invalid(format!("“{}” is empty", name.trim())));
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(invalid(format!(
            "“{}” is over {} MB; keep big files outside the vault and link to them",
            name.trim(),
            MAX_ASSET_BYTES / 1024 / 1024
        )));
    }
    let (stem, ext) = asset_name(name)?;
    Ok(Prepared {
        name: name.trim().to_owned(),
        stem,
        ext,
        original: original_name(name),
        sha: sha256_hex(bytes),
        bytes,
        checked: check_meta(actor, meta)?,
    })
}

impl Prepared<'_> {
    /// The path of a file in `assets/` that already holds these bytes.
    pub(super) fn already_in(&self, vault: &Vault) -> Option<String> {
        find_same(vault, &self.ext, self.bytes)
    }

    /// The path `keep` would give the picture, passing over `besides`: names a
    /// staged change means to use. Nothing is written.
    pub(super) fn planned_path(
        &self,
        vault: &Vault,
        besides: &std::collections::HashSet<String>,
    ) -> Result<String> {
        let suffix = format!(".{}", self.ext);
        for n in 1.. {
            let file = if n == 1 {
                format!("{}.{}", self.stem, self.ext)
            } else {
                format!("{}-{n}.{}", self.stem, self.ext)
            };
            let rel = format!("{ASSETS}/{file}");
            let path = vault.file_of(&rel, &[&suffix])?;
            let card_rel = sidecar_path(&rel).ok_or_else(|| Error::InvalidPath(rel.clone()))?;
            let card_file = vault.file_of(&card_rel, &[".json"])?;
            if besides.contains(&rel)
                || fs::symlink_metadata(&path).is_ok()
                || fs::symlink_metadata(&card_file).is_ok()
            {
                continue;
            }
            return Ok(rel);
        }
        unreachable!("names run out only after usize::MAX files")
    }

    /// The picture's hash.
    pub(super) fn sha256(&self) -> &str {
        &self.sha
    }

    /// The name the picture came with, trimmed.
    pub(super) fn name(&self) -> &str {
        &self.name
    }

    /// Its extension, as `keep` will write it.
    pub(super) fn extension(&self) -> &str {
        &self.ext
    }
}

/// What keeping a picture did.
pub(super) struct Kept {
    pub added: AddedAsset,
    /// The commit's message; empty when the same bytes were there already.
    pub message: String,
    /// The files written: the picture and its sidecar.
    pub paths: Vec<String>,
    /// Takes the files back out, should something after this fail.
    pub undo: Rollback,
}

/// Keeps a checked picture in `assets/`. `allow` is asked, with the picture's
/// name and size, just before a new file is written: an answer of an error
/// stops it with nothing written. The same bytes anywhere in `assets/` are
/// the same asset, and nothing is written for them.
pub(super) fn keep(
    vault: &Vault,
    picture: &Prepared,
    now: Instant,
    allow: &mut dyn FnMut(&str, u64) -> Result<()>,
) -> Result<Kept> {
    let Prepared {
        name,
        stem,
        ext,
        original,
        sha,
        bytes,
        checked,
    } = picture;
    if let Some(clip) = &checked.clip {
        super::sources::check_source(vault, &clip.pdf)?;
    }
    let mut papers = Papers::default();
    if let Some(path) = find_same(vault, ext, bytes) {
        let file_meta = fs::metadata(vault.root().join(&path))?;
        let card = super::asset_files::read_card(vault, &path).unwrap_or(Card::Missing);
        let mut asset = info_of(vault, &path, &file_meta, &card, false, &mut papers);
        asset.sha256 = Some(sha.clone());
        return Ok(Kept {
            added: AddedAsset {
                path,
                created: false,
                asset,
            },
            message: String::new(),
            paths: vec![],
            undo: Rollback::default(),
        });
    }
    allow(name, bytes.len() as u64)?;
    fs::create_dir_all(vault.root().join(ASSETS))?;
    let suffix = format!(".{ext}");
    for n in 1.. {
        let file = if n == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}-{n}.{ext}")
        };
        let rel = format!("{ASSETS}/{file}");
        let path = vault.file_of(&rel, &[&suffix])?;
        let card_rel = sidecar_path(&rel).ok_or_else(|| Error::InvalidPath(rel.clone()))?;
        let card_file = vault.file_of(&card_rel, &[".json"])?;
        // A name in use, or one whose sidecar is left without its picture, is not free.
        if fs::symlink_metadata(&path).is_ok() || fs::symlink_metadata(&card_file).is_ok() {
            continue;
        }
        let mut card = Sidecar::new(&ulid_at(now.millis));
        card.set_file(original, sha, bytes.len() as u64, probe::dimensions(bytes));
        card.set_origin(checked.source.name(), &checked.created_by, &now.rfc3339());
        card.set_tags(&checked.tags);
        card.set_caption(checked.caption.as_deref());
        card.set_citation_key(checked.key.as_deref());
        card.set_clip(checked.clip.as_ref());
        card.set_deck(checked.deck.as_deref());
        // Both files or neither: a picture without its sidecar is an old file, but a
        // half-made asset is not what was asked for.
        let mut undo = Rollback::default();
        let written = undo
            .create(&path, bytes)
            .and_then(|()| undo.create(&card_file, card.to_text().as_bytes()));
        if let Err(err) = written {
            undo.put_back();
            if err.kind() == ErrorKind::AlreadyExists {
                continue;
            }
            return Err(err.into());
        }
        let file_meta = fs::metadata(&path)?;
        let asset = info_of(
            vault,
            &rel,
            &file_meta,
            &Card::Fine(card),
            true,
            &mut papers,
        );
        return Ok(Kept {
            added: AddedAsset {
                path: rel.clone(),
                created: true,
                asset,
            },
            message: format!("asset: {file}"),
            paths: vec![rel, card_rel],
            undo,
        });
    }
    unreachable!("names run out only after usize::MAX files")
}

impl Kasten {
    /// Keeps `bytes` as a picture or file in `assets/` and says where. The
    /// same bytes anywhere in `assets/` are the same asset: its path comes
    /// back, and nothing is written. Otherwise the file is written under the
    /// name's slug (numbered when taken) with a sidecar that remembers its
    /// hash, size, where it came from and who added it, in one commit. `meta`
    /// says how it came in; left out, that is a file for a person and the
    /// agent for an agent. An agent's pictures are held to the limits on a
    /// session's pictures (`max_asset_bytes` and the two per ten minutes): a
    /// picture over one is refused and nothing is written.
    pub fn add_asset(
        &self,
        actor: &Actor,
        name: &str,
        bytes: &[u8],
        meta: &NewAsset,
        now: Instant,
    ) -> Result<AddedAsset> {
        let picture = prepare(actor, name, bytes, meta)?;
        self.apply(actor, "add_asset", false, now.millis, |vault| {
            let mut allowance = self.allowance(actor, now);
            let kept = keep(vault, &picture, now, &mut |name, len| {
                allowance
                    .as_mut()
                    .map_or(Ok(()), |room| room.take(name, len))
            })?;
            if let Some(room) = &allowance {
                self.count_pictures(actor, room, now);
            }
            Ok(Change {
                message: kept.message,
                paths: kept.paths,
                value: kept.added,
            })
        })
    }
}
