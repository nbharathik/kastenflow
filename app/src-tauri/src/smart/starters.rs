//! The starter smart pages the app ships: the files of each (a manifest, the
//! page's layout, its script) and the text the page starts with. They are the
//! app's own copy of `src/smart-kit/starters/`, compiled in, so a new page is
//! made from them by the core (`Kasten::smart_new_page`) and the window never
//! sends file contents. A person's own templates (`templates/smart/<slug>/`)
//! are listed beside them under the id `mine:<slug>`.

/// One starter.
pub struct Starter {
    pub id: &'static str,
    pub name: &'static str,
    pub summary: &'static str,
    /// The page's text.
    pub body: &'static str,
    /// The folder's files, by path.
    pub files: &'static [(&'static str, &'static str)],
}

macro_rules! file {
    ($slug:literal, $name:literal) => {
        (
            $name,
            include_str!(concat!(
                "../../../src/smart-kit/starters/",
                $slug,
                "/",
                $name
            )),
        )
    };
}

macro_rules! starter {
    ($slug:literal, $name:literal, $summary:literal) => {
        Starter {
            id: $slug,
            name: $name,
            summary: $summary,
            body: include_str!(concat!(
                "../../../src/smart-kit/starters/",
                $slug,
                "/page.md"
            )),
            files: &[
                file!($slug, "smart.yaml"),
                file!($slug, "index.html"),
                file!($slug, "app.js"),
            ],
        }
    };
}

/// The id a person's own template has in the list: `mine:<slug>`.
pub const MINE: &str = "mine:";

/// Every starter, in the order they are offered.
pub const STARTERS: &[Starter] = &[
    starter!(
        "dashboard",
        "Dashboard",
        "Counts, a chart and a table of the notes you tag"
    ),
    starter!(
        "tracker",
        "Tracker",
        "A table of notes with their status, to tick off"
    ),
    starter!("gallery", "Gallery", "Pictures from your notes in a grid"),
    starter!("map", "Map", "Notes with a place, pinned on a world map"),
    starter!("timeline", "Timeline", "Notes with dates, laid out in time"),
];

/// The starter with this id.
pub fn find(id: &str) -> Option<&'static Starter> {
    STARTERS.iter().find(|s| s.id == id)
}
