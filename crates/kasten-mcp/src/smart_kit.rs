//! The smart kit's reference, as the MCP resource `kasten://smart/kit`: how a
//! smart page talks to the app, every component with its options, and three
//! finished pages. It is put together from the kit's own documentation and the
//! example pages of the `kasten-smart-pages` skill, so it cannot drift from
//! them; tests keep it equal to the kit.

use std::sync::OnceLock;

/// The resource's address.
pub const URI: &str = "kasten://smart/kit";

/// What the resource is called in a client's list.
pub const NAME: &str = "KastenFlow smart kit";

/// The resource's one-line description.
pub const DESCRIPTION: &str = "The reference for smart pages: how a page reads and changes notes, every component with its options, and three finished pages (a conference tracker, a reading dashboard, a project status board).";

/// The kit's documentation, core first, then the components in the order the
/// reference shows them.
const DOCS: [(&str, &str); 14] = [
    (
        "kit",
        include_str!("../../../app/src/smart-kit/docs/kit.md"),
    ),
    (
        "stat",
        include_str!("../../../app/src/smart-kit/docs/stat.md"),
    ),
    (
        "table",
        include_str!("../../../app/src/smart-kit/docs/table.md"),
    ),
    (
        "bar",
        include_str!("../../../app/src/smart-kit/docs/bar.md"),
    ),
    (
        "line",
        include_str!("../../../app/src/smart-kit/docs/line.md"),
    ),
    (
        "donut",
        include_str!("../../../app/src/smart-kit/docs/donut.md"),
    ),
    (
        "sparkline",
        include_str!("../../../app/src/smart-kit/docs/sparkline.md"),
    ),
    (
        "legend",
        include_str!("../../../app/src/smart-kit/docs/legend.md"),
    ),
    (
        "kanban",
        include_str!("../../../app/src/smart-kit/docs/kanban.md"),
    ),
    (
        "timeline",
        include_str!("../../../app/src/smart-kit/docs/timeline.md"),
    ),
    (
        "calendar",
        include_str!("../../../app/src/smart-kit/docs/calendar.md"),
    ),
    (
        "map",
        include_str!("../../../app/src/smart-kit/docs/map.md"),
    ),
    (
        "gallery",
        include_str!("../../../app/src/smart-kit/docs/gallery.md"),
    ),
    (
        "countdown",
        include_str!("../../../app/src/smart-kit/docs/countdown.md"),
    ),
];

/// A worked page: its name, what it shows, and its three files.
struct Example {
    name: &'static str,
    about: &'static str,
    files: [(&'static str, &'static str, &'static str); 3],
}

macro_rules! example_file {
    ($dir:literal, $file:literal, $lang:literal) => {
        (
            $file,
            $lang,
            include_str!(concat!(
                "../../../skills/kasten-smart-pages/examples/",
                $dir,
                "/",
                $file
            )),
        )
    };
}

const EXAMPLES: [Example; 3] = [
    Example {
        name: "Conference tracker",
        about: "Notes tagged `conference` (with `paper_deadline`, `abstract_deadline`, `area`, `city`, `lat`, `lon`) as countdown tiles, a map of host cities, a pipeline from abstract to paper and a card for every venue.",
        files: [
            example_file!("conference-tracker", "smart.yaml", "yaml"),
            example_file!("conference-tracker", "index.html", "html"),
            example_file!("conference-tracker", "app.js", "js"),
        ],
    },
    Example {
        name: "Reading dashboard",
        about: "Notes tagged `reading` (with `status` and `pages`) as numbers, a board whose cards move between To read, Reading and Done by changing the note, and a chart of pages by status.",
        files: [
            example_file!("reading-dashboard", "smart.yaml", "yaml"),
            example_file!("reading-dashboard", "index.html", "html"),
            example_file!("reading-dashboard", "app.js", "js"),
        ],
    },
    Example {
        name: "Project status board",
        about: "Notes tagged `task` (with `status`, `owner` and `due`) as the three due next, a board by status and a sortable table.",
        files: [
            example_file!("project-status-board", "smart.yaml", "yaml"),
            example_file!("project-status-board", "index.html", "html"),
            example_file!("project-status-board", "app.js", "js"),
        ],
    },
];

const INTRO: &str = "# KastenFlow smart kit: reference and worked pages

A smart page is a folder: `smart.yaml` (the title, `kit: \"1\"`, the named `queries` over tags, `size.height`), `index.html` and the scripts and styles it names. The app runs it in a sandbox with no network and no access to the vault except through `kasten`, so every date, place and status is read from notes and nothing is written into the page. Make a page with `smart_create`, check it with `smart_check`, read the errors the app saw with `smart_read`, and change a file with `smart_edit` or `smart_write_file`. The three finished pages at the end are complete: start from the nearest one and change its tag, its properties and its components.

The writing calls (`kasten.update`, `kasten.addTags`, `kasten.createNote`, `kasten.append`, `kasten.toggleTodo`) answer `{ status: \"done\", result }`, or `{ status: \"pending_review\", proposal, reason }` when the project's mode keeps the change for the user. Treat both as success and let `watch` bring the new notes.";

/// The whole reference: the introduction, the kit's core and components, then
/// the worked pages.
pub fn reference() -> &'static str {
    static TEXT: OnceLock<String> = OnceLock::new();
    TEXT.get_or_init(|| {
        let mut out = String::from(INTRO);
        for (_, doc) in DOCS {
            out.push_str("\n\n---\n\n");
            out.push_str(doc.trim());
        }
        out.push_str("\n\n---\n\n# Three worked pages\n");
        for example in &EXAMPLES {
            out.push_str(&format!("\n## {}\n\n{}\n", example.name, example.about));
            for (file, lang, text) in example.files {
                out.push_str(&format!(
                    "\n### {file}\n\n```{lang}\n{}\n```\n",
                    text.trim_end()
                ));
            }
        }
        out.replace("\r\n", "\n")
    })
}

/// The names of the documents the reference holds: `kit`, then each component.
pub fn documented() -> Vec<&'static str> {
    DOCS.iter().map(|(name, _)| *name).collect()
}
