//! What the agent tools need of the place decks are kept. A folder of files
//! (`slides mcp`), a vault (Kasten) and a test's memory each implement it, and
//! the tools never touch a disk themselves.

use std::fmt;

use serde_json::Value;

use crate::lint::{Measures, Refs};
use crate::model::Deck;

/// A deck in the store, in brief.
#[derive(Clone, Debug, PartialEq)]
pub struct DeckInfo {
    /// What the tools call it: a file name such as `talk.deck`.
    pub name: String,
    pub title: String,
    pub slides: usize,
    /// When it last changed, in milliseconds since 1970; 0 when unknown.
    pub modified: u64,
    /// Why the file is not a readable deck, when it is not.
    pub problem: Option<String>,
}

/// The text of a deck and its version.
#[derive(Clone, Debug, PartialEq)]
pub struct DeckText {
    pub name: String,
    pub text: String,
    /// Names the version of the text: the same text always has the same hash.
    pub hash: String,
}

/// What became of a save.
#[derive(Clone, Debug, PartialEq)]
pub enum Saved {
    /// The text is now the deck.
    Written(DeckText),
    /// The deck already held exactly this text.
    Unchanged(DeckText),
    /// The deck had moved on from the version the text was made from. It was
    /// left as it is, the text was kept as a copy named `copy`, and `current`
    /// is the deck as it is.
    Conflict { copy: String, current: DeckText },
}

/// A picture in the store.
#[derive(Clone, Debug, PartialEq)]
pub struct AssetInfo {
    /// What a deck calls it: `assets/figure.png`.
    pub path: String,
    pub bytes: u64,
}

/// Why a store could not do what it was asked. The message says what to do about it.
#[derive(Clone, Debug, PartialEq)]
pub enum StoreError {
    NotFound(String),
    Invalid(String),
    Io(String),
    /// This store cannot do it.
    Unavailable(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::NotFound(m)
            | StoreError::Invalid(m)
            | StoreError::Io(m)
            | StoreError::Unavailable(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for StoreError {}

pub type StoreResult<T> = Result<T, StoreError>;

/// A file the store wrote, for a tool to report.
#[derive(Clone, Debug, PartialEq)]
pub struct Written {
    pub path: String,
    pub bytes: u64,
}

/// A deck made from a PowerPoint file.
#[derive(Clone, Debug, PartialEq)]
pub struct Imported {
    pub deck: DeckText,
    /// How many pictures of the file were kept.
    pub pictures: usize,
    /// What the file held that a deck cannot, and what was done with it.
    pub warnings: Vec<String>,
}

/// A draw.io diagram of the store, drawn as a picture.
#[derive(Clone, Debug, PartialEq)]
pub struct DiagramPicture {
    /// The diagram, by its path in the store.
    pub diagram: String,
    /// A fingerprint of the diagram as it was drawn, to tell later whether it has changed.
    pub hash: String,
    /// The name to keep the picture under, such as `Architecture.svg`.
    pub name: String,
    pub bytes: Vec<u8>,
}

/// What a store is asked to draw.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Draw {
    /// A slide (from 0) at a step (its last state when absent), at `scale` pixels to the slide unit.
    Slide {
        slide: usize,
        step: Option<u32>,
        scale: f32,
    },
    /// Every slide, as a labelled thumbnail, in one picture.
    Grid,
}

/// One slide before and after a change, to be drawn side by side.
#[derive(Clone)]
pub struct Compare<'a> {
    pub before: &'a Deck,
    pub after: &'a Deck,
    /// The slide's place (from 0) in each deck.
    pub before_slide: usize,
    pub after_slide: usize,
    pub step: Option<u32>,
    pub scale: f32,
    /// The boxes (x, y, w, h in slide units) that differ, outlined on each side.
    pub before_marks: Vec<[f64; 4]>,
    pub after_marks: Vec<[f64; 4]>,
}

/// A picture a store drew.
#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// What could not be drawn exactly.
    pub warnings: Vec<String>,
}

fn unavailable<T>(what: &str) -> StoreResult<T> {
    Err(StoreError::Unavailable(format!(
        "{what} is not available in this build."
    )))
}

pub trait Store {
    /// The decks, most recently changed first.
    fn decks(&mut self) -> StoreResult<Vec<DeckInfo>>;

    fn read(&mut self, name: &str) -> StoreResult<DeckText>;

    /// Writes `text` as the deck `name` if the deck is still at the version
    /// `base` names. If it is not, nothing is overwritten: the text is kept
    /// as a copy and the answer is `Saved::Conflict`.
    fn save(&mut self, name: &str, text: &str, base: &str) -> StoreResult<Saved>;

    /// Makes a new deck from `text`, named as the store sees fit from `title`.
    /// A deck that is there is never replaced.
    fn create(&mut self, title: &str, text: &str) -> StoreResult<DeckText>;

    /// Puts a deck aside where a person can restore it; returns where it went.
    fn trash(&mut self, name: &str) -> StoreResult<String>;

    /// The pictures, newest first.
    fn assets(&mut self) -> StoreResult<Vec<AssetInfo>>;

