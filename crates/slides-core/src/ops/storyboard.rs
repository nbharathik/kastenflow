//! A storyboard made into slides, and a person's choice to keep their own slide when the page has moved on.
//!
//! A storyboard is a list of [`StoryEntry`]s drafted from a page (see `page::storyboard`), reordered, merged, split and rewritten by a
//! person. `add_storyboard_slides` turns it into slides in one step: a title and, when there is anything to show, one element with the
//! entry's point and evidence, which remembers the section of the page it came from and what it said when it was made.

use std::collections::{BTreeMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::composites::follow_content;
use super::layout::{layout_names, placeholder_element};
use super::pages::{assemble, name_of, room_for};
use super::util::{assign_ids, element_mut, slide_mut};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::{ELEMENT, SLIDE};
use crate::model::{Deck, Element, PageSource, Paragraph, Run, Slide, SourceKind, Text, TextFit};
use crate::page::{self, Sizes, StoryEntry};

/// The most slides one storyboard makes.
const MOST_ENTRIES: usize = 200;

op_types! {
    /// Makes slides from a storyboard: one for each entry.
    pub struct AddStoryboardSlides {
        /// The slides to make, in order.
        pub entries: Vec<StoryEntry>,
        /// The slide to add them after (and its backup slides); the end when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub after: Option<String>,
        /// The size in pixels of each picture the entries show, by its path, so pictures keep their shape.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        pub sizes: Sizes,
    }

    /// Something a storyboard asked for that the slides do not have, or a slide that is not kept in step with its page.
    pub struct Omitted {
        /// The entry, counting from 0.
        pub entry: usize,
        /// What: `picture` (one that is not in the host's store), `title` (the layout has no title slot), `source` (a section merged into the slide that is not remembered), `update` (the slide is not kept in step with the page).
        pub what: String,
        /// Why, in a sentence a person can read.
        pub reason: String,
    }

    pub struct AddedStoryboard {
        /// The new slides, in order.
        pub slides: Vec<String>,
        /// What was left out or is not kept in step, for the report.
        pub omitted: Vec<Omitted>,
    }
}

/// The page source an entry's words carry: the first section it came from, with the fingerprint of the Markdown that was read.
fn source_of(entry: &StoryEntry) -> Option<PageSource> {
    let first = entry.sources.first()?;
    let section = first.section.clone().filter(|s| !s.trim().is_empty());
    let tracked = section.is_some();
    let mut source = PageSource::new(
        first.page.clone(),
        if tracked {
            SourceKind::Section
        } else {
            SourceKind::Contents
        },
    );
    source.id = first.id.clone();
    source.title = first.title.clone();
    source.section = section;
    // Kept in step only while it still says what its one section says.
    source.sync = tracked && page::is_as_drafted(entry);
    source.hash = Some(page::fingerprint(&first.markdown));
    Some(source)
}

/// What a person calls the section a source came from.
fn called(source: &page::StorySource) -> String {
    source
        .section
        .as_deref()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .or_else(|| source.title.clone())
        .unwrap_or_else(|| source.page.clone())
}

impl Op for AddStoryboardSlides {
    type Output = AddedStoryboard;
    const NAME: &'static str = "add_storyboard_slides";
    const ABOUT: &'static str = "Make slides from a storyboard drafted from a page of the host: for each entry a slide titled with the entry's title, the point and evidence as its words (one element, with its pictures, tables and code beside them), and the notes as the speaker notes. The words remember the section of the page they came from, so they can be brought up to date when the page changes. Pictures that are not in the host's store are left out and listed.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::default().with_order()
    }

    fn run(self, cx: &mut Cx) -> Result<AddedStoryboard> {
        if self.entries.is_empty() {
            return Err(Error::bad_input(
                Self::NAME,
                "the storyboard has no entries",
            ));
        }
        if self.entries.len() > MOST_ENTRIES {
            return Err(Error::bad_input(
                Self::NAME,
                format!("a storyboard makes at most {MOST_ENTRIES} slides at a time"),
            ));
        }
        // Every layout is found before anything is made, so a wrong name changes nothing.
        let mut layouts = Vec::with_capacity(self.entries.len());
        for entry in &self.entries {
            let (blocks, _) = page::body_blocks(entry);
            let name = entry
                .layout
                .as_deref()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .unwrap_or(if blocks.is_empty() {
                    "section"
                } else {
                    "title-body"
                });
            let layout = cx.deck.theme.layout(name).cloned().ok_or_else(|| {
                Error::bad_input(
                    Self::NAME,
                    format!(
                        "the theme has no layout `{name}`; it has: {}",
                        layout_names(cx.deck)
                    ),
                )
            })?;
            layouts.push(layout);
        }
        let mut at = match &self.after {
            Some(id) => {
                let i = cx.deck.index_of(id).ok_or_else(|| Error::no_slide(id))?;
                let mut next = i + 1;
                while cx.deck.slides.get(next).is_some_and(|s| s.backup) {
                    next += 1;
                }
                next
            }
            None => cx.deck.slides.len(),
        };
        let mut taken: HashSet<String> = cx.deck.slides.iter().map(|s| s.id.clone()).collect();
        let mut made = Vec::with_capacity(self.entries.len());
        let mut omitted = Vec::new();
        for (n, (entry, layout)) in self.entries.iter().zip(&layouts).enumerate() {
            let id = cx.ids.fresh(SLIDE, |c| taken.contains(c));
            taken.insert(id.clone());
            let mut slide = Slide::new(id.clone(), layout.name.clone());
            slide.notes = entry.notes.clone().unwrap_or_default();
            let mut used = HashSet::new();

            // The title: the layout's own slot, so the slide follows its layout.
            let title = Some(entry.title.trim())
                .filter(|t| !t.is_empty())
                .unwrap_or("Untitled");
            match layout.placeholder("title") {
                Some(def) => {
                    let eid = cx.ids.fresh(ELEMENT, |c| used.contains(c));
                    used.insert(eid.clone());
                    let mut element = placeholder_element(def, eid, None);
                    if let Element::Text(t) = &mut element {
                        t.text = Text {
                            fit: Some(TextFit::Shrink),
                            ..Text::from_paragraphs(vec![Paragraph {
                                runs: vec![Run::plain(title)],
                                ..Paragraph::plain("")
                            }])
                        };
                    }
                    slide.elements.push(element);
                }
                None => omitted.push(Omitted {
                    entry: n,
                    what: "title".to_owned(),
                    reason: format!(
                        "The layout “{}” has no title slot, so “{title}” is not on the slide.",
                        layout.label
                    ),
                }),
            }

            // The words and what goes with them, as one element that remembers its page.
            let (blocks, left_out) = page::body_blocks(entry);
            for src in left_out {
                omitted.push(Omitted {
                    entry: n,
                    what: "picture".to_owned(),
                    reason: format!("The picture {src} is on the web, and a deck keeps only pictures from the host's store."),
                });
            }
            let area = room_for(&cx.deck.size, &cx.deck.theme, &slide);
            let parts = page::contents(&blocks, area, &self.sizes);
            if !parts.is_empty() {
                let source = source_of(entry);
                let name = source
                    .as_ref()
                    .map_or_else(|| "Slide contents".to_owned(), name_of);
                let mut top = vec![assemble(parts, source, name)];
                assign_ids(&mut top, &mut used, cx.ids, true);
                let mut element = top.remove(0);
                let fingerprint = page::made_of(&element);
                if let Some(source) = element.base_mut().source.as_mut() {
                    source.made = Some(fingerprint);
                }
                slide.elements.push(element);
                follow_content(&mut slide);
            }

            if let [first, rest @ ..] = entry.sources.as_slice() {
                for other in rest {
                    omitted.push(Omitted {
                        entry: n,
                        what: "source".to_owned(),
                        reason: format!(
                            "“{}” was merged into a slide that remembers only “{}”, so it is not kept in step with the page. Check it by hand.",
                            called(other),
                            called(first)
                        ),
                    });
                }
                if rest.is_empty() && first.section.is_some() && !page::is_as_drafted(entry) {
                    omitted.push(Omitted {
                        entry: n,
                        what: "update".to_owned(),
                        reason: format!(
                            "Its words were changed in the storyboard, so it is not kept in step with “{}”. Change it by hand when the page changes.",
                            called(first)
                        ),
                    });
                }
            }

            cx.deck.slides.insert(at, slide);
            at += 1;
            made.push(id);
        }
        if let Some(first) = cx.deck.slides.first_mut() {
            first.backup = false;
        }
        Ok(AddedStoryboard {
            slides: made,
            omitted,
        })
    }
}

op_types! {
    /// Keeps a slide as it is when its page has changed: the fingerprint of the page's words is set to the page as it reads now.
    pub struct AcknowledgeSource {
        pub slide: String,
        /// The element that came from the page.
        pub id: String,
        /// The page's Markdown, or the section's, as the host reads it now.
        pub markdown: String,
    }

    pub struct Acknowledged {
        /// The new fingerprint.
        pub hash: String,
    }
}

impl Op for AcknowledgeSource {
    type Output = Acknowledged;
    const NAME: &'static str = "acknowledge_source";
    const ABOUT: &'static str = "Keep an element that came from a page of the host as it is after the page changed: the page is read as it is now and nothing on the slide is touched, so the element is not offered an update until the page changes again.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<Acknowledged> {
        let slide = slide_mut(cx.deck, &self.slide)?;
        let element = element_mut(slide, &self.id)?;
        let Some(source) = element.base_mut().source.as_mut() else {
            return Err(Error::refused(format!(
                "`{}` did not come from a page, so there is no page to keep it against.",
                self.id
            )));
        };
        let hash = page::fingerprint(&self.markdown);
        source.hash = Some(hash.clone());
        Ok(Acknowledged { hash })
    }
}
