//! Kasten Slides' PowerPoint exporter: a deck in, the bytes of a `.pptx` out.
//!
//! The file is made of native objects (text boxes, shapes, lines and
//! connectors, pictures, groups and tables) so it stays editable, and every
//! position, size, colour, font and paragraph is spelled out so it looks the
//! way the editor drew it in PowerPoint, LibreOffice, Keynote and Google Slides.
//! Nothing here touches the disk, the clock or threads: the library takes bytes
//! in and gives bytes out, and the same deck and pictures give the same bytes.

mod allow;
mod b64;
mod backing;
mod color;
mod cx;
mod elements;
mod error;
mod fonts;
pub mod import;
mod kept;
mod layouts;
mod markers;
mod master;
mod media;
mod notes;
mod package;
mod presentation;
mod props;
mod rawpart;
mod rels;
#[cfg(test)]
#[path = "../tests/common/samples.rs"]
mod samples;
mod slide;
mod steps;
mod style;
#[cfg(test)]
mod testing;
mod text;
mod theme;
mod units;
mod xml;

use slides_core::{Deck, Layout};

use cx::{Cx, Shared};
use package::Package;
use rels::Rels;

pub use cx::Warning;
pub use error::Error;
pub use media::Media;
pub use steps::{Page, StepsMode, pages};

/// What to put in the file.
#[derive(Clone, Debug, PartialEq)]
pub struct Options {
    /// Write the speaker notes.
    pub notes: bool,
    /// Keep hidden slides, still hidden in the file. When false, hidden slides
    /// and backup slides (which are written hidden) are left out.
    pub include_hidden: bool,
    /// What a slide with steps becomes: a slide for each state, or just the last.
    pub steps: StepsMode,
    /// End each slide's notes with a line that names the slide (`[kasten s-1a2b]`), so an
    /// import can tell which slide of a deck each page is. Needs `notes`.
    pub markers: bool,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            notes: true,
            include_hidden: true,
            steps: StepsMode::Expand,
            markers: true,
        }
    }
}

/// The file, and what could not be written exactly.
#[derive(Clone, Debug, PartialEq)]
pub struct Exported {
    pub bytes: Vec<u8>,
    pub warnings: Vec<Warning>,
}

/// PowerPoint's limits on a slide's size, in slide units (one inch to fifty-six).
const SIZE_RANGE: std::ops::RangeInclusive<f64> = 96.0..=5376.0;

fn check(deck: &Deck) -> Result<(), Error> {
    let (w, h) = (deck.size.w, deck.size.h);
    if SIZE_RANGE.contains(&w) && SIZE_RANGE.contains(&h) {
        Ok(())
    } else {
        Err(Error::Invalid(format!(
            "the slide is {w} by {h} units; PowerPoint needs both between 96 (one inch) and 5376 (fifty-six)"
        )))
    }
}

/// Runs `write` with a context for one part, and gives back what it wrote and its relationships.
fn part<'a, 'm, R>(
    deck: &'a Deck,
    shared: &'a mut Shared<'m>,
    write: impl FnOnce(&mut Cx<'a, 'm>) -> R,
) -> (R, Rels) {
    let mut cx = Cx::new(deck, shared);
    let out = write(&mut cx);
    (out, cx.rels)
}

/// The layouts of the theme; a theme with none gets a blank one, so every slide has somewhere to stand.
fn layouts_of(deck: &Deck) -> Vec<Layout> {
    if deck.theme.layouts.is_empty() {
        vec![Layout {
            name: "blank".to_owned(),
            label: "Blank".to_owned(),
            placeholders: Vec::new(),
            hide_master: false,
            elements: Vec::new(),
            background: None,
            extra: slides_core::Extra::new(),
        }]
    } else {
        deck.theme.layouts.clone()
    }
}

/// Exports the deck as a PowerPoint file. Pictures are read from `media` by the
/// path a deck names; one that cannot be read is a grey box and a warning, never a failure.
/// A citation is written with its keys as they are; see [`export_with`].
pub fn export(deck: &Deck, media: &dyn Media, options: &Options) -> Result<Exported, Error> {
    export_with(deck, media, options, None)
}

