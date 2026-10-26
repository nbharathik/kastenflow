//! What the engine learns by parsing a board or a deck, or by reading a note
//! for the pictures it shows, kept until the file changes. Lists, counts, the
//! link graph and the picture usage all want a few facts from every board,
//! deck and note; reading and parsing each file again for every call was
//! most of what they cost. An entry is valid while the file's modified time
//! and size are what they were when it was parsed, and the engine forgets a
//! path outright whenever a change to it is counted (`bump`), which also
//! covers a rewrite that keeps both. Everything here is derived: a fresh
//! `Kasten` reads the same facts from the same files.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::{Arc, MutexGuard};

use slides_assets::deck::DeckImages;

use super::Kasten;
use crate::assets::refs::{Ref, image_refs};
use crate::board;
use crate::deck;
use crate::error::Result;
use crate::latex::{LatexFacts, read_facts};
use crate::note::meta_for;
use crate::vault::FileStat;

/// What picture usage needs to know about a note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NoteRefs {
    /// The note's title; left empty for a note that shows no picture.
    pub title: String,
    /// The pictures it names, in the order `image_refs` finds them.
    pub refs: Vec<Ref>,
}

/// What lists and the graph need to know about a board.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BoardFacts {
    /// `x-kasten.title`, else the file's name without `.canvas`.
    pub title: String,
    pub nodes: usize,
    /// The files its cards show, sorted and without repeats.
    pub files: Vec<String>,
    /// The id of the page the board is a map of.
    pub source: Option<String>,
}

/// What lists, the graph and picture usage need to know about a deck.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeckFacts {
    /// The deck's title, else the file's name without `.deck`.
    pub title: String,
    pub slides: usize,
    /// Why the deck cannot be opened, when it cannot.
    pub problem: Option<String>,
    /// The pictures of each slide and of the theme; none when the text could not be read.
    pub images: Option<DeckImages>,
}

struct Entry<T> {
    modified: u64,
    size: u64,
    /// None: the file could not be read as a board (or deck), and is left out.
    facts: Option<Arc<T>>,
}

impl<T> Entry<T> {
    fn holds(&self, stat: &FileStat) -> bool {
        self.modified == stat.modified && self.size == stat.size
    }
}

#[derive(Default)]
pub(super) struct FileCache {
    boards: HashMap<String, Entry<BoardFacts>>,
    decks: HashMap<String, Entry<DeckFacts>>,
    notes: HashMap<String, Entry<NoteRefs>>,
    latex: HashMap<String, Entry<LatexFacts>>,
    /// Counts the changes that forgot paths, so a parse that raced one is not kept.
    forgotten: u64,
    /// Boards and decks parsed so far (tests and benches read it).
    parses: usize,
    /// Notes read for their pictures so far (tests read it).
    note_reads: usize,
}

/// The boards and decks a walk found, with their facts, and the diagrams it passed.
#[derive(Default)]
pub(super) struct Walked {
    pub boards: Vec<(FileStat, Arc<BoardFacts>)>,
    pub decks: Vec<(FileStat, Arc<DeckFacts>)>,
    pub diagrams: Vec<FileStat>,
    /// The `.tex` files, with what their first lines say.
    pub latex: Vec<(FileStat, Arc<LatexFacts>)>,
}

fn stem(path: &str, ending: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(ending).unwrap_or(name).to_owned()
}

/// A board's facts, or None when it cannot be read.
fn parse_board(kasten: &Kasten, path: &str) -> Option<BoardFacts> {
    let canvas = board::read_board(&kasten.vault, path).ok()?;
    let mut files: Vec<String> = canvas
        .nodes()
        .iter()
        .filter(|n| n.get("type").and_then(|t| t.as_str()) == Some("file"))
        .filter_map(|n| n.get("file").and_then(|f| f.as_str()))
        .map(str::to_owned)
        .collect();
    files.sort_unstable();
    files.dedup();
    Some(BoardFacts {
        title: canvas
            .title()
            .map_or_else(|| stem(path, ".canvas"), str::to_owned),
        nodes: canvas.nodes().len(),
        files,
        source: canvas.source_page().map(str::to_owned),
    })
}

