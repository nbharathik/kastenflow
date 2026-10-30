//! The ops agents may run: the MCP write tools, stored as they are in
//! proposals. There is deliberately no raw file
//! write, no permanent delete and no git command.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::board::BoardChange;
use crate::comments::Anchor;
use crate::diagrams::steps::Step;
use crate::engine::ProjectState;
use crate::pages::PageStep;

mod meta;
#[cfg(test)]
mod tests;

/// One text file of a new smart page's folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SmartNewFile {
    /// Its path inside the folder (`index.html`, `data/venues.json`).
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentOp {
    Capture {
        markdown: String,
        #[serde(default)]
        tags: Vec<String>,
    },
    CreateNote {
        /// `card` or `page`.
        #[serde(rename = "type")]
        note_type: String,
        title: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        tags: Vec<String>,
        #[serde(default)]
        props: Map<String, Value>,
        /// Path of the parent page.
        #[serde(default)]
        parent: Option<String>,
        /// A template in `templates/` to start from, by name; its body is
        /// used when `body` is empty.
        #[serde(default)]
        template: Option<String>,
    },
    Append {
        path: String,
        markdown: String,
        #[serde(default)]
        heading: Option<String>,
    },
    ReplaceSection {
        path: String,
        heading: String,
        markdown: String,
    },
    UpdateProps {
        path: String,
        props: Map<String, Value>,
    },
    Tags {
        path: String,
        #[serde(default)]
        add: Vec<String>,
        #[serde(default)]
        remove: Vec<String>,
    },
    Rename {
        path: String,
        title: String,
    },
    Move {
        path: String,
        #[serde(default)]
        project: Option<String>,
    },
    JournalAppend {
        date: String,
        markdown: String,
        #[serde(default)]
        heading: Option<String>,
    },
    Trash {
        path: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A full rewrite (`propose_edit`); `base` is the body it was written
    /// against, so accepting it later merges with edits made meanwhile.
    Edit {
        path: String,
        body: String,
        base: String,
        #[serde(default)]
        reason: Option<String>,
    },
    TagSchema {
        tag: String,
        schema: Value,
    },
    CreateBoard {
        title: String,
        #[serde(default)]
        project: Option<String>,
    },
    /// Notes (by path) as cards: `grid`, `cluster_by_tag`, or one position each.
    AddToBoard {
        board: String,
        notes: Vec<String>,
        #[serde(default)]
        layout: Option<String>,
        #[serde(default)]
        positions: Option<Vec<[i64; 2]>>,
    },
    /// Nodes named by id, file or title.
    Connect {
        board: String,
        from: String,
        to: String,
        #[serde(default)]
        label: Option<String>,
    },
    Group {
        board: String,
        nodes: Vec<String>,
        label: String,
    },
    /// A batch of changes on a board, as a person's edits are sent: taking
    /// nodes off, moving, restyling. Taking off more nodes than
    /// `max_board_nodes_removed` waits for review.
    BoardChanges {
        board: String,
        changes: Vec<BoardChange>,
        /// What the batch does, in a few words for the history and the review.
        #[serde(default)]
        summary: String,
    },
    /// A template made (`create_template`) or rewritten
    /// (`update_template`), as its whole file. It always waits for review:
    /// agents never write `templates/` themselves.
    Template {
        /// The template's name: the file is `templates/<slug>.md`.
        name: String,
        /// The file as it should be, frontmatter and body.
        text: String,
        /// The file it was written against; none for a new template.
        #[serde(default)]
        base: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A deck changed by one of the deck tools. The tool has already run:
    /// this is the deck as it was (`base`) and as the tool leaves it
    /// (`text`), so a review can show both and accepting can merge the change
    /// with what a person did meanwhile.
    EditDeck {
        /// The deck's vault path.
        path: String,
        /// The tool, as the commit names it: `update_elements`.
        tool: String,
        /// What the tool did, in a few words for the history and the review.
        #[serde(default)]
        summary: String,
        base: String,
        text: String,
        /// How many bytes the agent sent to ask for it. The size limit counts
        /// these and not the deck, which a few bytes of request can grow.
        #[serde(default)]
        sent: usize,
        /// The deck as the agent leaves it with the marks that badge its work
        /// (an editor shows what an agent made until a person changes it or
        /// accepts it). An agent's own write is this version. A change a
        /// person accepted in the review is `text`: they have looked at it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        marked: Option<String>,
    },
    /// A new deck, as a tool made it.
    CreateDeck {
        title: String,
        /// The project folder to put it in; none means the library.
        #[serde(default)]
        project: Option<String>,
        tool: String,
        text: String,
        #[serde(default)]
        sent: usize,
        /// As for `EditDeck`: the deck with the agent's marks.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        marked: Option<String>,
    },
    /// A new diagram, as its `mxfile` XML (a blank page when `xml` is empty).
    CreateDiagram {
        title: String,
        /// The project folder to put it in; none means the library.
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        xml: String,
    },
    /// A diagram's source written whole. `base` is the XML the agent read, so
    /// accepting a proposal later keeps what a person drew meanwhile: if the
    /// file is no longer `base`, the agent's version goes to a copy beside it.
    UpdateDiagram {
        path: String,
        xml: String,
        base: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Typed steps on a diagram (`add_node`, `add_edge`, `layout`, …). They
    /// are run on the diagram as it is when they are applied, so accepting a
    /// proposal later, or applying staged changes, keeps what a person drew
    /// meanwhile instead of putting a whole file over it.
    EditDiagram {
        path: String,
        /// The page the steps start on; the first when none.
        #[serde(default)]
        page: Option<String>,
        /// The preset the kinds are looked up in; the default when none.
        #[serde(default)]
        preset: Option<String>,
        steps: Vec<Step>,
        #[serde(default)]
        reason: Option<String>,
        /// What the steps do, in a few words for the history and the review;
        /// worked out from the steps when left empty.
        #[serde(default)]
        summary: String,
    },
    /// A LaTeX source file written whole (`.tex`, `.sty`, `.cls`, `.bst`, or
    /// a `.bib` inside a LaTeX folder). `base` is the text the agent read, so
    /// accepting a proposal later keeps what a person typed meanwhile; empty
    /// for a new file, which is a new document when it is a root `.tex`.
    SaveSource {
        path: String,
        text: String,
        #[serde(default)]
        base: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A new LaTeX document made from a template (`article`, `report` or
    /// `beamer`; empty means `article`): a folder of its own in `project`
    /// (or the library) holding the root file. The folder's name is numbered
    /// when it is taken.
    CreateLatexDoc {
        title: String,
        #[serde(default)]
        template: String,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Text added to a LaTeX source file: at its end, or right after `after`,
    /// a piece of text that is in the file exactly once. `base_hash` is the
    /// hash of the file the agent read; every other byte stays as it was.
    AppendLatexFile {
        path: String,
        base_hash: String,
        text: String,
        #[serde(default)]
        after: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A LaTeX source file taken out of its document. It goes to the trash and
    /// can be put back; nothing is deleted for good.
    TrashLatexFile {
        path: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A picture for a LaTeX document (`doc` is its folder), kept in the
    /// document's `figures/` folder: a PNG, JPEG or PDF (an SVG too, but it
    /// needs a converter). Its bytes are `base64` or the file of the vault at
    /// `vault_path`; the same bytes already there are the same file. It adds a
    /// file and changes none, so it is never held for review: the limits on an
    /// agent's pictures hold it instead.
    AddLatexAsset {
        doc: String,
        name: String,
        #[serde(default)]
        base64: Option<String>,
        #[serde(default)]
        vault_path: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// `\cite{key}` put in a LaTeX file of a document (`doc` is its folder,
    /// `file` the file's vault path), at the end of the paragraph that holds
    /// `at` or at the end of the file, with the Reference's entry in the
    /// document's `references.bib` once. The Reference itself is never changed.
    CiteReference {
        doc: String,
        file: String,
        key: String,
        #[serde(default)]
        at: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// The built PDF of a LaTeX document (`doc` is its folder) kept beside its
    /// root file. It names nothing else: the bytes are the app's last build,
    /// read from the vault's cache when the op runs (never sent by the agent),
    /// so a proposal for it carries none. The person's own Export PDF is a
    /// different, person-only call.
    ExportLatexPdf {
        doc: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A page (or one section of it, under `section`) sent to LaTeX as the
    /// app's "Send to LaTeX" does: added to the root file of the document in
    /// `doc` (its folder), or made into a new document (`title`, `template`,
    /// `project`) when `doc` is left out.
    SendPageToLatex {
        page: String,
        #[serde(default)]
        section: Option<String>,
        #[serde(default)]
        doc: Option<String>,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        template: String,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A text file of a smart page's code folder written whole (`index.html`,
    /// `app.js`, a stylesheet, data, the manifest). `page` is the smart page's
    /// path and `path` the file inside its folder. `base` is the hash the agent
    /// read the file with; empty for a new file, which must not be there yet.
    /// Pictures are added by a person.
    SmartWrite {
        page: String,
        path: String,
        content: String,
        #[serde(default)]
        base: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A new smart page made whole: the page with `layout: smart` and its
    /// code folder (`files`, text only, with an `index.html`), in one commit.
    /// Nothing is there yet to be read, so no base.
    SmartCreate {
        title: String,
        /// The project folder to put it in; none means the library.
        #[serde(default)]
        project: Option<String>,
        /// Path of the parent page.
        #[serde(default)]
        parent: Option<String>,
        files: Vec<SmartNewFile>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A file of a smart page's folder taken out. It goes to the trash and
    /// can be put back; nothing is deleted for good.
    SmartDelete {
        page: String,
        path: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// A request to a person to turn smart pages on, for the whole vault or
    /// for one project (`project`, its folder or name). It changes nothing by
    /// itself and runs in no mode: it is always kept for the person, and only
    /// their accepting it turns anything on. Rejecting it changes nothing.
    RequestSmartPages {
        /// Why the agent wants smart pages, in a sentence, for the person.
        reason: String,
        #[serde(default)]
        project: Option<String>,
    },
    /// Steps on a page's blocks (`edit_page`): insert, replace, move, delete,
    /// wrap in columns, a toggle or a callout, tick a task, change a table or
    /// add an embed. The steps name blocks by the id and hash `read_page_blocks`
    /// gave, and are made against the page as it is when they run: a block that
    /// changed since refuses all of them.
    EditPage {
        path: String,
        steps: Vec<PageStep>,
        /// Why, for the person reviewing it.
        #[serde(default)]
        reason: Option<String>,
    },
    /// Several changes as one (`batch`): all are made or none, in one commit
    /// that one undo takes back; when any of them needs review the whole batch
    /// waits as one proposal. See the `batch` module for what it may hold.
    Batch {
        ops: Vec<AgentOp>,
        /// Why the agent sends them, in a few words for the review and the history.
        #[serde(default)]
        reason: Option<String>,
    },
    /// A page put inside another (`parent`, a page's path), moving it and its
    /// sub-pages to the parent's project or the library; with no parent the
    /// page leaves its page where it is.
    SetParent {
        path: String,
        #[serde(default)]
        parent: Option<String>,
    },
    /// The order a page's sub-pages are shown in: `ids` are the sub-pages'
    /// ids, first to last. Ids that are not sub-pages are ignored and the
    /// sub-pages left out follow alphabetically; no ids at all goes back to
    /// alphabetical. Written into the parent page's frontmatter.
    ReorderChildren {
        /// The parent page's path.
        parent: String,
        ids: Vec<String>,
    },
    /// A new project, empty or from one of the project setups (`setup`).
    CreateProject {
        title: String,
        #[serde(default)]
        setup: Option<String>,
    },
    /// A project page's status, health, next action and review days, through
    /// the op that checks every value.
    SetProjectState {
        /// The project page's path, `projects/<name>/_project.md`.
        path: String,
        state: ProjectState,
    },
    /// The views a tag's database shows, replacing the ones it showed before.
    SetTagViews {
        tag: String,
        views: Vec<Value>,
    },
    /// The order a tag's database shows the rows of one of its views in, by
    /// note id, first to last. Stored as `order` in the view; used only when
    /// the view has no sort. No ids takes the order away.
    SetViewOrder {
        tag: String,
        view: String,
        ids: Vec<String>,
    },
    /// A copy of a note beside it, with its comments and highlights.
    DuplicateNote {
        path: String,
    },
    /// A note taken out of the trash, with the sub-pages that went with it;
    /// `path` is where it is now, `.trash/<time>/<path>`.
    RestoreNote {
        path: String,
    },
    /// One page header key: `icon`, `cover`, `font`, `width`, `text` or
    /// `layout`. No value takes the key off.
    SetNoteMeta {
        path: String,
        key: String,
        #[serde(default)]
        value: Option<String>,
    },
    /// An empty page filled from a template, by name.
    ApplyTemplate {
        path: String,
        template: String,
        /// The day the template's date words mean; today when none.
        #[serde(default)]
        date: Option<String>,
    },
    /// A journal day, made from the template if it is not there yet.
    JournalDay {
        date: String,
    },
    /// A to-do ticked or unticked: `line` is its line in the body from 0, as
    /// `list_tasks` tells it, and `base` the hash of the note it read it in.
    SetTask {
        path: String,
        line: u32,
        done: bool,
        base: String,
    },
    /// A comment on a page, signed by the agent.
    AddComment {
        path: String,
        anchor: Anchor,
        text: String,
    },
    /// A comment resolved, or opened again.
    ResolveComment {
        path: String,
        id: String,
        resolved: bool,
    },
    /// A saved search: its name, and its keys (`icon`, `query`, `when`,
    /// `filter`, `sort`, `display`).
    CreateCollection {
        name: String,
        edits: Map<String, Value>,
    },
    /// Keys of a saved search changed; `base` is its hash as listed.
    UpdateCollection {
        /// `views/<name>.yaml`.
        path: String,
        edits: Map<String, Value>,
        base: String,
    },
    /// A reference added to the managed bibliography.
    AddReference {
        #[serde(rename = "type")]
        kind: String,
        key: String,
        #[serde(default)]
        fields: BTreeMap<String, String>,
        #[serde(default)]
        allow_duplicate: bool,
    },
    RenameDiagram {
        path: String,
        title: String,
    },
    MoveDiagram {
        path: String,
        #[serde(default)]
        project: Option<String>,
    },
    DuplicateDiagram {
        path: String,
    },
    /// Every change of one agent session taken back, newest first. Only the
    /// agent's own session runs at once; another's waits for review (unless
    /// the person lets agents work on their own).
    UndoSession {
        session: String,
    },
    /// A project saved as a setup new projects can start from: `project` is
    /// its folder or its page's path, `title` the setup's name, `slug` its
    /// file name (blank makes one of the title), `pages` the vault paths of
    /// the pages kept (none: those directly under the project's `pages/`).
    SaveProjectSetup {
        project: String,
        #[serde(default)]
        slug: String,
        title: String,
        #[serde(default)]
        pages: Option<Vec<String>>,
    },
}

impl AgentOp {
    /// Whether the op makes a new note rather than changing one.
    pub fn creates(&self) -> bool {
        matches!(
            self,
            AgentOp::Capture { .. }
                | AgentOp::CreateNote { .. }
                | AgentOp::JournalAppend { .. }
                | AgentOp::CreateBoard { .. }
                | AgentOp::CreateDeck { .. }
                | AgentOp::CreateDiagram { .. }
                | AgentOp::SmartCreate { .. }
                | AgentOp::CreateLatexDoc { .. }
                | AgentOp::SendPageToLatex { doc: None, .. }
                | AgentOp::CreateProject { .. }
                | AgentOp::DuplicateNote { .. }
                | AgentOp::RestoreNote { .. }
                | AgentOp::JournalDay { .. }
                | AgentOp::CreateCollection { .. }
                | AgentOp::DuplicateDiagram { .. }
                | AgentOp::Template { base: None, .. }
        ) || matches!(self, AgentOp::SaveSource { base, .. } if base.is_empty())
    }

    /// Where a template op writes: `templates/<slug>.md`; none for a name
    /// with no letters or digits.
    pub fn template_path(name: &str) -> Option<String> {
        name.chars()
            .any(char::is_alphanumeric)
            .then(|| format!("templates/{}.md", crate::slug::slugify(name)))
    }
}
