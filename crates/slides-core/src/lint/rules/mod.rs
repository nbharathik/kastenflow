//! The rules. Each is a function of a slide's scene that adds what it finds
//! to a sink; the sink keeps one issue for each thing a rule found in an
//! element (or in a composite as a whole) and puts them in the fixed order.

mod content;
mod contrast;
mod families;
mod layout;
mod links;
mod overlap;
mod text;

#[cfg(test)]
pub(crate) use links::link_problem;

use crate::model::Element;

use super::Options;
use super::model::{Issue, Severity};
use super::scene::Scene;

/// A rule, for the table of rules.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RuleInfo {
    pub name: &'static str,
    pub severity: Severity,
    /// When it fires, in a sentence.
    pub summary: &'static str,
}

const fn rule(name: &'static str, severity: Severity, summary: &'static str) -> RuleInfo {
    RuleInfo {
        name,
        severity,
        summary,
    }
}

/// Every rule, errors first: the order issues are reported in.
pub const RULES: [RuleInfo; 15] = [
    rule(
        "text-overflow",
        Severity::Error,
        "Text is taller or wider than its box (needs the text measured).",
    ),
    rule(
        "off-slide",
        Severity::Error,
        "An element sits partly outside the slide (a full-slide picture or shape, or an element named `bleed`, may).",
    ),
    rule(
        "unresolved-citation",
        Severity::Error,
        "A citation names a key that is not in the reference list (needs the list).",
    ),
    rule(
        "font-missing",
        Severity::Error,
        "Text names a font that is neither a theme font nor one of the bundled families.",
    ),
    rule(
        "broken-link",
        Severity::Error,
        "A link goes to a slide that is not in the deck, or to an address that cannot be opened (no host, a space, a scheme that is not web, mail or phone).",
    ),
    rule(
        "overlap",
        Severity::Warning,
        "Text overlaps other text, or a shape it does not sit inside.",
    ),
    rule(
        "min-font",
        Severity::Warning,
        "Body text is under 14 pt, or citation text under 8 pt (in proportion on a slide narrower than 960 units).",
    ),
    rule(
        "contrast",
        Severity::Warning,
        "Text has less than 4.5:1 contrast with what is behind it (3:1 from 24 pt).",
    ),
    rule(
        "margin",
        Severity::Warning,
        "Content is closer than 24 units to an edge of the slide.",
    ),
    rule(
        "empty-placeholder",
        Severity::Warning,
        "A slot of the layout was left empty.",
    ),
    rule(
        "step-orphan",
        Severity::Warning,
        "An element changes at a step the slide does not have.",
    ),
    rule(
        "pptx-unsafe",
        Severity::Warning,
        "Something has no form PowerPoint or Google Slides reads: a Morph transition, an embedded page without a snapshot, a video, a timer, an imported object with nothing to draw, inline math.",
    ),
    rule(
        "near-miss-align",
        Severity::Info,
        "Two edges are 1 to 6 units apart and should probably line up.",
    ),
    rule(
        "word-count",
        Severity::Info,
        "More than 60 words are on one slide.",
    ),
    rule(
        "missing-alt",
        Severity::Info,
        "A picture has no alternative text.",
    ),
];

/// The position of a rule in the table.
pub fn rank_of(name: &str) -> usize {
    RULES
        .iter()
        .position(|r| r.name == name)
        .unwrap_or(RULES.len())
}

/// What a rule found.
pub struct Found<'a> {
    pub rule: &'static str,
    /// Where the thing stands on the slide: 0 for the slide itself, else one more than its place in the stack.
    pub order: usize,
    /// What makes two findings of a rule the same one.
    pub key: &'a str,
    /// Lower is worse.
    pub rank: f64,
    /// The element of the slide's list it is about.
    pub element: Option<&'a str>,
    pub message: String,
    pub hint: &'a str,
}

struct Draft {
    key: String,
    rule: usize,
    order: usize,
    /// Lower is worse; of drafts with the same key the worst is kept.
    rank: f64,
    issue: Issue,
}

/// Collects what the rules find on one slide.
pub struct Sink {
    slide: String,
    drafts: Vec<Draft>,
}

impl Sink {
    pub fn new(slide: &str) -> Sink {
        Sink {
            slide: slide.to_owned(),
            drafts: Vec::new(),
        }
    }

    /// Adds an issue. Of several with the same rule and `key`, the one with
    /// the lowest `rank` is kept, so a composite of many parts is reported
    /// once, for its worst part.
    pub fn add(&mut self, found: Found) {
        let at = rank_of(found.rule);
        let severity = RULES.get(at).map_or(Severity::Info, |r| r.severity);
        let draft = Draft {
            key: format!("{}|{}", found.rule, found.key),
            rule: at,
            order: found.order,
            rank: found.rank,
            issue: Issue {
                rule: found.rule.to_owned(),
                severity,
                slide: self.slide.clone(),
                element: found.element.map(str::to_owned),
                message: found.message,
                hint: Some(found.hint.to_owned()).filter(|h| !h.is_empty()),
            },
        };
        match self.drafts.iter_mut().find(|d| d.key == draft.key) {
            Some(kept) if draft.rank < kept.rank => *kept = draft,
            Some(_) => {}
            None => self.drafts.push(draft),
        }
    }

    /// The issues in the fixed order: severity, then the table of rules, then
    /// the stack, then the words.
    pub fn finish(mut self) -> Vec<Issue> {
        self.drafts.sort_by(|a, b| {
            let (sa, sb) = (a.issue.severity, b.issue.severity);
            sa.cmp(&sb)
                .then(a.rule.cmp(&b.rule))
                .then(a.order.cmp(&b.order))
                .then_with(|| a.issue.message.cmp(&b.issue.message))
        });
        self.drafts.into_iter().map(|d| d.issue).collect()
    }
}

/// What running the rules on a slide left to say.
#[derive(Default)]
pub struct Outcome {
    /// Text elements the measures had nothing for.
    pub unmeasured: usize,
}

/// Runs every rule on a slide.
pub fn run(scene: &Scene, options: &Options, sink: &mut Sink) -> Outcome {
    let mut outcome = Outcome::default();
    if let Some(measures) = options.measures {
        outcome.unmeasured = text::overflow(scene, measures, sink);
    }
    layout::off_slide(scene, sink);
    if let Some(refs) = options.refs {
        content::citations(scene, refs, sink);
    }
    families::missing(scene, sink);
    links::broken_links(scene, sink);
    overlap::overlap(scene, sink);
    text::min_font(scene, sink);
    contrast::contrast(scene, sink);
    layout::margin(scene, sink);
    content::empty_placeholders(scene, sink);
    content::step_orphans(scene, sink);
    content::pptx_unsafe(scene, sink);
    overlap::near_miss(scene, sink);
    text::word_count(scene, sink);
    content::missing_alt(scene, sink);
    outcome
}

/// The id an issue names for a leaf: the element of the slide's list it is in.
pub(super) fn element_of<'a>(scene: &'a Scene, unit: usize) -> &'a str {
    scene.units[unit].id
}

/// Every element of a list and of the groups in it, depth first.
pub(super) fn each<'a>(list: &'a [Element], f: &mut impl FnMut(&'a Element)) {
    for e in list {
        f(e);
        each(e.children(), f);
    }
}
