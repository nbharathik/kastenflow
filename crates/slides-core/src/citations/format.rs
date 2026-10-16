//! How a citation is written: the short label of a work, its whole reference,
//! and the lines a citation element shows in each of its formats.

use super::Cites;
use super::refs::Entry;
use super::venues::short_venue;
use crate::model::CitationStyle;

/// The longest a title may be when it stands for a work that names no author.
const LONGEST_TITLE: usize = 40;

/// The title, cut at a word if it is long.
fn short_title(title: &str) -> String {
    if title.chars().count() <= LONGEST_TITLE {
        return title.to_owned();
    }
    let head: String = title.chars().take(LONGEST_TITLE).collect();
    let cut = head
        .rfind(' ')
        .filter(|at| *at >= LONGEST_TITLE / 4)
        .map_or(head.as_str(), |at| &head[..at]);
    format!("{}…", cut.trim_end_matches([',', ';', ':', ' ']))
}

/// The short name of the place a work appeared: for a journal, a conference, an arXiv preprint.
fn short_place(entry: &Entry) -> Option<String> {
    if let Some(short) = entry.text("shortjournal") {
        return Some(short);
    }
    if let Some(place) = ["journal", "journaltitle", "booktitle"]
        .into_iter()
        .find_map(|name| entry.text(name))
    {
        return short_venue(&place);
    }
    entry.arxiv().map(|_| "arXiv".to_owned())
}

/// `Vaswani et al., 2017 (NeurIPS)`: who, when, and where it appeared. A work with no
/// author is named by its title; one with nothing to say is named by its key.
pub fn short_label(entry: &Entry) -> String {
    let authors = entry.authors().short();
    let who = if authors.is_empty() {
        entry.title().map(|t| short_title(&t))
    } else {
        Some(authors)
    };
    let Some(mut label) = who else {
        return entry.key().to_owned();
    };
    if let Some(year) = entry.year() {
        label = format!("{label}, {year}");
    }
    if let Some(place) = short_place(entry) {
        label = format!("{label} ({place})");
    }
    label
}

fn with_stop(text: &str) -> String {
    if text.ends_with(['.', '?', '!']) {
        text.to_owned()
    } else {
        format!("{text}.")
    }
}

/// Where a work appeared, in words that fit its kind.
fn place(entry: &Entry) -> Option<String> {
    let text = |name: &str| entry.text(name);
    let joined = |head: &str, rest: Vec<Option<String>>| {
        let mut parts = vec![head.to_owned()];
        parts.extend(rest.into_iter().flatten());
        parts.join(", ")
    };
    match entry.kind() {
        "inproceedings" | "conference" | "incollection" | "inbook" => text("booktitle")
            .map(|b| format!("In {b}"))
            .or_else(|| entry.venue()),
        "phdthesis" => Some(joined("PhD thesis", vec![text("school")])),
        "mastersthesis" => Some(joined("Master's thesis", vec![text("school")])),
        "techreport" => {
            let head = match text("number") {
                Some(number) => format!("Technical report {number}"),
                None => "Technical report".to_owned(),
            };
            Some(joined(&head, vec![text("institution")]))
        }
        _ => entry.venue(),
    }
}

/// The whole reference on one line: `A. Vaswani et al. Attention is all you need. In
/// Advances in Neural Information Processing Systems, 2017.`
pub fn full_label(entry: &Entry) -> String {
    let mut parts = Vec::new();
    let authors = entry.authors().full();
    if !authors.is_empty() {
        parts.push(with_stop(&authors));
    }
    if let Some(title) = entry.title() {
        parts.push(with_stop(&title));
    }
    match (place(entry), entry.year()) {
        (Some(place), Some(year)) => parts.push(with_stop(&format!("{place}, {year}"))),
        (Some(place), None) => parts.push(with_stop(&place)),
        (None, Some(year)) => parts.push(with_stop(&year)),
        (None, None) => {}
    }
    if parts.is_empty() {
        return entry.key().to_owned();
    }
    parts.join(" ")
}

