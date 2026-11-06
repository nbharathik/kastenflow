//! Slides with steps in the file. A PowerPoint animation does not survive a trip
//! through Google Slides or Keynote, so a slide with steps is written as one slide
//! for each state: the slide as it appears, and as it stands after each click. Each
//! of those is drawn as the editor draws that step.

use std::borrow::Cow;

use slides_core::ops::MOST_STEPS;
use slides_core::{Deck, Element, Run, Slide, Text};

use crate::{Options, notes};

/// What a slide with steps becomes in the file.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum StepsMode {
    /// One slide for each state, in order: the slide as it appears, then after each click.
    /// The title says which one it is, and the notes carry a marker with the same words.
    #[default]
    Expand,
    /// One slide, as it stands after the last click.
    Final,
    /// One slide with the clicks as PowerPoint animations (fade, fly, zoom, wipe, pulse and colour map; the
    /// rest are written as an appear). Dimmed and highlighted steps are not animated.
    Animate,
}

/// One slide of the file: a slide of the deck, and the step of it that is drawn.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Page {
    /// Its place in the deck.
    pub slide: usize,
    /// The state of the slide that is drawn: 0 is how it appears and each click is one more.
    pub step: Option<u32>,
}

/// How many clicks of a slide are written. A file made by hand can claim any number, and
/// no slide has more than the format allows.
pub fn clicks_of(slide: &Slide) -> u32 {
    slide.steps.min(MOST_STEPS)
}

/// The pages of the file, in order.
pub fn pages(deck: &Deck, options: &Options) -> Vec<Page> {
    let mut out = Vec::new();
    for (index, slide) in deck.slides.iter().enumerate() {
        if !options.include_hidden && (slide.hidden || slide.backup) {
            continue;
        }
        let clicks = clicks_of(slide);
        match options.steps {
            StepsMode::Expand => out.extend((0..=clicks).map(|step| Page {
                slide: index,
                step: Some(step),
            })),
            StepsMode::Final => out.push(Page {
                slide: index,
                step: Some(clicks),
            }),
            StepsMode::Animate => out.push(Page {
                slide: index,
                step: None,
            }),
        }
    }
    out
}

/// Whether a slide is written as more than one page.
fn is_expanded(slide: &Slide, mode: StepsMode) -> bool {
    mode == StepsMode::Expand && clicks_of(slide) > 0
}

/// Puts `suffix` after the last words of a title, in the look they have.
fn add_suffix(text: &mut Text, suffix: &str) {
    let last = text
        .paragraphs
        .iter_mut()
        .rev()
        .find(|paragraph| paragraph.runs.iter().any(|run| !run.t.is_empty()));
    let Some(paragraph) = last else {
        return;
    };
    let Some(words) = paragraph.runs.iter().rev().find(|run| !run.t.is_empty()) else {
        return;
    };
    let more = Run {
        t: suffix.to_owned(),
        link: None,
        code: false,
        math: false,
        field: None,
        ..words.clone()
    };
    paragraph.runs.push(more);
}

/// The slide as one of its pages draws it. On a page of a slide that is written as several,
/// the title says which: `Title (2/5)`. That is in the file only; the deck keeps its title.
pub fn page_slide<'a>(slide: &'a Slide, page: &Page, mode: StepsMode) -> Cow<'a, Slide> {
    let Some(step) = page.step.filter(|_| is_expanded(slide, mode)) else {
        return Cow::Borrowed(slide);
    };
    let suffix = format!(" ({}/{})", step + 1, clicks_of(slide) + 1);
    let mut shown = slide.clone();
    let title = shown.elements.iter_mut().find_map(|element| match element {
        Element::Text(text) if text.base.placeholder.as_deref() == Some("title") => {
            Some(&mut text.text)
        }
        _ => None,
    });
    if let Some(title) = title {
        add_suffix(title, &suffix);
    }
    Cow::Owned(shown)
}

/// The speaker notes of a page: the slide's own, and on a page of a slide written as several
/// a last line that names the slide and the page, `[kasten s-1a2b step 2/5]`, so a program
/// that reads the file can put the pages back together.
pub fn page_notes(slide: &Slide, page: &Page, mode: StepsMode) -> Vec<String> {
    let mut lines = notes::plain(&slide.notes);
    let Some(step) = page.step.filter(|_| is_expanded(slide, mode)) else {
        return lines;
    };
    while lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    if !lines.is_empty() {
        lines.push(String::new());
    }
    lines.push(format!(
        "[kasten {} step {}/{}]",
        slide.id,
        step + 1,
        clicks_of(slide) + 1
    ));
    lines
}

#[cfg(test)]
mod tests;
