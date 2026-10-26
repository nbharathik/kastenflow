//! The kit every smart page may load, `smart://kit/<version>/…`: plain
//! script and style files that ship inside the app. The list is written out
//! here on purpose. Starter pages, docs, examples, tests and the map's source
//! data are in the same source folder but are not the kit, so a file is
//! served only when it is named below (a test keeps this list and the folder
//! in step).

/// The kit version this app serves.
pub const VERSION: &str = kasten_core::smart::DEFAULT_KIT;

/// What the kit is called in an address: `smart://localhost/kit/1/kit.js`.
pub const SEGMENT: &str = "kit";

macro_rules! kit_file {
    ($path:literal) => {
        (
            $path,
            include_str!(concat!("../../../src/smart-kit/", $path)),
        )
    };
}

/// Every kit file, by its path below the kit's folder.
pub const FILES: &[(&str, &str)] = &[
    kit_file!("kit.css"),
    kit_file!("kit-visual.css"),
    kit_file!("kit.js"),
    kit_file!("lib/dom.js"),
    kit_file!("lib/dates.js"),
    kit_file!("lib/format.js"),
    kit_file!("lib/keys.js"),
    kit_file!("components/countdown.js"),
    kit_file!("components/gallery.js"),
    kit_file!("components/table.js"),
    kit_file!("components/stat.js"),
    kit_file!("components/legend.js"),
    kit_file!("components/charts.js"),
    kit_file!("components/timeline.js"),
    kit_file!("components/kanban.js"),
    kit_file!("components/calendar.js"),
    kit_file!("components/map.js"),
    kit_file!("data/world-110m.js"),
];

/// A kit file's text, when `version` is the one served and `rel` names a
/// file of the kit exactly.
pub fn file(version: &str, rel: &str) -> Option<&'static str> {
    if version != VERSION {
        return None;
    }
    FILES
        .iter()
        .find(|(path, _)| *path == rel)
        .map(|(_, text)| *text)
}
