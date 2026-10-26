//! Arguments of the smart page tools, with the descriptions agents see in each
//! tool's schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Map, Value};

/// One text file of a new smart page.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartFileArg {
    /// Its path inside the page's folder (`index.html`, `app.js`, `data/venues.json`).
    pub path: String,
    /// The whole text of the file.
    pub content: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartCreateArgs {
    /// The page's title.
    pub title: String,
    /// The project folder to put it in (as `list_notes` shows it); the library when left out.
    pub project: Option<String>,
    /// A page to put it inside, by id, title or vault path.
    pub parent: Option<String>,
    /// The page's files: text only (html, js, css, json, svg, txt), at most 200 KB together, and an
    /// `index.html` among them. A manifest `smart.yaml` is made for you from `title`, `queries` and
    /// `views`; send your own `smart.yaml` here instead only if you need more in it.
    pub files: Vec<SmartFileArg>,
    /// Named queries the page reads, by name: `{"venues": {"tag": "venue", "filter": [{"key": "status",
    /// "op": "is", "value": "open"}], "sort": [{"key": "deadline", "dir": "asc"}], "limit": 50}}`.
    /// Filter ops: is, is_not, contains, empty, not_empty, before, after.
    pub queries: Option<Map<String, Value>>,
    /// Named views of the page, shown alone by `![[Page#name]]`: `{"map": {"title": "Map", "entry": "map.html"}}`.
    pub views: Option<Map<String, Value>>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartReadArgs {
    /// The smart page: its id, title or vault path.
    pub page: String,
    /// One file to read whole, such as `app.js`. Left out, you get every file's hash and as much
    /// text as fits, with the manifest, the last errors the page reported, and the data its queries return now.
    pub file: Option<String>,
}

/// One step of `smart_edit`, made on the file as the steps before it left it.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum SmartStep {
    /// Replace one piece of text with another. `search` must be in the file exactly once.
    Replace {
        /// The text to replace, exactly as it is in the file; add some of the lines around it if it is not unique.
        search: String,
        /// What to put in its place (it may be empty to take the text out).
        replace: String,
    },
    /// Replace the whole file.
    Rewrite {
        /// The new text of the file.
        content: String,
    },
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartEditArgs {
    /// The smart page: its id, title or vault path.
    pub page: String,
    /// The file to change, relative to the page's folder (`index.html`).
    pub file: String,
    /// The `hash` `smart_read` gave for this file. When the file changed since, nothing is written and you read it again.
    pub base_hash: String,
    /// The steps, in order; all are made or none: `{"op": "replace", "search": "…", "replace": "…"}` or `{"op": "rewrite", "content": "…"}`.
    pub steps: Vec<SmartStep>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartWriteFileArgs {
    /// The smart page: its id, title or vault path.
    pub page: String,
    /// The file, relative to the page's folder. Text files only (html, js, css, json, svg, txt) and `smart.yaml`.
    pub file: String,
    /// The whole text of the file, at most 200 KB.
    pub content: String,
    /// The `hash` `smart_read` gave when the file is already there. Leave it out only for a new file.
    pub base_hash: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartDeleteFileArgs {
    /// The smart page: its id, title or vault path.
    pub page: String,
    /// The file to take out, relative to the page's folder. It goes to the trash, where the person can put it back.
    pub file: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartCheckArgs {
    /// The smart page: its id, title or vault path.
    pub page: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SmartRenderArgs {
    /// The smart page: its id, title or vault path.
    pub page: String,
    /// A named view of the page (from its manifest); the whole page when left out.
    pub view: Option<String>,
}
