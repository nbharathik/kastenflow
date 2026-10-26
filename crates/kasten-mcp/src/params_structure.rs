//! Arguments of the structure tools, with the descriptions agents see in each
//! tool's schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetParentArgs {
    /// The page to move: its id, title or vault path.
    pub note: String,
    /// The page to put it inside: its id, title or vault path. Null or left
    /// out takes it out of the page it is in.
    pub parent: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ReorderChildrenArgs {
    /// The page whose sub-pages are put in order: its id, title or vault path.
    pub note: String,
    /// The sub-pages first to last, each by id, title or vault path. Ones left
    /// out follow alphabetically. An empty list goes back to alphabetical.
    pub children: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct CreateProjectArgs {
    /// The project's title. It also names the project's folder.
    pub title: String,
    /// A way to start it, with pages and a whiteboard ready: `research`,
    /// `writing` or `presentation`. Leave out for an empty project.
    pub setup: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SaveProjectSetupArgs {
    /// The project to save: its title, its folder name under projects/, or the
    /// path of its page.
    pub project: String,
    /// What the setup is called when someone starts a new project: a short
    /// name on one line.
    pub name: String,
    /// Its file name, letters, digits and dashes. Leave out to make one of the
    /// name; one that is taken gets a number.
    pub slug: Option<String>,
    /// The pages to keep as its starting pages, each by title or vault path.
    /// Leave out for the pages directly under the project's pages folder.
    pub pages: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetProjectStateArgs {
    /// The project: its title, its folder name under projects/, or the path of
    /// its page.
    pub project: String,
    /// What to change, an object with any of: `status` (Active, Paused or
    /// Done), `health` (On track, At risk or Blocked), `nextAction` (a task
    /// note's id, title or path), `reviewed` and `reviewAfter` (days written
    /// YYYY-MM-DD). A key left out stays as it is; null takes it away.
    pub change: Value,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetViewOrderArgs {
    /// The tag, with or without the #. It must have a schema with that view.
    pub tag: String,
    /// The view's name as `query_tag` lists it (`Table`, say).
    pub view: String,
    /// The rows first to last, each by id, title or vault path. A row you
    /// leave out follows at the end. An empty list takes the hand-made order
    /// away. The order is used only while the view has no sort.
    pub rows: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetTagViewsArgs {
    /// The tag, with or without the #. It must have a schema already.
    pub tag: String,
    /// The views its database shows, in order, each `{"name": "Pipeline",
    /// "type": "kanban", …}` with the settings of its type (group_by, date,
    /// sort, …). They replace the views it showed; a view you leave out is
    /// taken off, which waits for review. An unknown type is refused and the
    /// error names the types there are.
    pub views: Vec<Value>,
}
