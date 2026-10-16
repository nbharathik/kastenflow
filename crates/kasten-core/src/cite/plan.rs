//! The shapes of "where is a key cited" and of renaming a citation key (serde, camelCase).

use serde::{Deserialize, Serialize};

/// A page that cites a key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitingPage {
    pub path: String,
    pub title: String,
    /// How many times it cites the key.
    pub count: usize,
}

/// A deck that cites a key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitingDeck {
    pub path: String,
    pub title: String,
    /// Citations on its slides.
    pub count: usize,
    /// Citations in its master or layouts, which a rename leaves as they are.
    pub in_layouts: usize,
}

/// Where a key is cited.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyUses {
    pub key: String,
    pub pages: Vec<CitingPage>,
    pub decks: Vec<CitingDeck>,
    /// Pictures whose sidecar names the key as their `citationKey`.
    pub assets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedPage {
    #[serde(flatten)]
    pub page: CitingPage,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedDeck {
    #[serde(flatten)]
    pub deck: CitingDeck,
    /// Hash of the deck's text: the base of the text that replaces it.
    pub hash: String,
}

/// What renaming a key would change, worked out without writing anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRenamePlan {
    pub from: String,
    pub to: String,
    /// The managed file the entry is in.
    pub file: String,
    /// Hash of the managed file: what the rename names as its base.
    pub bib_hash: String,
    pub pages: Vec<PlannedPage>,
    pub decks: Vec<PlannedDeck>,
    pub assets: Vec<String>,
}

/// A deck's new text, made by the Slides engine, with the hash of the text it was made from.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckText {
    pub path: String,
    pub base_hash: String,
    pub text: String,
}

/// A rename to make.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRename {
    pub from: String,
    pub to: String,
    /// The plan's `bib_hash`.
    pub bib_hash: String,
    /// A new text for each deck the plan lists with citations on its slides.
    #[serde(default)]
    pub decks: Vec<DeckText>,
}

/// What a rename did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRenamed {
    pub from: String,
    pub to: String,
    pub pages: usize,
    pub decks: usize,
    pub assets: usize,
    /// Citations in decks' masters or layouts, which were not renamed.
    pub layouts: usize,
    pub commit: Option<String>,
}
