//! The vault as the deck tools' store. Reading goes through kasten-core.
//! Every write becomes an agent op in the connection's session, so the
//! refusals, the review queue, the trust rules and the commits are the ones
//! every other agent write has. A write that waits for review stops the tool
//! where it stands: the store keeps what happened, and the caller answers
//! `pending_review` in place of the tool's own answer.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use kasten_core::agent::{AgentOp, ChangeSet, Session};
use kasten_core::assets::NewAsset;
use kasten_core::deck::REPLACES_DECK;
use kasten_core::{Error, Instant, Kasten};
use serde_json::Value;
use slides_core::Deck;
use slides_core::agent::{
    AssetInfo, DeckInfo, DeckText, Draw, Drawn, Imported, Saved, Store, StoreError, StoreResult,
    Written,
};
use slides_core::lint::{Measures, Refs};

use super::render::{self, Ask};
use super::{marks, pptx, store_files};

/// A write that waits for a person to decide.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Review {
    pub proposal: String,
    pub reason: String,
}

/// What a write came to.
pub(super) enum Ran {
    Done(Value),
    Waiting,
}

/// What a tool was asked, for the ops its writes become.
#[derive(Default)]
pub(super) struct Request {
    /// The tool's name: the commit's `Kasten-Op`.
    pub tool: String,
    /// What it does, in a few words for the history and the review.
    pub summary: String,
    /// How many bytes were sent to ask for it.
    pub sent: usize,
    /// The project folder a new deck goes in.
    pub project: Option<String>,
}

pub(super) struct KastenStore<'a> {
    pub(super) kasten: &'a Kasten,
    session: Option<&'a Session>,
    pub(super) request: Request,
    /// The decks the tool has read, by path: the versions its changes are made to.
    reads: BTreeMap<String, DeckText>,
    /// Set when a write went to review.
    pub review: Option<Review>,
    /// A chat that previews its changes: the set its writes go into and its
    /// reads see (store_stage.rs).
    pub(super) stage: Option<&'a Mutex<ChangeSet>>,
    /// Set when whoever asked no longer wants the answer (the MCP client
    /// withdrew the request, the person pressed Stop): a picture not yet
    /// started is never drawn, and one that was is thrown away.
    cancel: Option<&'a AtomicBool>,
}

/// A core error as the tools' store reports it.
pub(super) fn failed(error: Error) -> StoreError {
    match error {
        Error::NotFound(path) => StoreError::NotFound(format!("There is nothing at {path}.")),
        Error::Invalid(why) => StoreError::Invalid(why),
        Error::InvalidPath(path) => {
            StoreError::Invalid(format!("`{path}` is not a path in the vault."))
        }
        other => StoreError::Io(other.to_string()),
    }
}

/// The name a call is recorded under, as its commit's `Kasten-Op`: the tool's
/// own, unless it is a batch with an operation in it that puts another deck in
/// place of the deck, when it is that. The review and the limit on slides
/// taken out count every slide such a change replaces, and the history says
/// what was done.
pub(super) fn recorded_as(tool: &str, args: &Value) -> String {
    let replaces = args["operations"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|op| op["op"] == REPLACES_DECK);
    if replaces { REPLACES_DECK } else { tool }.to_owned()
}

pub(super) fn waiting() -> StoreError {
    StoreError::Unavailable("This change waits for the person's review.".to_owned())
}

impl<'a> KastenStore<'a> {
    pub fn new(kasten: &'a Kasten, session: Option<&'a Session>, request: Request) -> Self {
        KastenStore {
            kasten,
            session,
            request,
            reads: BTreeMap::new(),
            review: None,
            stage: None,
            cancel: None,
        }
    }

    /// The store of a call that can be withdrawn while it waits to draw.
    pub(super) fn cancelled_by(mut self, flag: Option<&'a AtomicBool>) -> Self {
        self.cancel = flag;
        self
    }

    fn ask(&self) -> Ask<'a> {
        Ask {
            kasten: self.kasten,
            stage: self.stage,
            cancel: self.cancel,
        }
    }

    pub(super) fn session(&self) -> StoreResult<&'a Session> {
        self.session.ok_or_else(|| {
            StoreError::Unavailable("A change needs a session, and this call has none.".to_owned())
        })
    }
}

