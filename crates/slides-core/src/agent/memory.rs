//! A store that keeps its decks in memory: for tests, and for a host that
//! holds decks somewhere the tools should not know about.

use std::collections::BTreeMap;

use super::store::{
    AssetInfo, Compare, DeckInfo, DeckText, DiagramPicture, Draw, Drawn, GeneratorDrawn,
    GeneratorJob, Saved, Store, StoreError, StoreResult, Written,
};
use crate::lint::{Measures, Refs};
use crate::model::Deck;

/// The version of a text: FNV-1a as sixteen hex digits.
pub fn hash_of(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The boxes outlined on the before and the after side of a comparison.
pub type Marks = (Vec<[f64; 4]>, Vec<[f64; 4]>);

#[derive(Default)]
pub struct MemoryStore {
    pub decks: BTreeMap<String, String>,
    pub assets: BTreeMap<String, Vec<u8>>,
    pub files: BTreeMap<String, Vec<u8>>,
    pub exports: BTreeMap<String, Vec<u8>>,
    pub trashed: Vec<(String, String)>,
    /// The picture `draw` answers with; without one, drawing is not available.
    pub picture: Option<Drawn>,
    /// What was asked to be drawn, in order.
    pub drawn: Vec<Draw>,
    /// The deck each of those was drawn from (a proposed change is drawn from a copy).
    pub shown: Vec<Deck>,
    /// The sizes `measure` answers with; without them lint estimates.
    pub measures: Option<Measures>,
    /// The bibliography `references` answers with; without one citation keys are not checked.
    pub refs: Option<Refs>,
    /// The layouts `library_layouts` answers with: none unless a test gives them.
    pub library: Vec<serde_json::Value>,
    /// Every version of a deck that was put or saved, oldest first, for `earlier_version`.
    pub versions: Vec<DeckText>,
    /// The boxes outlined (before, after) in each comparison asked for, in order.
    pub compared: Vec<Marks>,
    /// What `run_generator` answers with, one for each call in order; without any, running code is not available.
    pub generator_answers: std::collections::VecDeque<StoreResult<GeneratorDrawn>>,
    /// The programs it was asked to run, in order.
    pub generated: Vec<GeneratorJob>,
    /// The pictures `diagram_picture` answers with, by the diagram's path (such as `projects/talk/flow.drawio`).
    pub diagrams: BTreeMap<String, Vec<u8>>,
    counter: u64,
}

impl MemoryStore {
    pub fn new() -> MemoryStore {
        MemoryStore::default()
    }

    /// Puts a deck's text in, as another program would.
    pub fn put(&mut self, name: &str, text: &str) {
        self.decks.insert(name.to_owned(), text.to_owned());
        self.note(name, text);
    }

    fn note(&mut self, name: &str, text: &str) {
        self.versions.push(DeckText {
            name: name.to_owned(),
            text: text.to_owned(),
            hash: hash_of(text),
        });
    }

    fn text_of(&self, name: &str) -> StoreResult<DeckText> {
        let text = self
            .decks
            .get(name)
            .ok_or_else(|| StoreError::NotFound(format!("There is no deck `{name}`.")))?;
        Ok(DeckText {
            name: name.to_owned(),
            hash: hash_of(text),
            text: text.clone(),
        })
    }

    fn free(&self, stem: &str, suffix: &str) -> String {
        let mut name = format!("{stem}{suffix}");
        let mut n = 2;
        while self.decks.contains_key(&name) {
            name = format!("{stem} {n}{suffix}");
            n += 1;
        }
        name
    }
}

impl Store for MemoryStore {
    fn decks(&mut self) -> StoreResult<Vec<DeckInfo>> {
        Ok(self
            .decks
            .iter()
            .map(|(name, text)| {
                let parsed = crate::canonical::parse(text);
                DeckInfo {
                    name: name.clone(),
                    title: parsed.as_ref().map(|d| d.title.clone()).unwrap_or_default(),
                    slides: parsed.as_ref().map_or(0, |d| d.slides.len()),
                    modified: 0,
                    problem: parsed.err().map(|e| e.to_string()),
                }
            })
            .collect())
    }

    fn read(&mut self, name: &str) -> StoreResult<DeckText> {
        self.text_of(name)
    }

    fn save(&mut self, name: &str, text: &str, base: &str) -> StoreResult<Saved> {
        let current = self.text_of(name)?;
        if current.text == text {
            return Ok(Saved::Unchanged(current));
        }
        if current.hash != base {
            let stem = name.trim_end_matches(".deck");
            let copy = self.free(&format!("{stem} (conflict"), ").deck");
            self.decks.insert(copy.clone(), text.to_owned());
            return Ok(Saved::Conflict { copy, current });
        }
        self.decks.insert(name.to_owned(), text.to_owned());
        self.note(name, text);
        Ok(Saved::Written(self.text_of(name)?))
    }

    fn create(&mut self, title: &str, text: &str) -> StoreResult<DeckText> {
        let stem: String = title
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .trim_matches('-')
            .to_owned();
        let name = self.free(if stem.is_empty() { "deck" } else { &stem }, ".deck");
        self.decks.insert(name.clone(), text.to_owned());
        self.note(&name, text);
        self.text_of(&name)
    }

    fn trash(&mut self, name: &str) -> StoreResult<String> {
        let text = self
            .decks
            .remove(name)
            .ok_or_else(|| StoreError::NotFound(format!("There is no deck `{name}`.")))?;
        let place = format!(".trash/{name}");
        self.trashed.push((place.clone(), text));
        Ok(place)
    }

    fn assets(&mut self) -> StoreResult<Vec<AssetInfo>> {
        Ok(self
            .assets
            .iter()
            .map(|(path, bytes)| AssetInfo {
                path: path.clone(),
                bytes: bytes.len() as u64,
            })
            .collect())
    }

    fn add_asset(&mut self, name: &str, bytes: &[u8]) -> StoreResult<String> {
        let path = format!("assets/{name}");
        match self.assets.get(&path) {
            Some(held) if held != bytes => {
                let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
                let mut n = 2;
                loop {
                    let next = format!("assets/{stem} {n}.{ext}");
                    if !self.assets.contains_key(&next) {
                        self.assets.insert(next.clone(), bytes.to_vec());
                        return Ok(next);
                    }
                    n += 1;
                }
            }
            _ => {
                self.assets.insert(path.clone(), bytes.to_vec());
                Ok(path)
            }
        }
    }

    fn read_asset(&mut self, path: &str) -> StoreResult<Vec<u8>> {
        self.assets
            .get(path)
            .cloned()
            .ok_or_else(|| StoreError::NotFound(format!("There is no picture `{path}`.")))
    }

    fn entropy(&mut self) -> u64 {
        self.counter += 1;
        self.counter.wrapping_mul(0x9E37_79B9_7F4A_7C15)
    }

    fn keep_copy(&mut self, name: &str, text: &str, why: &str) -> StoreResult<()> {
        self.trashed
            .push((format!(".trash/{name} ({why})"), text.to_owned()));
        Ok(())
    }

    fn read_file(&mut self, path: &str) -> StoreResult<Vec<u8>> {
        self.files
            .get(path)
            .cloned()
            .ok_or_else(|| StoreError::NotFound(format!("There is no file `{path}`.")))
    }

    fn draw(&mut self, deck: &Deck, what: Draw) -> StoreResult<Drawn> {
        self.drawn.push(what);
        self.shown.push(deck.clone());
        self.picture.clone().ok_or_else(|| {
            StoreError::Unavailable("Drawing a slide is not available in this build.".to_owned())
        })
    }

    fn draw_compare(&mut self, compare: &Compare) -> StoreResult<Drawn> {
        let picture = self.picture.clone().ok_or_else(|| {
            StoreError::Unavailable("Drawing a slide is not available in this build.".to_owned())
        })?;
        self.compared
            .push((compare.before_marks.clone(), compare.after_marks.clone()));
        Ok(picture)
    }

    fn earlier_version(&mut self, name: &str, hash: Option<&str>, not: &str) -> Option<DeckText> {
        self.versions
            .iter()
            .rev()
            .filter(|v| v.name == name)
            .find(|v| match hash {
                Some(wanted) => v.hash == wanted,
                None => v.hash != not,
            })
            .cloned()
    }

    fn measure(&mut self, _deck: &Deck) -> Option<Measures> {
        self.measures.clone()
    }

    fn references(&mut self) -> Option<Refs> {
        self.refs.clone()
    }

    fn library_layouts(&mut self) -> Vec<serde_json::Value> {
        self.library.clone()
    }

    fn run_generator(&mut self, job: &GeneratorJob) -> StoreResult<GeneratorDrawn> {
        self.generated.push(job.clone());
        self.generator_answers.pop_front().unwrap_or_else(|| {
            Err(StoreError::Unavailable(
                "Running a code picture is not available in this build.".to_owned(),
            ))
        })
    }

    fn write_export(&mut self, deck: &str, extension: &str, bytes: &[u8]) -> StoreResult<Written> {
        let stem = deck.trim_end_matches(".deck");
        let path = format!("{stem}.{extension}");
        self.exports.insert(path.clone(), bytes.to_vec());
        Ok(Written {
            path,
            bytes: bytes.len() as u64,
        })
    }

    fn diagram_picture(&mut self, diagram: &str) -> StoreResult<DiagramPicture> {
        let wanted = diagram.trim().to_lowercase();
        let stem_of = |path: &str| -> String {
            let file = path.rsplit('/').next().unwrap_or(path);
            file.strip_suffix(".drawio").unwrap_or(file).to_owned()
        };
        let (path, bytes) = self
            .diagrams
            .iter()
            .find(|(path, _)| {
                let lower = path.to_lowercase();
                lower == wanted || stem_of(&lower) == wanted
            })
            .ok_or_else(|| StoreError::NotFound(format!("There is no diagram `{diagram}`.")))?;
        Ok(DiagramPicture {
            diagram: path.clone(),
            hash: hash_of(&String::from_utf8_lossy(bytes)),
            name: format!("{}.svg", stem_of(path)),
            bytes: bytes.clone(),
        })
    }
}
