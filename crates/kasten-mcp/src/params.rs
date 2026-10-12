//! Tool arguments, with the descriptions agents see in each tool's schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SearchArgs {
    /// Words to find. The last word also matches as a prefix. Filters may
    /// stand among them: `on:2026-10-06`, `created:2026-10`,
    /// `updated:2026-09-01..2026-09-30` and `under:<note id or path>`.
    pub query: String,
    /// Only notes with this tag.
    pub tag: Option<String>,
    /// Only notes in this project (its folder name under projects/).
    pub project: Option<String>,
    /// Only this note type: card, page, journal, project or chat.
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    /// Only notes changed on or after this day, YYYY-MM-DD.
    pub after: Option<String>,
    /// Only notes changed before this day, YYYY-MM-DD.
    pub before: Option<String>,
    /// At most this many results (default 20, at most 100).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ReadNoteArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// Also list the notes that link here.
    #[serde(default)]
    pub with_backlinks: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ListNotesArgs {
    /// Only notes in this project (its folder name under projects/).
    pub project: Option<String>,
    /// Only notes with this tag.
    pub tag: Option<String>,
    /// Only this note type: card, page, journal, project or chat.
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    /// `updated` (newest first, the default), `title` or `created`.
    pub sort: Option<String>,
    /// At most this many (default 50, at most 500).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct QueryTagArgs {
    /// The tag whose notes to list, with their properties.
    pub tag: String,
    /// Only rows whose properties equal these values, such as {"status": "Drafting"}.
    #[serde(default)]
    pub filter: Map<String, Value>,
    /// A property to sort by; prefix with `-` for descending, such as `-deadline`.
    pub sort: Option<String>,
    /// A saved view of the tag, such as "Board": its filters and sorts apply
    /// first (as in the app), and a board's columns come back with counts.
    pub view: Option<String>,
    /// At most this many rows (default 100, at most 500).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct JournalArgs {
    /// The day, YYYY-MM-DD. Defaults to today (UTC).
    pub date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct HistoryArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// At most this many commits (default 20).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct CaptureArgs {
    /// The card's Markdown. Its first line becomes the title.
    pub markdown: String,
    /// Tags to add, without `#`.
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct CreateNoteArgs {
    /// `card` (a short note) or `page` (a long one).
    #[serde(rename = "type")]
    pub note_type: String,
    pub title: String,
    /// The Markdown body. Link other notes with [[Their title]], or [[their/path|Their title]] when several notes share the title.
    #[serde(default)]
    pub body: String,
    /// A project's folder name under projects/; without it the note goes to the inbox (cards) or the library (pages).
    pub project: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Property values, checked against the tags' schemas.
    #[serde(default)]
    pub props: Map<String, Value>,
    /// The parent page (id, title or path), to make this a sub-page.
    pub parent: Option<String>,
    /// Start from this template (list_templates names them); its body is
    /// used when `body` is empty, and its tags and properties are kept.
    pub template: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct CreateTemplateArgs {
    /// The template's name, as the gallery shows it, such as "Weekly review".
    pub name: String,
    /// The Markdown that pages made from it start with. {{title}}, {{date}}
    /// and {{project}} are filled in when a page is made.
    #[serde(default)]
    pub body: String,
    /// `page` (the default) or `card`.
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    /// Tags every page made from it gets.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Starting property values, checked against the tags' schemas when used.
    #[serde(default)]
    pub props: Map<String, Value>,
    /// An emoji for pages made from it.
    pub icon: Option<String>,
    /// A cover preset, such as gradient-ocean.
    pub cover: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct UpdateTemplateArgs {
    /// The template's name (list_templates gives them).
    pub name: String,
    /// Its new Markdown body; its frontmatter stays as it is.
    pub body: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct AppendArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// Markdown to add. Nothing is ever removed.
    pub markdown: String,
    /// Add at the end of the section under this heading instead of the end of the note.
    pub under_heading: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ReplaceSectionArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// The heading whose section to replace (its text, any level).
    pub heading: String,
    /// The section's new Markdown, without the heading line.
    pub markdown: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct UpdatePropsArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// Properties to set; null removes one. Relations take note ids, paths
    /// or titles (a path when several notes share the title).
    pub props: Map<String, Value>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct TagsArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// Tags, without `#`.
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct RenameArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// The new title. Links to the note are rewritten.
    pub title: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct MoveArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// A project's folder name under projects/, or null for the library.
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct JournalAppendArgs {
    pub markdown: String,
    /// The day, YYYY-MM-DD. Defaults to today (UTC).
    pub date: Option<String>,
    /// Add under this heading of the day, such as `Notes`.
    pub under_heading: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct TrashArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ProposeEditArgs {
    /// The note's id, title or vault path.
    pub note: String,
    /// The whole new body (without frontmatter).
    pub new_body: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct TagSchemaArgs {
    pub tag: String,
    /// {color, properties: [{key, type, options}], views: [{name, type, ...}]}. Types: text, number, select, multi_select, date, checkbox, url, relation.
    pub schema: Value,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct BoardArgs {
    /// The board's title or vault path (`.canvas`).
    pub board: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct CreateBoardArgs {
    pub title: String,
    /// A project's folder name under projects/; without it the board goes to the library.
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct AddToBoardArgs {
    /// The board's title or vault path.
    pub board: String,
    /// Notes to put on it as cards (ids, titles or paths). Notes already there stay put.
    pub notes: Vec<String>,
    /// `grid` (the default) or `cluster_by_tag` (a labelled section per tag).
    pub layout: Option<String>,
    /// Instead of a layout, each card's top-left corner as [x, y], one per note.
    pub positions: Option<Vec<[i64; 2]>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ConnectArgs {
    /// The board's title or vault path.
    pub board: String,
    /// A node: its id, the note title on a card, or a section label.
    pub from: String,
    pub to: String,
    /// A short label for the arrow, such as "leads to".
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct DiagramArgs {
    /// The diagram's title or vault path (`.drawio`).
    pub diagram: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct CreateDiagramArgs {
    pub title: String,
    /// The diagram's source: draw.io's uncompressed `mxfile` XML. Left out, the diagram starts blank.
    pub xml: Option<String>,
    /// A project's folder name under projects/; without it the diagram goes to the library.
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct UpdateDiagramArgs {
    /// The diagram's title or vault path (`.drawio`).
    pub diagram: String,
    /// The whole new source: `get_diagram`'s XML, changed. Keep the `id` of every cell you do not mean to change.
    pub xml: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct TrashDiagramArgs {
    /// The diagram's title or vault path (`.drawio`).
    pub diagram: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct GroupArgs {
    /// The board's title or vault path.
    pub board: String,
    /// The nodes to gather: ids, note titles or labels.
    pub nodes: Vec<String>,
    /// The section's title.
    pub title: String,
}
