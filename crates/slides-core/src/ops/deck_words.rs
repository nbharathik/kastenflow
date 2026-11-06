//! What a deck keeps for itself beyond its slides: the words its spelling check leaves alone, and
//! the font files it carries. Both are saved with the deck; each change is one step of undo.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, DeckFont};

/// The most words a deck's dictionary holds, and the longest one is.
pub const MOST_WORDS: usize = 2000;
pub const LONGEST_WORD: usize = 64;
/// The most fonts a deck carries, and the longest a family name is.
pub const MOST_FONTS: usize = 24;
pub const LONGEST_FAMILY: usize = 80;

/// The file kinds a font can be.
const FONT_EXTENSIONS: [&str; 4] = [".ttf", ".otf", ".woff", ".woff2"];

/// A word as the dictionary keeps it: trimmed, and None when it is not one word of a sensible length.
pub fn clean_word(word: &str) -> Option<String> {
    let word = word.trim();
    let sensible = !word.is_empty()
        && word.chars().count() <= LONGEST_WORD
        && !word.chars().any(|c| c.is_whitespace() || c.is_control());
    sensible.then(|| word.to_owned())
}

/// Why a font cannot be kept, or None when it can. A family goes into a style rule, so it may
/// hold no quote, brace, semicolon, backslash or angle bracket.
fn refuse_font(font: &DeckFont) -> Option<String> {
    let family = font.family.trim();
    if family.is_empty() || family.chars().count() > LONGEST_FAMILY {
        return Some(format!(
            "A font's family name is 1 to {LONGEST_FAMILY} characters."
        ));
    }
    if family
        .chars()
        .any(|c| c.is_control() || "\"'{};\\<>()".contains(c))
    {
        return Some(format!(
            "The family name \"{family}\" has a character a font name cannot."
        ));
    }
    let src = font.src.trim();
    let lower = src.to_lowercase();
    if !lower.starts_with("assets/")
        || src.split('/').any(|part| part == ".." || part.is_empty())
        || src.contains(['\\', '"', '\'', ')', '(', '?', '#'])
    {
        return Some(format!(
            "The font file \"{src}\" has to be a file under assets/."
        ));
    }
    if !FONT_EXTENSIONS.iter().any(|ext| lower.ends_with(ext)) {
        return Some(format!(
            "The font file \"{src}\" has to be a .ttf, .otf, .woff or .woff2 file."
        ));
    }
    None
}

op_types! {
    /// Changes the words the spelling check leaves alone in this deck.
    pub struct SetDictionary {
        /// Words to add (names, terms). Spaces inside a word, empty words and words over 64 characters are refused.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub add: Option<Vec<String>>,
        /// Words to take out again (case does not matter).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub remove: Option<Vec<String>>,
    }

    /// Replaces the list of font files the deck carries.
    pub struct SetDeckFonts {
        /// Every font file of the deck, replacing the ones it has: {family, src (a file under assets/), bold?, italic?, embeddable?}.
        pub fonts: Vec<DeckFont>,
    }
}

impl Op for SetDictionary {
    type Output = ();
    const NAME: &'static str = "set_dictionary";
    const ABOUT: &'static str = "Add words to, or take words out of, the list of words the deck's spelling check leaves alone. `add` and `remove` are lists of single words; case does not matter when removing or when a word is already there.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_meta()
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let mut words = cx.deck.present.dictionary.clone();
        for word in self.remove.iter().flatten() {
            let gone = word.trim().to_lowercase();
            words.retain(|known| known.to_lowercase() != gone);
        }
        for word in self.add.iter().flatten() {
            let Some(word) = clean_word(word) else {
                return Err(Error::invalid(format!(
                    "\"{}\" is not a word the dictionary can hold: one word of 1 to {LONGEST_WORD} characters, with no spaces.",
                    word.trim()
                )));
            };
            let lower = word.to_lowercase();
            if !words.iter().any(|known| known.to_lowercase() == lower) {
                words.push(word);
            }
        }
        if words.len() > MOST_WORDS {
            return Err(Error::invalid(format!(
                "A deck's dictionary holds at most {MOST_WORDS} words."
            )));
        }
        cx.deck.present.dictionary = words;
        Ok(())
    }
}

impl Op for SetDeckFonts {
    type Output = ();
    const NAME: &'static str = "set_deck_fonts";
    const ABOUT: &'static str = "Replace the list of font files the deck carries. Each is {family, src, bold?, italic?, embeddable?}: `src` is a font file (.ttf, .otf, .woff, .woff2) under assets/, `family` the name text uses it by, and `embeddable` says the font's licence lets it travel inside an exported file (off unless the person says so).";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_meta()
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if self.fonts.len() > MOST_FONTS {
            return Err(Error::invalid(format!(
                "A deck carries at most {MOST_FONTS} font files."
            )));
        }
        for (at, font) in self.fonts.iter().enumerate() {
            if let Some(why) = refuse_font(font) {
                return Err(Error::invalid(why));
            }
            let same = |other: &&DeckFont| {
                other.family.trim() == font.family.trim()
                    && other.bold == font.bold
                    && other.italic == font.italic
            };
            if self.fonts[..at].iter().any(|other| same(&other)) {
                return Err(Error::invalid(format!(
                    "The deck already has {} in that weight and style.",
                    font.family.trim()
                )));
            }
        }
        cx.deck.present.fonts = self.fonts;
        Ok(())
    }
}