/// The same, with the bibliography that the deck's citations are written from, so the file
/// says `Vaswani et al., 2017 (NeurIPS)` where the editor does.
pub fn export_with(
    deck: &Deck,
    media: &dyn Media,
    options: &Options,
    refs: Option<&slides_core::citations::Refs>,
) -> Result<Exported, Error> {
    check(deck)?;
    // Composites (code, math, a chat ...) are written as the primitives they are drawn with.
    let expanded = slides_core::composites::expand_deck_with(deck, refs);
    let deck = &expanded;
    let pages = pages(deck, options);
    let layouts = layouts_of(deck);
    let mut shared = Shared::new(media);
    for (n, page) in pages.iter().enumerate() {
        let slide = &deck.slides[page.slide];
        // A link to a slide lands on the first page written for it.
        shared
            .slide_parts
            .entry(slide.id.clone())
            .or_insert_with(|| format!("slide{}.xml", n + 1));
        if slide.steps > slides_core::ops::MOST_STEPS {
            shared.warnings.push(Warning {
                slide: Some(slide.id.clone()),
                element: None,
                message: format!(
                    "the slide has {} steps and a slide can have {}; only the first {} are written",
                    slide.steps,
                    slides_core::ops::MOST_STEPS,
                    slides_core::ops::MOST_STEPS
                ),
            });
        }
    }
    let mut package = Package::new();

    // The master and layouts come first, so the pictures they use are numbered first.
    let (master_xml, master_rels) = part(deck, &mut shared, |cx| master::write(cx, layouts.len()));
    let mut layout_parts = Vec::new();
    for layout in &layouts {
        layout_parts.push(part(deck, &mut shared, |cx| layouts::write(cx, layout)));
    }

    let mut slide_parts = Vec::new();
    let mut notes_parts = Vec::new();
    for (n, page) in pages.iter().enumerate() {
        let slide = &deck.slides[page.slide];
        let number = n + 1;
        let found = layouts.iter().position(|l| l.name == slide.layout);
        let (index, layout_name) = match found {
            Some(index) => (index, slide.layout.clone()),
            None => {
                shared.warnings.push(Warning {
                    slide: Some(slide.id.clone()),
                    element: None,
                    message: format!(
                        "the layout `{}` is not in the theme; the first layout stands in",
                        slide.layout
                    ),
                });
                (0, String::new())
            }
        };
        let notes = if options.notes {
            markers::stamp(
                steps::page_notes(slide, page, options.steps),
                slide,
                options.markers,
            )
        } else {
            Vec::new()
        };
        let shown = steps::page_slide(slide, page, options.steps);
        let has_notes = notes.iter().any(|p| !p.is_empty());
        let (xml, rels) = part(deck, &mut shared, |cx| {
            cx.slide = Some(slide.id.clone());
            cx.layout = layout_name;
            cx.number = number as u32;
            cx.step = page.step;
            cx.rels.add(
                rels::SLIDE_LAYOUT,
                &format!("../slideLayouts/slideLayout{}.xml", index + 1),
            );
            if has_notes {
                cx.rels.add(
                    rels::NOTES_SLIDE,
                    &format!("../notesSlides/notesSlide{number}.xml"),
                );
            }
            slide::write(cx, &shown, slide.hidden || slide.backup)
        });
        slide_parts.push((xml, rels));
        if has_notes {
            let (xml, rels) = part(deck, &mut shared, |cx| {
                cx.slide = Some(slide.id.clone());
                notes::write_slide(cx, &notes, &format!("slide{number}.xml"))
            });
            notes_parts.push((number, xml, rels));
        }
    }
    let with_notes = options.notes;

    // The presentation and the parts that hang from it.
    let mut presentation_rels = Rels::new();
    let master_id = presentation_rels.add(rels::SLIDE_MASTER, "slideMasters/slideMaster1.xml");
    let notes_master_id = with_notes
        .then(|| presentation_rels.add(rels::NOTES_MASTER, "notesMasters/notesMaster1.xml"));
    let slide_ids: Vec<String> = (1..=pages.len())
        .map(|n| presentation_rels.add(rels::SLIDE, &format!("slides/slide{n}.xml")))
        .collect();
    presentation_rels.add(rels::PRES_PROPS, "presProps.xml");
    presentation_rels.add(rels::VIEW_PROPS, "viewProps.xml");
    presentation_rels.add(rels::THEME, "theme/theme1.xml");
    presentation_rels.add(rels::TABLE_STYLES, "tableStyles.xml");

    let mut root = Rels::new();
    root.add(rels::OFFICE_DOCUMENT, "ppt/presentation.xml");
    root.add(rels::CORE_PROPERTIES, "docProps/core.xml");
    root.add(rels::EXTENDED_PROPERTIES, "docProps/app.xml");
    package.add_rels("", &root);
    package.add("docProps/core.xml", package::CT_CORE, props::core(deck));
    let counts = props::Counts {
        slides: pages.len(),
        notes: notes_parts.len(),
        hidden: pages
            .iter()
            .filter(|p| deck.slides[p.slide].hidden || deck.slides[p.slide].backup)
            .count(),
    };
    package.add(
        "docProps/app.xml",
        package::CT_APP,
        props::app(deck, &counts),
    );
    let refs = presentation::Refs {
        master: master_id,
        notes_master: notes_master_id,
        slides: slide_ids,
    };
    package.add(
        "ppt/presentation.xml",
        package::CT_PRESENTATION,
        presentation::write(deck, &pages, &refs),
    );
    package.add_rels("ppt/presentation.xml", &presentation_rels);
    package.add(
        "ppt/presProps.xml",
        package::CT_PRES_PROPS,
        props::pres_props(),
    );
    package.add(
        "ppt/viewProps.xml",
        package::CT_VIEW_PROPS,
        props::view_props(),
    );
    package.add(
        "ppt/tableStyles.xml",
        package::CT_TABLE_STYLES,
        props::table_styles(),
    );
    theme::add(&mut package, &deck.theme, "theme1.xml", &deck.theme.name);

    package.add(
        "ppt/slideMasters/slideMaster1.xml",
        package::CT_MASTER,
        master_xml,
    );
    package.add_rels("ppt/slideMasters/slideMaster1.xml", &master_rels);
    for (n, (xml, rels)) in layout_parts.into_iter().enumerate() {
        let name = format!("ppt/slideLayouts/slideLayout{}.xml", n + 1);
        package.add(&name, package::CT_LAYOUT, xml);
        package.add_rels(&name, &rels);
    }
    for (n, (xml, rels)) in slide_parts.into_iter().enumerate() {
        let name = format!("ppt/slides/slide{}.xml", n + 1);
        package.add(&name, package::CT_SLIDE, xml);
        package.add_rels(&name, &rels);
    }
    if with_notes {
        let (xml, rels) = part(deck, &mut shared, notes::write_master);
        package.add(
            "ppt/notesMasters/notesMaster1.xml",
            package::CT_NOTES_MASTER,
            xml,
        );
        package.add_rels("ppt/notesMasters/notesMaster1.xml", &rels);
        theme::add(
            &mut package,
            &deck.theme,
            "theme2.xml",
            &format!("{} Notes", deck.theme.name),
        );
    }
    for (number, xml, rels) in notes_parts {
        let name = format!("ppt/notesSlides/notesSlide{number}.xml");
        package.add(&name, package::CT_NOTES_SLIDE, xml);
        package.add_rels(&name, &rels);
    }

    let Shared {
        images,
        warnings,
        kept,
        ..
    } = shared;
    images.add_to(&mut package);
    kept.add_to(&mut package);
    Ok(Exported {
        bytes: package.finish()?,
        warnings: distinct(warnings),
    })
}

/// The warnings with any that repeat another left out, in the order they came.
fn distinct(warnings: Vec<Warning>) -> Vec<Warning> {
    let mut seen = std::collections::HashSet::with_capacity(warnings.len());
    warnings
        .into_iter()
        .filter(|warning| seen.insert(warning.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn warning(slide: &str, message: &str) -> Warning {
        Warning {
            slide: Some(slide.to_owned()),
            element: None,
            message: message.to_owned(),
        }
    }

    #[test]
    fn a_warning_that_repeats_another_is_told_once_in_the_order_it_came() {
        let all = vec![
            warning("s-1", "b"),
            warning("s-1", "a"),
            warning("s-1", "b"),
            warning("s-2", "b"),
            warning("s-1", "a"),
        ];
        assert_eq!(
            distinct(all),
            vec![
                warning("s-1", "b"),
                warning("s-1", "a"),
                warning("s-2", "b")
            ]
        );
    }

    #[test]
    fn a_great_many_warnings_are_sorted_out_at_once() {
        let many: Vec<Warning> = (0..200_000)
            .map(|n| warning("s-1", &format!("problem {}", n % 1000)))
            .collect();
        assert_eq!(distinct(many).len(), 1000);
    }
}
