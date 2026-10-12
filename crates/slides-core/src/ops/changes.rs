//! What an operation may touch (`Scope`), that part of the deck as it was
//! (`Snapshot`, which is how undo works), and what changed (`Changes`, which
//! is what a UI applies to its own copy).

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Deck, Present, Section, Size, Slide, Theme};

/// The slides, order, theme and details an operation may change or create.
#[derive(Clone, Debug, Default)]
pub struct Scope {
    pub slides: Vec<String>,
    /// Every slide, for an operation that goes through the whole deck.
    pub every_slide: bool,
    /// The list of slides changes: some are added, removed or moved.
    pub order: bool,
    pub theme: bool,
    /// The title, size, sections or present settings.
    pub meta: bool,
}

impl Scope {
    pub fn slide(id: &str) -> Scope {
        Scope {
            slides: vec![id.to_owned()],
            ..Scope::default()
        }
    }

    pub fn slides<'a>(ids: impl IntoIterator<Item = &'a String>) -> Scope {
        Scope {
            slides: ids.into_iter().cloned().collect(),
            ..Scope::default()
        }
    }

    pub fn with_order(mut self) -> Scope {
        self.order = true;
        self
    }

    pub fn with_meta(mut self) -> Scope {
        self.meta = true;
        self
    }

    pub fn everything() -> Scope {
        Scope {
            slides: Vec::new(),
            every_slide: true,
            order: true,
            theme: true,
            meta: true,
        }
    }
}

model! {
    /// The parts of a deck that are neither slides nor theme.
    #[serde(rename_all = "camelCase")]
    pub struct Meta {
        pub title: String,
        pub size: Size,
        pub sections: Vec<Section>,
        pub present: Present,
    }
}

impl Meta {
    fn of(deck: &Deck) -> Meta {
        Meta {
            title: deck.title.clone(),
            size: deck.size.clone(),
            sections: deck.sections.clone(),
            present: deck.present.clone(),
        }
    }
}

/// A part of a deck as it was, to put back.
#[derive(Clone, Debug)]
pub struct Snapshot {
    /// Each named slide, or `None` where it did not exist.
    slides: Vec<(String, Option<Slide>)>,
    order: Option<Vec<String>>,
    theme: Option<Theme>,
    meta: Option<Meta>,
}

impl Snapshot {
    pub fn of(deck: &Deck, scope: &Scope) -> Snapshot {
        let slides = if scope.every_slide {
            deck.slides
                .iter()
                .map(|s| (s.id.clone(), Some(s.clone())))
                .collect()
        } else {
            scope
                .slides
                .iter()
                .map(|id| (id.clone(), deck.slide(id).cloned()))
                .collect()
        };
        let ordered = scope.order || scope.every_slide;
        Snapshot {
            slides,
            order: ordered.then(|| deck.slides.iter().map(|s| s.id.clone()).collect()),
            theme: scope.theme.then(|| deck.theme.clone()),
            meta: scope.meta.then(|| Meta::of(deck)),
        }
    }

    /// Whether the snapshot's list of slides has `id`.
    pub fn lists(&self, id: &str) -> bool {
        self.order
            .as_ref()
            .is_some_and(|order| order.iter().any(|o| o == id))
    }

    /// The slides the snapshot holds, as they were: `None` where a slide did not exist.
    pub(crate) fn slides_before(&self) -> impl Iterator<Item = (&str, Option<&Slide>)> {
        self.slides
            .iter()
            .map(|(id, slide)| (id.as_str(), slide.as_ref()))
    }

    /// Whether this snapshot already holds everything `other` would put back:
    /// each slide `other` names, and the order, theme and details if it has them.
    pub(crate) fn covers(&self, other: &Snapshot) -> bool {
        other
            .slides
            .iter()
            .all(|(id, _)| self.slides.iter().any(|(mine, _)| mine == id))
            && (other.order.is_none() || self.order.is_some())
            && (other.theme.is_none() || self.theme.is_some())
            && (other.meta.is_none() || self.meta.is_some())
    }

    /// The scope this snapshot was taken of.
    pub fn scope(&self) -> Scope {
        Scope {
            slides: self.slides.iter().map(|(id, _)| id.clone()).collect(),
            every_slide: false,
            order: self.order.is_some(),
            theme: self.theme.is_some(),
            meta: self.meta.is_some(),
        }
    }

