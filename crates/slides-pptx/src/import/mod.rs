//! Reading a PowerPoint file into a deck.
//!
//! A file made by this crate's exporter comes back as the deck it was made
//! from, to within half a slide unit; a file from PowerPoint, LibreOffice or
//! python-pptx comes back as near to what it shows as a deck can be, with
//! everything a deck cannot hold kept as `raw` or listed in the report. A
//! hostile file cannot make the import panic, read past its limits or fetch
//! anything.

mod adapt;
mod color;
mod cx;
pub(crate) mod dom;
mod master;
mod media;
mod merge;
mod notes;
mod package;
mod plan;
mod presentation;
mod preview;
mod report;
mod shapes;
mod slide;
mod styles;
mod tablestyle;
#[cfg(test)]
mod testing;
mod text;
mod theme;
mod themefile;
mod units;

use std::collections::HashMap;

use slides_core::ids::{DECK, SLIDE};
use slides_core::{Deck, Extra, FORMAT_NAME, Present, Section, Size};

use color::{ColorCx, ColorMap};
use cx::{Env, Importer};
use package::Package;
use tablestyle::TableStyles;

pub use media::MediaFile;
pub use merge::{Merged, merge_version, merge_with_report};
pub use package::Limits;
pub use plan::{Mode, Plan, plan_import};
pub use preview::crop_preview;
pub use report::{ImportReport, RawNote, Warning};
pub use slides_core::ops::similar_runs;

/// Why a file could not be imported at all. Anything less than that is a warning.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImportError {
    /// Not a zip file, or a zip file that is not a presentation.
    NotAPresentation(String),
    /// An older or protected file this reader cannot open.
    Unsupported(String),
    /// A limit on what one file may hold was passed.
    TooLarge(String),
    /// The presentation is there but its main part cannot be read.
    Damaged(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportError::NotAPresentation(m)
            | ImportError::Unsupported(m)
            | ImportError::TooLarge(m)
            | ImportError::Damaged(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for ImportError {}

/// How to import.
#[derive(Clone, Debug)]
pub struct ImportOptions {
    /// Starts the ids of everything made: the same file and seed give the same deck.
    pub seed: u64,
    /// The deck's title, asked for by the person: it wins over anything the file says.
    pub title: Option<String>,
    /// What to call the deck when the file gives no title of its own (usually the file's name).
    pub name: Option<String>,
    /// Keep, on each slide, the marker its notes carried (`extra.pptxMarker`), which a merge
    /// into an existing deck matches slides by.
    pub markers: bool,
    pub limits: Limits,
}

impl Default for ImportOptions {
    fn default() -> ImportOptions {
        ImportOptions {
            seed: 1,
            title: None,
            name: None,
            markers: false,
            limits: Limits::default(),
        }
    }
}

/// A deck made from a file, the pictures it names and what to tell the person.
#[derive(Clone, Debug)]
pub struct Imported {
    pub deck: Deck,
    /// The pictures, by the paths the deck names them with.
    pub media: Vec<MediaFile>,
    pub report: ImportReport,
}

/// The slide size PowerPoint accepts, in slide units.
const SIZE_RANGE: std::ops::RangeInclusive<f64> = 96.0..=5376.0;

fn find<'a>(node: &'a dom::Node, name: &str) -> Option<&'a dom::Node> {
    if node.name == name {
        return Some(node);
    }
    node.elements().find_map(|n| find(n, name))
}

/// The title the file gives itself, if it does.
fn core_title(pkg: &mut Package) -> Option<String> {
    let doc = pkg.dom("docProps/core.xml").ok()?;
    let title = find(&doc.root, "dc:title")?.text();
    let title = title.trim();
    (!title.is_empty() && !is_stock_title(title)).then(|| title.to_owned())
}

/// The titles a program gives a file whose author gave it none.
fn is_stock_title(title: &str) -> bool {
    let lower = title.to_lowercase();
    let bare = lower.trim_end_matches(|c: char| c.is_ascii_digit()).trim();
    matches!(
        bare,
        "powerpoint presentation" | "presentation" | "untitled" | "untitled presentation" | "slide"
    )
}

/// The text of the first slide's title, for a deck whose file names none.
fn first_title(deck: &Deck) -> Option<String> {
    let slide = deck.slides.first()?;
    let el = slide
        .elements
        .iter()
        .find(|e| e.base().placeholder.as_deref() == Some("title"))?;
    let text = el.text()?.plain_text();
    let text = text.trim();
    (!text.is_empty()).then(|| text.lines().next().unwrap_or(text).to_owned())
}

/// Reads the masters and their layouts. The first master's colour mapping is the deck's.
fn read_masters(
    imp: &mut Importer,
    parts: &[String],
) -> (Vec<master::MasterInfo>, Vec<master::LayoutInfo>, ColorMap) {
    let mut masters: Vec<master::MasterInfo> = Vec::new();
    let mut deck_map: Option<ColorMap> = None;
    for part in parts {
        match master::read_master(&mut imp.pkg, part, deck_map.as_ref()) {
            Some(m) => {
                deck_map.get_or_insert_with(|| m.map.clone());
                masters.push(m);
            }
            None => imp.warnings.warn(
                None,
                None,
                format!("the slide master `{part}` could not be read"),
            ),
        }
    }
    if masters.is_empty() {
        imp.warnings.warn(
            None,
            None,
            "the file has no readable slide master; plain defaults are used",
        );
        masters.push(master::MasterInfo::plain());
    }
    let deck_map = deck_map.unwrap_or_default();
    let mut layouts = Vec::new();
    for (at, m) in masters.iter().enumerate() {
        for part in &m.layouts {
            match master::read_layout(&mut imp.pkg, part, at, m, &deck_map) {
                Some(l) => layouts.push(l),
                None => {
                    imp.warnings
                        .warn(None, None, format!("the layout `{part}` could not be read"))
                }
            }
        }
    }
    (masters, layouts, deck_map)
}