/// A key the bibliography does not have, written as itself and marked.
fn unknown(key: &str) -> String {
    format!("{key}?")
}

/// `label` of the work a key names: the key itself when there is no bibliography to ask,
/// and the key marked when there is one and it does not have the work.
fn described(key: &str, cites: &Cites, label: fn(&Entry) -> String) -> String {
    match cites.refs {
        None => key.to_owned(),
        Some(refs) => refs.get(key).map_or_else(|| unknown(key), label),
    }
}

/// `[3]`: the number of a work, or the key alone when the deck has no number for it.
/// A key the bibliography does not have is marked instead of numbered.
fn numbered(key: &str, position: usize, cites: &Cites) -> String {
    if cites.refs.is_some_and(|refs| !refs.contains(key)) {
        return format!("[{}]", unknown(key));
    }
    match cites.numbering {
        Some(numbering) => numbering
            .number(key)
            .map_or_else(|| format!("[{key}]"), |n| format!("[{n}]")),
        None => format!("[{position}]"),
    }
}

/// A stretch of a citation's line: its words, and the key of the work they stand for when they
/// stand for one. The words between works (`; `, brackets, the number of a list item) name none.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Piece {
    pub text: String,
    pub key: Option<String>,
}

impl Piece {
    fn between(text: impl Into<String>) -> Piece {
        Piece {
            text: text.into(),
            key: None,
        }
    }

    fn of(text: String, key: &str) -> Piece {
        Piece {
            text,
            key: Some(key.to_owned()),
        }
    }
}

/// The lines a citation shows, one per paragraph, each in pieces that say which work they name.
/// `cites` says what it can look the keys up in and how the deck numbers them; with neither, the
/// keys are written as they are. Put end to end, the pieces of a line are what [`lines`] gives.
pub fn pieces(keys: &[String], style: &CitationStyle, cites: &Cites) -> Vec<Vec<Piece>> {
    let all: Vec<&str> = match (style, cites.numbering) {
        (CitationStyle::List, Some(numbering)) => numbering.keys().collect(),
        _ => keys.iter().map(String::as_str).collect(),
    };
    if all.is_empty() {
        return vec![vec![Piece::between("")]];
    }
    match style {
        CitationStyle::Short => {
            // Without a bibliography the keys stand in brackets, as a citation to be looked up.
            let bracketed = cites.refs.is_none();
            let mut line = Vec::new();
            if bracketed {
                line.push(Piece::between("("));
            }
            for (i, key) in all.iter().enumerate() {
                if i > 0 {
                    line.push(Piece::between("; "));
                }
                line.push(Piece::of(described(key, cites, short_label), key));
            }
            if bracketed {
                line.push(Piece::between(")"));
            }
            vec![line]
        }
        CitationStyle::Numbered => vec![
            all.iter()
                .enumerate()
                .map(|(i, key)| Piece::of(numbered(key, i + 1, cites), key))
                .collect(),
        ],
        CitationStyle::Full => all
            .iter()
            .map(|key| vec![Piece::of(described(key, cites, full_label), key)])
            .collect(),
        CitationStyle::List => all
            .iter()
            .enumerate()
            .map(|(i, key)| {
                vec![
                    Piece::between(format!("[{}] ", i + 1)),
                    Piece::of(described(key, cites, full_label), key),
                ]
            })
            .collect(),
    }
}

/// The lines a citation shows, one per paragraph. `cites` says what it can look the keys
/// up in and how the deck numbers them; with neither, the keys are written as they are.
pub fn lines(keys: &[String], style: &CitationStyle, cites: &Cites) -> Vec<String> {
    pieces(keys, style, cites)
        .into_iter()
        .map(|line| line.into_iter().map(|piece| piece.text).collect())
        .collect()
}
