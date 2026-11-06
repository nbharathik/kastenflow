//! Off-brand colours. A brand kit names the colours a company's decks may use; this rule finds the
//! elements that use another one. It is not one of the deck's own rules: the deck cannot say what the
//! brand is, so a host that has a brand kit asks for it by name with the kit's colours, and a deck
//! with no brand is never checked. Colours written as theme names (`accent1`) are on brand by
//! construction, the theme's own twelve colours count as the brand's (a brand is applied to a deck
//! through its theme), and black and white are neutral.

use std::collections::BTreeSet;

use serde_json::Value;

use super::model::{Issue, Severity};
use super::rules::RuleInfo;
use crate::model::Deck;

/// The rule, for a table of rules.
pub const OFF_BRAND: RuleInfo = RuleInfo {
    name: "off-brand-colour",
    severity: Severity::Warning,
    summary: "A #rrggbb colour is neither one of the brand's nor one of the theme's (needs a brand kit).",
};

/// The keys of an element that hold a colour: fills, outlines, words, marker pens and bullets.
const COLOR_KEYS: [&str; 3] = ["color", "highlight", "bulletColor"];

/// A colour as `#rrggbb` in lower case, or None when it is a theme name or not a colour. `#abc` is `#aabbcc`; an alpha pair is dropped.
pub fn normalise(color: &str) -> Option<String> {
    let hex = color.trim().strip_prefix('#')?;
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        3 => Some(format!(
            "#{}",
            hex.chars()
                .flat_map(|c| [c, c])
                .collect::<String>()
                .to_ascii_lowercase()
        )),
        6 | 8 => Some(format!("#{}", hex[..6].to_ascii_lowercase())),
        _ => None,
    }
}

/// The colours of a brand kit.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Brand {
    colors: BTreeSet<String>,
}

impl Brand {
    /// A brand of these colours; anything that is not a hex colour is left out.
    pub fn new<I, S>(colors: I) -> Brand
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Brand {
            colors: colors
                .into_iter()
                .filter_map(|c| normalise(c.as_ref()))
                .collect(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.colors.is_empty()
    }
}

fn collect(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, inner) in map {
                match inner {
                    Value::String(text) if COLOR_KEYS.contains(&key.as_str()) => {
                        if let Some(color) = normalise(text)
                            && !found.contains(&color)
                        {
                            found.push(color);
                        }
                    }
                    other => collect(other, found),
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect(item, found)),
        _ => {}
    }
}

/// The elements of every slide that use a colour outside the brand and the theme: one issue for each colour of each top-level
/// element (a group is one element), in the deck's order. A brand with no colours checks nothing.
pub fn off_brand(deck: &Deck, brand: &Brand) -> Vec<Issue> {
    if brand.is_empty() {
        return Vec::new();
    }
    let t = &deck.theme.colors;
    let mut allowed: BTreeSet<String> = brand.colors.clone();
    allowed.extend(
        [
            &t.text1, &t.text2, &t.bg1, &t.bg2, &t.accent1, &t.accent2, &t.accent3, &t.accent4,
            &t.accent5, &t.accent6,
        ]
        .into_iter()
        .filter_map(|c| normalise(c)),
    );
    allowed.insert("#000000".to_owned());
    allowed.insert("#ffffff".to_owned());
    let list = brand.colors.iter().cloned().collect::<Vec<_>>().join(", ");
    let mut issues = Vec::new();
    for slide in &deck.slides {
        for element in &slide.elements {
            let Ok(value) = serde_json::to_value(element) else {
                continue;
            };
            let mut used = Vec::new();
            collect(&value, &mut used);
            for color in used.into_iter().filter(|c| !allowed.contains(c)) {
                issues.push(Issue {
                    rule: OFF_BRAND.name.to_owned(),
                    severity: OFF_BRAND.severity,
                    slide: slide.id.clone(),
                    element: Some(element.id().to_owned()),
                    message: format!(
                        "\"{}\" uses the colour {color}, which is not one of the brand's colours.",
                        element.id()
                    ),
                    hint: Some(format!(
                        "Use a theme colour (accent1 to accent6, text1, bg1 ...) or one of the brand's: {list}."
                    )),
                });
            }
        }
    }
    issues
}
