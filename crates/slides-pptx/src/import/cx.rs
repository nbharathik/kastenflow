//! What the readers of a slide, layout or master share: the file being read
//! (`Importer`), what is known of the whole deck (`Env`), the part in hand
//! (`PartCx`) and the shapes converted so far (`Cx`).

use std::collections::{HashMap, HashSet};

use slides_core::ids::{ELEMENT, IdGen};

use super::color::{ColorCx, ColorMap};
use super::master::{LayoutInfo, MasterInfo};
use super::media::MediaStore;
use super::package::{Package, Rels};
use super::report::Collector;
use super::shapes::frame::GroupXf;
use super::styles::StyleBook;
use super::tablestyle::TableStyles;
use super::text::levels::{FontNames, Levels, Reader};
use super::themefile::ThemeFile;

/// The file being read, and what is made of it so far.
pub struct Importer<'a> {
    pub pkg: Package<'a>,
    pub warnings: Collector,
    pub ids: IdGen,
    taken: HashSet<String>,
    pub media: MediaStore,
    /// Bytes of parts kept inside raw elements so far.
    pub raw_bytes: usize,
    /// Read the charts a deck can hold (bars, lines, pies) as charts of the deck, not as kept objects.
    pub native_charts: bool,
}

impl<'a> Importer<'a> {
    pub fn new(pkg: Package<'a>, seed: u64) -> Importer<'a> {
        Importer {
            pkg,
            warnings: Collector::default(),
            ids: IdGen::new(seed),
            taken: HashSet::new(),
            media: MediaStore::default(),
            raw_bytes: 0,
            native_charts: false,
        }
    }

    /// An element id no other element of the import has.
    pub fn element_id(&mut self) -> String {
        let taken = &self.taken;
        let id = self.ids.fresh(ELEMENT, |c| taken.contains(c));
        self.taken.insert(id.clone());
        id
    }

    pub fn id(&mut self, prefix: &str) -> String {
        self.ids.fresh(prefix, |_| false)
    }
}

/// What the whole deck is known to be, once its masters and layouts are read.
pub struct Env {
    pub theme: ThemeFile,
    /// The first master's colour mapping, whose meaning the deck's tokens have.
    pub deck_map: ColorMap,
    pub fonts: FontNames,
    pub styles: StyleBook,
    pub masters: Vec<MasterInfo>,
    pub layouts: Vec<LayoutInfo>,
    /// The name each layout has in the deck, index for index with `layouts`.
    pub layout_names: Vec<String>,
    pub layout_index: HashMap<String, usize>,
    /// The id each slide part has in the deck.
    pub slide_ids: HashMap<String, String>,
    /// The slide parts in the order of the presentation.
    pub slide_parts: Vec<String>,
    /// The presentation's default text style.
    pub default_text: Levels,
    /// The table styles the file defines.
    pub table_styles: TableStyles,
}

/// The part being read.
pub struct PartCx {
    pub name: String,
    pub rels: Rels,
    /// The namespace declarations the part's root made that have no fixed prefix, for XML kept from it.
    pub declarations: Vec<(String, String)>,
    pub map: ColorMap,
    /// The slide's id, for warnings; None for a layout or master.
    pub slide: Option<String>,
    /// The layout in force, as an index into `Env::layouts`.
    pub layout: Option<usize>,
    /// Whether the part is a master or layout, where placeholders are slots to fill.
    pub in_master: bool,
}

/// A connector waiting for the shapes it joins to have ids.
#[derive(Clone, Debug)]
pub struct Pending {
    pub element: String,
    pub start: Option<(i64, i64)>,
    pub end: Option<(i64, i64)>,
}

/// Everything a shape converter needs, and the shapes converted so far.
pub struct Cx<'x, 'a> {
    pub imp: &'x mut Importer<'a>,
    pub env: &'x Env,
    pub part: &'x PartCx,
    /// The groups being read, the outermost first.
    pub groups: Vec<GroupXf>,
    /// The element made for each shape number of the slide.
    pub shape_ids: HashMap<i64, String>,
    pub pending: Vec<Pending>,
    /// The element being converted, for warnings.
    pub element: Option<String>,
}

impl<'x, 'a> Cx<'x, 'a> {
    pub fn new(imp: &'x mut Importer<'a>, env: &'x Env, part: &'x PartCx) -> Cx<'x, 'a> {
        Cx {
            imp,
            env,
            part,
            groups: Vec::new(),
            shape_ids: HashMap::new(),
            pending: Vec::new(),
            element: None,
        }
    }

    pub fn colors(&self) -> ColorCx<'x> {
        ColorCx {
            palette: &self.env.theme.palette,
            map: &self.part.map,
            deck_map: &self.env.deck_map,
        }
    }

    pub fn reader(&self) -> Reader<'x> {
        Reader {
            colors: self.colors(),
            fonts: &self.env.fonts,
        }
    }

    pub fn warn(&mut self, message: impl Into<String>) {
        let slide = self.part.slide.clone();
        self.imp
            .warnings
            .warn(slide.as_deref(), self.element.as_deref(), message);
    }

    /// A warning about the slide, said once however many elements cause it.
    pub fn warn_slide(&mut self, message: impl Into<String>) {
        let slide = self.part.slide.clone();
        self.imp.warnings.warn(slide.as_deref(), None, message);
    }
}