fn parse_deck(kasten: &Kasten, path: &str) -> DeckFacts {
    let file = match deck::read_deck(&kasten.vault, path) {
        Ok(file) => file,
        Err(err) => {
            return DeckFacts {
                title: stem(path, ".deck"),
                slides: 0,
                problem: Some(err.to_string()),
                images: None,
            };
        }
    };
    let images = deck::images_by_slide(&file.text);
    match deck::head_of(&file.text) {
        Ok(head) => DeckFacts {
            title: head
                .title
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| stem(path, ".deck")),
            slides: head.slides,
            problem: None,
            images,
        },
        Err(err) => DeckFacts {
            title: stem(path, ".deck"),
            slides: 0,
            problem: Some(err.to_string()),
            images,
        },
    }
}

/// A note's picture references, or None when it cannot be read as text.
fn read_note(kasten: &Kasten, stat: &FileStat) -> Option<NoteRefs> {
    let text = fs::read_to_string(kasten.vault.root().join(&stat.path)).ok()?;
    let refs = image_refs(&stat.path, &text);
    // Only a note that shows a picture is listed, so only it needs a title.
    let title = if refs.is_empty() {
        String::new()
    } else {
        meta_for(&stat.path, &text, stat.modified).title
    };
    Some(NoteRefs { title, refs })
}

impl Kasten {
    fn file_cache(&self) -> MutexGuard<'_, FileCache> {
        self.file_cache.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Forgets what the cache knows of these paths.
    pub(super) fn forget_files(&self, paths: &[String]) {
        let mut cache = self.file_cache();
        cache.forgotten += 1;
        for path in paths {
            cache.boards.remove(path);
            cache.decks.remove(path);
            cache.notes.remove(path);
            cache.latex.remove(path);
        }
    }

    /// Forgets everything the cache knows, as a fresh engine would (benches).
    #[doc(hidden)]
    pub fn forget_file_cache(&self) {
        let mut cache = self.file_cache();
        cache.forgotten += 1;
        cache.boards.clear();
        cache.decks.clear();
        cache.notes.clear();
        cache.latex.clear();
    }

    /// How many boards and decks have been parsed so far (tests and benches).
    #[doc(hidden)]
    pub fn file_cache_parses(&self) -> usize {
        self.file_cache().parses
    }

    /// How many notes have been read for their pictures so far (tests).
    #[doc(hidden)]
    pub fn note_reads(&self) -> usize {
        self.file_cache().note_reads
    }

    /// Every note that can be read, in path order, with the pictures it
    /// names: from the cache when the file is as it was, read when it is not.
    /// The reading is done without holding the cache, as for boards and decks.
    pub(super) fn note_refs(&self) -> Result<Vec<(FileStat, Arc<NoteRefs>)>> {
        let found = self.vault.files(".md")?;
        let since;
        let mut slots: Vec<Option<Arc<NoteRefs>>> = Vec::with_capacity(found.len());
        {
            let cache = self.file_cache();
            since = cache.forgotten;
            for stat in &found {
                slots.push(match cache.notes.get(&stat.path) {
                    Some(e) if e.holds(stat) => e.facts.clone(),
                    _ => None,
                });
            }
        }
        let mut fresh: Vec<usize> = Vec::new();
        for (at, stat) in found.iter().enumerate() {
            if slots[at].is_none()
                && let Some(refs) = read_note(self, stat)
            {
                slots[at] = Some(Arc::new(refs));
                fresh.push(at);
            }
        }
        let mut cache = self.file_cache();
        cache.note_reads += fresh.len();
        // A change counted while the notes were read may have made them old.
        if cache.forgotten == since {
            for &at in &fresh {
                let stat = &found[at];
                cache.notes.insert(
                    stat.path.clone(),
                    Entry {
                        modified: stat.modified,
                        size: stat.size,
                        facts: slots[at].clone(),
                    },
                );
            }
        }
        // What the walk did not find is gone.
        let seen: HashSet<&str> = found.iter().map(|f| f.path.as_str()).collect();
        cache.notes.retain(|path, _| seen.contains(path.as_str()));
        drop(cache);
        Ok(found
            .into_iter()
            .zip(slots)
            .filter_map(|(stat, facts)| facts.map(|facts| (stat, facts)))
            .collect())
    }

    /// Every board, in path order, with its facts; one that cannot be read is left out.
    pub(super) fn board_facts(&self) -> Result<Vec<(FileStat, Arc<BoardFacts>)>> {
        Ok(self.walk_facts(&[".canvas"])?.boards)
    }

    /// Every deck, templates included, in path order, with its facts.
    pub(super) fn deck_facts(&self) -> Result<Vec<(FileStat, Arc<DeckFacts>)>> {
        Ok(self.walk_facts(&[".deck"])?.decks)
    }