/// Imports a `.pptx` file.
pub fn import(bytes: &[u8], options: &ImportOptions) -> Result<Imported, ImportError> {
    let pkg = Package::open(bytes, options.limits)?;
    let mut imp = Importer::new(pkg, options.seed);
    for name in std::mem::take(&mut imp.pkg.ignored) {
        imp.warnings.warn(
            None,
            None,
            format!("the entry `{name}` names a place outside the file and was ignored"),
        );
    }
    let pres = presentation::read(&mut imp.pkg)?;

    let (mut w, mut h) = pres.size.unwrap_or((
        slides_core::units::SLIDE_WIDTH,
        slides_core::units::SLIDE_HEIGHT,
    ));
    if pres.size.is_none() {
        imp.warnings
            .warn(None, None, "the file gives no slide size; 16:9 is used");
    }
    if !SIZE_RANGE.contains(&w) || !SIZE_RANGE.contains(&h) {
        imp.warnings.warn(
            None,
            None,
            format!("the slide size {w} by {h} units was held between 96 and 5376"),
        );
        w = w.clamp(*SIZE_RANGE.start(), *SIZE_RANGE.end());
        h = h.clamp(*SIZE_RANGE.start(), *SIZE_RANGE.end());
    }

    let (masters, mut layouts, deck_map) = read_masters(&mut imp, &pres.masters);
    let first = &masters[0];
    let fonts = master::font_names(&first.theme);
    let default_text = {
        let cx = ColorCx {
            palette: &first.theme.palette,
            map: &first.map,
            deck_map: &deck_map,
        };
        let reader = text::levels::Reader {
            colors: cx,
            fonts: &fonts,
        };
        pres.default_text
            .as_ref()
            .map(|n| text::levels::list_style(n, &reader, None))
            .unwrap_or_else(text::levels::Levels::empty)
    };
    let built = theme::build(&masters, &mut layouts, &default_text, (w, h));

    let slide_parts: Vec<String> = pres.slides.iter().map(|s| s.part.clone()).collect();
    let slide_ids: HashMap<String, String> = slide_parts
        .iter()
        .map(|part| (part.clone(), imp.id(SLIDE)))
        .collect();
    let layout_index = layouts
        .iter()
        .enumerate()
        .map(|(i, l)| (l.part.clone(), i))
        .collect();
    let env = Env {
        theme: first.theme.clone(),
        deck_map,
        fonts,
        styles: built.styles,
        masters: masters.clone(),
        layouts,
        layout_names: built.names,
        layout_index,
        slide_ids,
        slide_parts: slide_parts.clone(),
        default_text,
        table_styles: TableStyles::read(&mut imp.pkg),
    };

    let mut theme = built.theme;
    theme.master = slide::master_elements(&mut imp, &env);
    // What a layout draws is the layout's own, once; a slide keeps only its own shapes.
    for (layout, elements) in theme
        .layouts
        .iter_mut()
        .zip(slide::layout_decorations(&mut imp, &env))
    {
        layout.elements = elements;
    }

    let mut slides = Vec::new();
    for part in &slide_parts {
        let id = env.slide_ids.get(part).cloned().unwrap_or_default();
        slides.push(slide::convert(&mut imp, &env, part, &id, options.markers));
    }
    if slides.is_empty() {
        imp.warnings.warn(
            None,
            None,
            "the file has no slides; one empty slide was made",
        );
        let layout = env
            .layout_names
            .first()
            .cloned()
            .unwrap_or_else(|| "blank".to_owned());
        slides.push(slides_core::Slide::new(imp.id(SLIDE), layout));
    }
    if let Some(first) = slides.first_mut()
        && first.backup
    {
        first.backup = false;
        first.hidden = true;
    }

    let numbers = presentation::numbers(&pres.slides);
    let mut sections = Vec::new();
    for (name, members) in &pres.sections {
        let start = members.iter().filter_map(|n| numbers.get(n)).min();
        if let Some(slide) = start.and_then(|i| slides.get(*i))
            && !sections.iter().any(|s: &Section| s.starts_at == slide.id)
        {
            sections.push(Section {
                title: name.clone(),
                starts_at: slide.id.clone(),
                extra: Extra::new(),
            });
        }
    }

    let mut deck = Deck {
        format: FORMAT_NAME.to_owned(),
        format_version: slides_core::FORMAT_VERSION,
        id: imp.id(DECK),
        title: String::new(),
        size: Size {
            w,
            h,
            extra: Extra::new(),
        },
        theme,
        slides,
        sections,
        present: Present::default(),
        extra: Extra::new(),
    };
    deck.title = options
        .title
        .clone()
        .filter(|t| !t.trim().is_empty())
        .or_else(|| core_title(&mut imp.pkg))
        .or_else(|| options.name.clone().filter(|t| !t.trim().is_empty()))
        .or_else(|| first_title(&deck))
        .unwrap_or_else(|| "Imported presentation".to_owned());
    slides_core::canonical::check_structure(&deck).map_err(|e| {
        ImportError::Damaged(format!("the imported deck broke a rule of the format: {e}"))
    })?;

    let hidden = deck.slides.iter().filter(|s| s.hidden).count();
    let pictures = imp.media.len();
    let (warnings, raw) = std::mem::take(&mut imp.warnings).finish();
    let media = std::mem::take(&mut imp.media).into_files();
    Ok(Imported {
        report: ImportReport {
            slides: deck.slides.len(),
            hidden,
            pictures,
            raw,
            warnings,
        },
        deck,
        media,
    })
}

#[cfg(test)]
mod tests;