    /// Keeps a picture; returns its path. A store may know the same bytes by a name it already has (the folder host does, whatever name they come with); other bytes never replace a file.
    fn add_asset(&mut self, name: &str, bytes: &[u8]) -> StoreResult<String>;

    fn read_asset(&mut self, path: &str) -> StoreResult<Vec<u8>>;

    /// Something different on every call, to start the ids of what a tool makes.
    fn entropy(&mut self) -> u64;

    /// Keeps a copy of a deck before a change that removes something, for a
    /// store whose history does not already keep it.
    fn keep_copy(&mut self, _name: &str, _text: &str, _why: &str) -> StoreResult<()> {
        Ok(())
    }

    /// The keys of the bibliography, when the store has one.
    fn references(&mut self) -> Option<Refs> {
        None
    }

    /// The layouts the person keeps for every deck (Kasten's "My layouts"), each as `{ id, label, slots, decoration }`.
    /// A store with no such library has none. They are not in any deck's theme until the person uses one.
    fn library_layouts(&mut self) -> Vec<Value> {
        Vec::new()
    }

    /// A file a person put beside the decks, by a path inside the store.
    fn read_file(&mut self, _path: &str) -> StoreResult<Vec<u8>> {
        unavailable("Reading a file")
    }

    /// The deck as a PowerPoint file, and what could not be written exactly.
    fn make_pptx(&mut self, _deck: &Deck) -> StoreResult<(Vec<u8>, Vec<String>)> {
        unavailable("PowerPoint export")
    }

    /// Keeps an exported file beside the deck `deck`, with `extension`; returns where.
    fn write_export(
        &mut self,
        _deck: &str,
        _extension: &str,
        _bytes: &[u8],
    ) -> StoreResult<Written> {
        unavailable("Saving an export")
    }

    /// Draws a slide, or all of them, as a PNG for the agent to look at. Only a store that has something to draw with can.
    fn draw(&mut self, _deck: &Deck, _what: Draw) -> StoreResult<Drawn> {
        unavailable("Drawing a slide")
    }

    /// Draws a slide before and after a change, side by side, with the changed boxes outlined.
    /// Only a store that can draw and put two pictures together can.
    fn draw_compare(&mut self, _compare: &Compare) -> StoreResult<Drawn> {
        unavailable("Drawing a slide before and after")
    }

    /// An earlier version of the deck `name` that this store has kept: the one with hash `hash`, or
    /// (without one) the newest whose hash is not `not`. A store that keeps no versions has none.
    fn earlier_version(
        &mut self,
        _name: &str,
        _hash: Option<&str>,
        _not: &str,
    ) -> Option<DeckText> {
        None
    }

    /// How big the words of the deck come out when something that draws them lays them out (a browser), if the store has one.
    /// Lint estimates the sizes when it has not.
    fn measure(&mut self, _deck: &Deck) -> Option<Measures> {
        None
    }

    /// Where the last `measure` that answered laid the words out, in words that follow "measured in".
    fn measured_by(&self) -> &'static str {
        "a browser"
    }

    /// Makes a deck from a PowerPoint file in the store.
    fn import_pptx(&mut self, _path: &str, _title: Option<&str>) -> StoreResult<Imported> {
        unavailable("PowerPoint import")
    }

    /// A draw.io diagram of the store, named by its path or its title, drawn as a picture (an SVG) to keep with `add_asset`.
    /// A store that holds no diagrams cannot.
    fn diagram_picture(&mut self, _diagram: &str) -> StoreResult<DiagramPicture> {
        unavailable("Placing a diagram")
    }

    /// Runs the program of a code picture where programs are run safely (in KastenFlow, the app's
    /// sandbox) and answers with the picture it drew. A failure says why in a sentence with the line
    /// of the code, so the agent can fix it.
    fn run_generator(&mut self, _job: &GeneratorJob) -> StoreResult<GeneratorDrawn> {
        unavailable("Running a code picture")
    }
}

/// A code picture's program to run, for the deck `deck`.
#[derive(Clone, Debug, PartialEq)]
pub struct GeneratorJob {
    /// The deck as the store names it: a person's "Allow to run" is kept for it.
    pub deck: String,
    /// The program, its inputs and the kind of picture it makes.
    pub generator: crate::model::PictureGenerator,
    /// The deck's colours by token (`text1`, `accent1` …) for the drawing kit.
    pub theme: std::collections::BTreeMap<String, String>,
}

/// A picture a program drew.
#[derive(Clone, Debug, PartialEq)]
pub struct GeneratorDrawn {
    /// What `bytes` are: an SVG (text) or a PNG.
    pub kind: super::images::Kind,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// A PNG of the drawing for the agent to look at, when `bytes` is an SVG and the window drew one.
    pub preview: Option<Vec<u8>>,
    /// Names what the program read: the same inputs always have the same hash.
    pub inputs_hash: String,
    /// When it ran, in milliseconds since 1970.
    pub at: u64,
    /// What the program or the kit warned of.
    pub warnings: Vec<String>,
    /// What the program wrote with `console.log`.
    pub logs: Vec<String>,
}