    /// One walk of the vault for the files ending in `endings` (`.canvas`,
    /// `.deck`, `.drawio`), the facts of each board and deck taken from the
    /// cache when the file is as it was and parsed when it is not. The parsing
    /// is done without holding the cache, so a slow file blocks no other call.
    pub(super) fn walk_facts(&self, endings: &[&str]) -> Result<Walked> {
        let found = self.vault.files_among(endings)?;
        // What each file has, taken from the cache in one short look.
        let mut slots: Vec<Slot> = Vec::with_capacity(found.len());
        let since;
        {
            let cache = self.file_cache();
            since = cache.forgotten;
            for stat in &found {
                slots.push(if stat.path.ends_with(".canvas") {
                    match cache.boards.get(&stat.path) {
                        Some(e) if e.holds(stat) => Slot::Board(e.facts.clone()),
                        _ => Slot::Parse,
                    }
                } else if stat.path.ends_with(".deck") {
                    match cache.decks.get(&stat.path) {
                        Some(e) if e.holds(stat) => e.facts.clone().map_or(Slot::Parse, Slot::Deck),
                        _ => Slot::Parse,
                    }
                } else if stat.path.ends_with(".tex") {
                    match cache.latex.get(&stat.path) {
                        Some(e) if e.holds(stat) => {
                            e.facts.clone().map_or(Slot::Parse, Slot::Latex)
                        }
                        _ => Slot::Parse,
                    }
                } else {
                    Slot::Diagram
                });
            }
        }
        // The rest is parsed with the cache free.
        let mut fresh: Vec<usize> = Vec::new();
        for (at, stat) in found.iter().enumerate() {
            if matches!(slots[at], Slot::Parse) {
                slots[at] = if stat.path.ends_with(".canvas") {
                    Slot::Board(parse_board(self, &stat.path).map(Arc::new))
                } else if stat.path.ends_with(".tex") {
                    Slot::Latex(Arc::new(read_facts(&self.vault.root().join(&stat.path))))
                } else {
                    Slot::Deck(Arc::new(parse_deck(self, &stat.path)))
                };
                fresh.push(at);
            }
        }
        let mut cache = self.file_cache();
        cache.parses += fresh.len();
        // A change counted while the files were read may have made them old.
        if cache.forgotten == since {
            for &at in &fresh {
                let stat = &found[at];
                match &slots[at] {
                    Slot::Board(facts) => {
                        cache.boards.insert(
                            stat.path.clone(),
                            Entry {
                                modified: stat.modified,
                                size: stat.size,
                                facts: facts.clone(),
                            },
                        );
                    }
                    Slot::Deck(facts) => {
                        cache.decks.insert(
                            stat.path.clone(),
                            Entry {
                                modified: stat.modified,
                                size: stat.size,
                                facts: Some(facts.clone()),
                            },
                        );
                    }
                    Slot::Latex(facts) => {
                        cache.latex.insert(
                            stat.path.clone(),
                            Entry {
                                modified: stat.modified,
                                size: stat.size,
                                facts: Some(facts.clone()),
                            },
                        );
                    }
                    Slot::Diagram | Slot::Parse => {}
                }
            }
        }
        // What the walk did not find is gone.
        let seen: HashSet<&str> = found.iter().map(|f| f.path.as_str()).collect();
        if endings.contains(&".canvas") {
            cache.boards.retain(|path, _| seen.contains(path.as_str()));
        }
        if endings.contains(&".deck") {
            cache.decks.retain(|path, _| seen.contains(path.as_str()));
        }
        if endings.contains(&".tex") {
            cache.latex.retain(|path, _| seen.contains(path.as_str()));
        }
        drop(cache);
        let mut walked = Walked::default();
        for (stat, slot) in found.iter().cloned().zip(slots) {
            match slot {
                Slot::Board(Some(facts)) => walked.boards.push((stat, facts)),
                Slot::Deck(facts) => walked.decks.push((stat, facts)),
                Slot::Diagram => walked.diagrams.push(stat),
                Slot::Latex(facts) => walked.latex.push((stat, facts)),
                Slot::Board(None) | Slot::Parse => {}
            }
        }
        Ok(walked)
    }
}

/// What a walk has found out about one file so far.
enum Slot {
    Diagram,
    Board(Option<Arc<BoardFacts>>),
    Deck(Arc<DeckFacts>),
    Latex(Arc<LatexFacts>),
    /// Not in the cache as it is now: to be parsed.
    Parse,
}