/// Something different on every call, to start the ids of what a tool makes.
fn entropy_now() -> u64 {
    static CALLS: AtomicU64 = AtomicU64::new(0);
    let n = CALLS.fetch_add(1, Ordering::Relaxed);
    Instant::now().millis.rotate_left(20)
        ^ (u64::from(std::process::id()) << 32)
        ^ n.wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

impl Store for KastenStore<'_> {
    fn decks(&mut self) -> StoreResult<Vec<DeckInfo>> {
        let mut decks = self.kasten.decks().map_err(failed)?;
        decks.extend(self.staged_decks());
        decks.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.path.cmp(&b.path)));
        Ok(decks
            .into_iter()
            .map(|d| DeckInfo {
                name: d.path,
                title: d.title,
                slides: d.slides,
                modified: d.modified,
                problem: d.problem,
            })
            .collect())
    }

    fn read(&mut self, name: &str) -> StoreResult<DeckText> {
        let path = self.resolve(name)?;
        let text = self.fetch(&path)?;
        self.reads.insert(path, text.clone());
        Ok(text)
    }

    /// The change was made to the deck as `read` gave it, a moment ago. The
    /// core writes it to the deck as it is now, keeping what a person did
    /// since, so there is never a copy to leave beside the deck.
    fn save(&mut self, name: &str, text: &str, base: &str) -> StoreResult<Saved> {
        let path = self.resolve(name)?;
        let read = self
            .reads
            .get(&path)
            .filter(|r| r.hash == base)
            .cloned()
            .ok_or_else(|| {
                StoreError::Invalid(format!("`{name}` was not read before it was changed."))
            })?;
        // The deck an agent's own write leaves holds the marks that badge its work.
        let marked = marks::marked(&read.text, text, self.session()?, Instant::now());
        let op = AgentOp::EditDeck {
            path: path.clone(),
            tool: self.request.tool.clone(),
            summary: self.request.summary.clone(),
            base: read.text,
            text: text.to_owned(),
            sent: self.request.sent,
            marked,
        };
        match self.run(&op)? {
            Ran::Done(result) => {
                let now = self.fetch(&path)?;
                Ok(if result["changed"].as_bool().unwrap_or(true) {
                    Saved::Written(now)
                } else {
                    Saved::Unchanged(now)
                })
            }
            Ran::Waiting => Err(waiting()),
        }
    }

    fn create(&mut self, title: &str, text: &str) -> StoreResult<DeckText> {
        let marked = marks::marked_new(text, self.session()?, Instant::now());
        let op = AgentOp::CreateDeck {
            title: title.to_owned(),
            project: self.request.project.clone(),
            tool: self.request.tool.clone(),
            text: text.to_owned(),
            sent: self.request.sent,
            marked,
        };
        match self.run(&op)? {
            Ran::Done(result) => {
                let path = result["path"].as_str().unwrap_or_default().to_owned();
                self.fetch(&path)
            }
            Ran::Waiting => Err(waiting()),
        }
    }

    /// A deck goes to the trash only when a person agrees: this always waits.
    fn trash(&mut self, name: &str) -> StoreResult<String> {
        let path = self.resolve(name)?;
        let op = AgentOp::Trash { path, reason: None };
        match self.run(&op)? {
            Ran::Done(result) => Ok(result["trashed"].as_str().unwrap_or_default().to_owned()),
            Ran::Waiting => Err(waiting()),
        }
    }

    fn assets(&mut self) -> StoreResult<Vec<AssetInfo>> {
        let mut assets: Vec<AssetInfo> = self
            .kasten
            .assets()
            .map_err(failed)?
            .into_iter()
            .map(|a| AssetInfo {
                path: a.path,
                bytes: a.bytes,
            })
            .collect();
        assets.extend(self.staged_assets());
        Ok(assets)
    }

    /// A picture goes to `assets/` with a note of who added it. Adding one is
    /// not a change that needs review: nothing existing is touched, and the
    /// session's undo takes it out again. A chat that previews its changes
    /// holds the picture with them instead.
    fn add_asset(&mut self, name: &str, bytes: &[u8]) -> StoreResult<String> {
        let session = self.session()?;
        // An SVG is cleaned of scripts and outside links; anything else is kept as it is.
        let bytes = store_files::clean_picture(name, bytes)?;
        if self.stage.is_some() {
            return self.stage_picture(name, &bytes);
        }
        self.kasten
            .add_asset(
                &session.actor(),
                name,
                &bytes,
                &NewAsset::default(),
                Instant::now(),
            )
            .map(|added| added.path)
            .map_err(failed)
    }

    fn read_asset(&mut self, path: &str) -> StoreResult<Vec<u8>> {
        if let Some(bytes) = self.staged_asset(path)? {
            return Ok(bytes);
        }
        store_files::read_asset(self.kasten, path)
    }

    fn entropy(&mut self) -> u64 {
        entropy_now()
    }

    /// The vault's `.bib` files; without any, citations are not checked.
    fn references(&mut self) -> Option<Refs> {
        let text = self.kasten.references().ok()?;
        (!text.trim().is_empty()).then(|| Refs::from_bibtex(&text))
    }

    fn make_pptx(&mut self, deck: &Deck) -> StoreResult<(Vec<u8>, Vec<String>)> {
        let refs = self.references();
        pptx::export(self.kasten, self.stage, deck, refs.as_ref())
    }

    /// A PowerPoint file goes to `assets/`, kept as the session's; nothing is written over.
    fn write_export(&mut self, deck: &str, extension: &str, bytes: &[u8]) -> StoreResult<Written> {
        let session = self.session()?;
        if self.stage.is_some() {
            return self.stage_export(deck, extension, bytes);
        }
        pptx::keep_export(self.kasten, &session.actor(), deck, extension, bytes)
    }

    /// A PowerPoint file of the vault becomes a new deck; its pictures are
    /// kept in `assets/`. The deck and its pictures are one commit, and are
    /// refused whole, before any is written, if the deck cannot be made or a
    /// limit on pictures is met.
    fn import_pptx(&mut self, path: &str, title: Option<&str>) -> StoreResult<Imported> {
        let bytes = self.read_file(path)?;
        let seed = self.entropy();
        if self.stage.is_some() {
            return self.stage_import(path, &bytes, title, seed);
        }
        let (made, read) = pptx::import_deck(
            self.kasten,
            self.session()?,
            &self.request,
            path,
            &bytes,
            title,
            seed,
        )?;
        Ok(Imported {
            deck: self.fetch(&made)?,
            pictures: read.pictures.len(),
            warnings: read.warnings,
        })
    }

    /// A picture or a PowerPoint file of the vault, by its path.
    fn read_file(&mut self, path: &str) -> StoreResult<Vec<u8>> {
        store_files::read_file(self.kasten, path)
    }

    /// A slide, or all of them, drawn with the vault's pictures where this
    /// program can draw (see `render`).
    fn draw(&mut self, deck: &Deck, what: Draw) -> StoreResult<Drawn> {
        render::draw(&self.ask(), deck, what)
    }

    /// The text laid out by a browser when this program has one, else `None`
    /// and lint estimates.
    fn measure(&mut self, deck: &Deck) -> Option<Measures> {
        render::measure(&self.ask(), deck)
    }
}
