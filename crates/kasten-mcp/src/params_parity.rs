//! Arguments of the parity tools (notes, journal, to-dos, comments, saved
//! searches, references, whiteboard steps, diagram files, history), with the
//! descriptions agents see in each tool's schema.

use std::collections::BTreeMap;

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct DuplicateNoteArgs {
    /// The note to copy: its id, title or vault path.
    pub note: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct RestoreNoteArgs {
    /// What to bring back: the path list_trash gives, the path the note had,
    /// or its title.
    pub note: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetNoteMetaArgs {
    /// The note: its id, title or vault path.
    pub note: String,
    /// What to change: `icon` (an emoji or icon name), `cover` (a picture's
    /// path in the vault), `font` (sans, serif or mono), `width` (normal, wide
    /// or full), `text` (small, normal, large or xl) or `layout` (sections).
    pub key: String,
    /// The new value; null or left out takes the setting off the page.
    pub value: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ApplyTemplateArgs {
    /// The empty page to fill: its id, title or vault path.
    pub note: String,
    /// The template's name, as list_templates gives it.
    pub template: String,
    /// The day its date words mean, YYYY-MM-DD. Defaults to today.
    pub date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct JournalDayArgs {
    /// The day, YYYY-MM-DD. Defaults to today (UTC).
    pub date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ListTasksArgs {
    /// `open` (default), `done` or `all`.
    pub status: Option<String>,
    /// `any` (default), `overdue`, `today`, `week` (the next seven days) or `none` (no day).
    pub due: Option<String>,
    /// `all` (default), `journal`, `other` (pages in no project) or
    /// `project:<folder name>`.
    #[serde(rename = "where")]
    pub place: Option<String>,
    /// Words that must all be in the to-do or its page's title.
    pub text: Option<String>,
    /// Today, YYYY-MM-DD, for `overdue`, `today` and `week`. Defaults to today (UTC).
    pub today: Option<String>,
    /// At most this many (default 100, at most 500).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetTaskArgs {
    /// The note the to-do is in: its id, title or vault path.
    pub note: String,
    /// The to-do's line in the note's body, from 0, as list_tasks tells it.
    pub line: u32,
    /// True to tick it, false to untick it.
    pub done: bool,
    /// The note's hash as list_tasks or read_note gave it. A note that
    /// changed since is refused.
    pub hash: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ListProjectsArgs {
    /// Today, YYYY-MM-DD, for what is overdue. Defaults to today (UTC).
    pub today: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct AddCommentArgs {
    /// The page: its id, title or vault path.
    pub note: String,
    /// The comment.
    pub text: String,
    /// The heading the comment is about; left out for the page as a whole.
    pub section: Option<String>,
    /// Which section of that title, from 1 (default 1).
    pub nth: Option<u32>,
    /// The words in that section the comment is about.
    pub quote: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ResolveCommentArgs {
    /// The page: its id, title or vault path.
    pub note: String,
    /// The comment's id, from list_comments.
    pub id: String,
    /// True (default) resolves it; false opens it again.
    pub resolved: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ListCommentsArgs {
    /// The page: its id, title or vault path.
    pub note: String,
    /// Leave out the resolved ones (default false).
    pub open_only: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct CreateCollectionArgs {
    /// The saved search's name.
    pub name: String,
    /// Its settings, an object with any of: `query` (the search box's words,
    /// such as "#paper project:thesis"), `when` (such as {"updated":
    /// "last-30-days"}), `filter` and `sort` (as a tag's views have them),
    /// `display` (such as {"type": "table", "columns": ["title"]}) and `icon`.
    pub settings: Map<String, Value>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct UpdateCollectionArgs {
    /// The saved search: its name or its path (views/<name>.yaml).
    pub collection: String,
    /// Its hash as list_collections gave it. A search that changed since is refused.
    pub hash: String,
    /// The settings to change, as for create_collection; a setting set to
    /// null is taken away, one left out stays as it is.
    pub settings: Map<String, Value>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ListReferencesArgs {
    /// Words that must all be in the reference's key or fields.
    pub query: Option<String>,
    /// At most this many (default 50, at most 200).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct AddReferenceArgs {
    /// The entry type: article, book, inproceedings, misc...
    #[serde(rename = "type")]
    pub kind: String,
    /// The citation key, letters and digits such as `rivera2026saved`. Pages and
    /// slides cite it as [@key].
    pub key: String,
    /// The fields by lower-case name: author, title, year, journal, doi, url...
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    /// Add it although the key, DOI or arXiv number is in the bibliography
    /// already (only when it is another work).
    #[serde(default)]
    pub allow_duplicate: bool,
}

/// One step on a whiteboard.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum BoardStep {
    /// A new sticky note with its top-left corner at x, y.
    AddSticky { text: String, x: i64, y: i64 },
    /// Moves a node's top-left corner to x, y.
    Move { id: String, x: i64, y: i64 },
    /// Gives a node a size; x and y are its top-left corner (keep its own to
    /// leave it where it is).
    Resize {
        id: String,
        x: i64,
        y: i64,
        width: i64,
        height: i64,
    },
    /// Takes nodes off the board with their arrows. Their notes stay.
    /// Taking off many at once waits for the user.
    Remove { ids: Vec<String> },
    /// Colours nodes or arrows: `1` to `6` or `#rrggbb`; null goes back to
    /// the default.
    Restyle {
        ids: Vec<String>,
        color: Option<String>,
    },
    /// Styles an arrow: its label, colour, ends (`none` or `arrow`), and
    /// `line` (straight, curve or elbow) and `dashed`. Leave out what stays.
    EdgeStyle {
        id: String,
        label: Option<String>,
        color: Option<String>,
        from_end: Option<String>,
        to_end: Option<String>,
        line: Option<String>,
        dashed: Option<bool>,
    },
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct BoardEditArgs {
    /// The board's title or vault path (`.canvas`).
    pub board: String,
    /// The steps, in order. All are made or none. Node and arrow ids come
    /// from read_board; a sticky made by an earlier step can not be named
    /// until the next call.
    pub steps: Vec<BoardStep>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct RenameDiagramArgs {
    /// The diagram: its title or vault path (`.drawio`).
    pub diagram: String,
    /// The new title. Links and embeds that name it follow.
    pub title: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct MoveDiagramArgs {
    /// The diagram: its title or vault path (`.drawio`).
    pub diagram: String,
    /// The project's folder name under projects/; left out moves it to the library.
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct DuplicateDiagramArgs {
    /// The diagram: its title or vault path (`.drawio`).
    pub diagram: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ListSessionsArgs {
    /// At most this many sessions, newest first (default 20).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ActivityDigestArgs {
    /// How far back to look: a span like `24h` or `3d`, `today`, a day like
    /// `2026-10-23`, or a time like `2026-10-23T08:00:00Z` (all UTC).
    /// Left out, the last 24 hours.
    pub since: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct UndoSessionArgs {
    /// The session to take back, from list_sessions. Left out takes back
    /// your own. Another session's changes wait for the user's review unless
    /// the user lets you work on your own.
    pub session: Option<String>,
}
