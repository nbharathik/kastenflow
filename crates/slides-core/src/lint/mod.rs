//! Lint: the problems in a deck that a person or an agent should put right
//! before it is shown or sent, found by rules that read the deck as it is
//! drawn (composites expanded) and report in plain words, each with the fix.
//!
//! [`lint_deck`] checks every slide and [`lint_slide`] one; a slide's issues
//! are the same in either. Two rules need something the deck cannot say. Text
//! that overflows its box can only be found where the words are laid out, so
//! a host that draws them (a browser) passes [`Measures`]; one that does not
//! may pass an estimate. A citation key can only be checked against a
//! bibliography, passed as [`Refs`]. Without them those rules are named in
//! [`Report::skipped`], never left out silently.

pub(crate) mod color;
pub mod estimate;
mod fonts;
mod geometry;
mod model;
mod probes;
mod rules;
mod scene;
mod text;
mod texts;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use fonts::BUNDLED;
pub use model::{Issue, Measure, Measures, Options, Refs, Report, Severity, SkippedRule};
pub use probes::{Probe, ProbePart, probes, probes_with};
pub use rules::{RULES, RuleInfo};
pub use scene::is_blank;
pub use text::{View, summary, to_text};

use crate::error::{Error, Result};
use crate::model::{Deck, Slide};

/// Every rule, errors first, in the order issues are reported in.
pub fn rules() -> &'static [RuleInfo] {
    &RULES
}

/// The issues of one slide, and how many text elements had no measure.
fn slide_issues(deck: &Deck, slide: &Slide, options: &Options) -> (Vec<Issue>, usize) {
    let expanded = scene::expanded_with(deck, slide, options.refs);
    let scene = scene::Scene::new(deck, slide, &expanded);
    let mut sink = rules::Sink::new(&slide.id);
    let outcome = rules::run(&scene, options, &mut sink);
    (sink.finish(), outcome.unmeasured)
}

/// The rules that could not run, and why.
fn skipped(options: &Options, unmeasured: usize) -> Vec<SkippedRule> {
    let mut out = Vec::new();
    if options.measures.is_none() {
        out.push(SkippedRule {
            rule: "text-overflow".to_owned(),
            reason: "The size of laid-out text is only known where the words are drawn, and this host gave no measurements, so text that overflows its box was not looked for.".to_owned(),
        });
    } else if unmeasured > 0 {
        out.push(SkippedRule {
            rule: "text-overflow".to_owned(),
            reason: format!(
                "{unmeasured} text element{} had no measurement, so {} not checked for overflow.",
                if unmeasured == 1 { "" } else { "s" },
                if unmeasured == 1 {
                    "it was"
                } else {
                    "they were"
                }
            ),
        });
    }
    if options.refs.is_none() {
        out.push(SkippedRule {
            rule: "unresolved-citation".to_owned(),
            reason: "No reference list was given, so citation keys were not checked.".to_owned(),
        });
    }
    out
}

/// Lints the whole deck, with what the host can say about the text and the references.
pub fn lint_deck_with(deck: &Deck, options: &Options) -> Report {
    let mut issues = Vec::new();
    let mut unmeasured = 0;
    for slide in &deck.slides {
        let (found, missing) = slide_issues(deck, slide, options);
        issues.extend(found);
        unmeasured += missing;
    }
    Report {
        issues,
        skipped: skipped(options, unmeasured),
    }
}

/// Lints the whole deck. `measures` are the sizes of laid-out text, if the host has them.
pub fn lint_deck(deck: &Deck, measures: Option<&Measures>) -> Report {
    lint_deck_with(
        deck,
        &Options {
            measures,
            refs: None,
        },
    )
}

/// Lints one slide; its issues are those the deck's report holds for it.
pub fn lint_slide_with(deck: &Deck, slide: &str, options: &Options) -> Result<Report> {
    let slide = deck.slide(slide).ok_or_else(|| Error::no_slide(slide))?;
    let (issues, unmeasured) = slide_issues(deck, slide, options);
    Ok(Report {
        issues,
        skipped: skipped(options, unmeasured),
    })
}

pub fn lint_slide(deck: &Deck, slide: &str, measures: Option<&Measures>) -> Result<Report> {
    lint_slide_with(
        deck,
        slide,
        &Options {
            measures,
            refs: None,
        },
    )
}