    /// Puts the deck's part back as it was, and leaves out slides that did not exist then.
    pub fn restore(self, deck: &mut Deck) {
        for (id, slide) in self.slides {
            match (slide, deck.index_of(&id)) {
                (Some(slide), Some(i)) => deck.slides[i] = slide,
                (Some(slide), None) => deck.slides.push(slide),
                (None, Some(i)) => {
                    deck.slides.remove(i);
                }
                (None, None) => {}
            }
        }
        if let Some(order) = self.order {
            let mut rest = std::mem::take(&mut deck.slides);
            deck.slides = order
                .iter()
                .filter_map(|id| {
                    rest.iter()
                        .position(|s| &s.id == id)
                        .map(|i| rest.remove(i))
                })
                .collect();
        }
        if let Some(theme) = self.theme {
            deck.theme = theme;
        }
        if let Some(meta) = self.meta {
            deck.title = meta.title;
            deck.size = meta.size;
            deck.sections = meta.sections;
            deck.present = meta.present;
        }
    }

    /// What differs between this snapshot and the deck now.
    pub fn changes(&self, deck: &Deck) -> Changes {
        let mut changes = Changes::default();
        let now_order: Vec<String> = deck.slides.iter().map(|s| s.id.clone()).collect();
        for (id, old) in &self.slides {
            let now = deck.slide(id);
            if now != old.as_ref() {
                changes.slides.insert(id.clone(), now.cloned());
            }
        }
        if let Some(order) = &self.order {
            // A slide the operation created was not in the snapshot's list.
            for slide in &deck.slides {
                if !order.contains(&slide.id) && !changes.slides.contains_key(&slide.id) {
                    changes.slides.insert(slide.id.clone(), Some(slide.clone()));
                }
            }
            for id in order {
                if deck.slide(id).is_none() && !changes.slides.contains_key(id) {
                    changes.slides.insert(id.clone(), None);
                }
            }
            if order != &now_order {
                changes.order = Some(now_order);
            }
        }
        if let Some(theme) = &self.theme
            && theme != &deck.theme
        {
            changes.theme = Some(deck.theme.clone());
        }
        if let Some(meta) = &self.meta {
            let now = Meta::of(deck);
            if meta != &now {
                changes.meta = Some(now);
            }
        }
        changes
    }
}

model! {
    /// What changed, for a UI to apply to its own copy of the deck.
    #[derive(Default)]
    #[serde(rename_all = "camelCase")]
    pub struct Changes {
        /// The slides that changed or are new, and `null` for one that is gone.
        pub slides: BTreeMap<String, Option<Slide>>,
        /// The ids of the slides in order, when the list changed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub order: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub theme: Option<Theme>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub meta: Option<Meta>,
    }
}

impl Changes {
    /// Brings a copy of the deck from before the change up to date with it,
    /// which is what a UI holding its own copy does.
    pub fn apply_to(&self, deck: &mut Deck) {
        for (id, slide) in &self.slides {
            match (slide, deck.index_of(id)) {
                (Some(slide), Some(i)) => deck.slides[i] = slide.clone(),
                (Some(slide), None) => deck.slides.push(slide.clone()),
                (None, Some(i)) => {
                    deck.slides.remove(i);
                }
                (None, None) => {}
            }
        }
        if let Some(order) = &self.order {
            let mut rest = std::mem::take(&mut deck.slides);
            deck.slides = order
                .iter()
                .filter_map(|id| {
                    rest.iter()
                        .position(|s| &s.id == id)
                        .map(|i| rest.remove(i))
                })
                .collect();
        }
        if let Some(theme) = &self.theme {
            deck.theme = theme.clone();
        }
        if let Some(meta) = &self.meta {
            deck.title = meta.title.clone();
            deck.size = meta.size.clone();
            deck.sections = meta.sections.clone();
            deck.present = meta.present.clone();
        }
    }

    pub fn is_empty(&self) -> bool {
        self == &Changes::default()
    }

    /// This, and then `later`, as one.
    pub fn then(mut self, later: Changes) -> Changes {
        self.slides.extend(later.slides);
        self.order = later.order.or(self.order);
        self.theme = later.theme.or(self.theme);
        self.meta = later.meta.or(self.meta);
        self
    }
}
