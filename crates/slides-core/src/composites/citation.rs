//! Citation: references by their BibTeX keys, set small in the citation style.
//!
//! It is one text box. What it says comes from [`crate::citations::pieces`]:
//! `short` is one line, `Vaswani et al., 2017 (NeurIPS)`; `numbered` is `[1][2]`,
//! the numbers the deck gives the works; `full` is a line for each reference;
//! `list` is every work the deck cites, each with its number in front. Without a
//! bibliography the keys are written as they are, so a host that has none still
//! draws something. With `links` on, each work is a run of its own that links to
//! where the bibliography says it can be read (see [`Entry::web_link`]); the words
//! between works are not linked.

use super::Ctx;
use super::build::{ParaExt, Parts, insets, para, run, shown};
use super::geom::sane;
use super::measure::{Face, fit_pt, line_count};
use crate::citations::{self, Entry, Piece};
use crate::model::{CitationEl, CitationStyle, Element, Paragraph, Run, Text, VAlign};
use crate::units::points_to_units;

/// The smallest a citation is set, in points.
const FLOOR_PT: f64 = 8.0;
const LINE: f64 = 1.25;
/// Space between two references, in points.
const BETWEEN: f64 = 2.0;
/// The insets of the text: the sides are what a text box has by default; the top and bottom are
/// tighter, so that one line of the citation style fits the strip of 24 units that a footer
/// has between the content and the margin of the slide.
const SIDE: f64 = 9.6;
const TOP: f64 = 2.4;

/// The lines a citation is made of, one paragraph each, in pieces.
fn pieces(cx: &Ctx, element: &CitationEl) -> Vec<Vec<Piece>> {
    let style = element.format.as_ref().unwrap_or(&CitationStyle::Short);
    citations::pieces(&element.keys, style, &cx.cites)
}

/// The words of a line.
fn words(line: &[Piece]) -> String {
    line.iter().map(|piece| piece.text.as_str()).collect()
}

/// Where a piece links to: the web address of the work it names, when the citation links its
/// works and the bibliography has the work and an address for it.
fn address(cx: &Ctx, element: &CitationEl, piece: &Piece) -> Option<String> {
    if !element.links {
        return None;
    }
    let key = piece.key.as_deref()?;
    cx.cites.refs?.get(key).and_then(Entry::web_link)
}

pub fn expand(cx: &Ctx, element: &CitationEl) -> Vec<Element> {
    let rect = sane(cx.rect);
    let theme_size = cx.theme.text_style("citation").map_or(10.0, |s| s.size);
    let lines = pieces(cx, element);
    let said: Vec<String> = lines.iter().map(|line| words(line)).collect();
    let (room_w, room_h) = (rect.w - 2.0 * SIDE, rect.h - 2.0 * TOP);
    let fits = |pt: f64| {
        let rows: usize = said
            .iter()
            .map(|l| line_count(l, room_w, pt, Face::Sans, false))
            .sum();
        rows as f64 * points_to_units(pt * LINE)
            + said.len().saturating_sub(1) as f64 * points_to_units(BETWEEN)
            <= room_h
    };
    let size = fit_pt(theme_size, FLOOR_PT.min(theme_size), fits);
    // The theme's size stands unless the box is too small for it.
    let set = |words: &str| -> Run {
        let mut words = run(shown(words), size);
        if size == theme_size {
            words.size = None;
        }
        words
    };
    let paragraphs: Vec<Paragraph> = lines
        .iter()
        .zip(&said)
        .map(|(line, said)| {
            // One run for the whole line, unless the works are links: then one for each piece.
            let runs = if element.links {
                line.iter()
                    .map(|piece| Run {
                        link: address(cx, element, piece),
                        ..set(&piece.text)
                    })
                    .collect()
            } else {
                vec![set(said)]
            };
            para(runs).style("citation").spacing(LINE).after(BETWEEN)
        })
        .collect();
    let text = Text {
        valign: Some(VAlign::Top),
        insets: Some(insets(SIDE, TOP, SIDE, TOP)),
        ..Text::from_paragraphs(paragraphs)
    };
    let mut parts = Parts::new(cx.id, rect);
    parts.text(rect, text);
    parts.finish()
}

#[cfg(test)]
mod linked;
#[cfg(test)]
mod resolved;
#[cfg(test)]
mod tests;
