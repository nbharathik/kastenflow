//! Links that go nowhere: a link to a slide the deck does not have, or an address that cannot be one.

use std::collections::HashSet;

use super::super::scene::Scene;
use super::super::texts::{describe, describe_unit, sentence};
use super::content::texts_of;
use super::{Found, Sink, each};

/// The longest stretch of a run's words quoted in a message.
const QUOTED: usize = 32;

/// What is wrong with a link, as the end of "a link that …"; none when it is fine, empty included
/// (a cleared link is no link). A bare address such as `example.org` is read as a web address, as
/// the export reads it; `page:` links are for the host to judge.
pub fn link_problem(link: &str, slides: &HashSet<&str>) -> Option<String> {
    let link = link.trim();
    if link.is_empty() {
        return None;
    }
    if let Some(id) = link.strip_prefix("slide:") {
        let id = id.trim();
        return (!slides.contains(id)).then(|| {
            if id.is_empty() {
                "names no slide".to_owned()
            } else {
                format!("goes to the slide \"{id}\", which is not in the deck")
            }
        });
    }
    if link
        .get(..5)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("page:"))
    {
        return None;
    }
    if link.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Some("has a space in it".to_owned());
    }
    let (scheme, rest) = link.split_once(':')?;
    match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" | "ftp" => {
            let authority = rest
                .strip_prefix("//")
                .map(|after| after.split(['/', '?', '#']).next().unwrap_or(""));
            let host = authority
                .map(|a| a.rsplit('@').next().unwrap_or(""))
                .map(|h| h.split(':').next().unwrap_or(""))
                .unwrap_or("");
            let fine = !host.is_empty()
                && host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'[' | b']'));
            (!fine).then(|| format!("has no web address after \"{scheme}:\""))
        }
        "mailto" => {
            let at = rest.split('?').next().unwrap_or("");
            let fine = at
                .split_once('@')
                .is_some_and(|(name, host)| !name.is_empty() && host.contains('.'));
            (!fine).then(|| {
                "is not a mail address (it should look like mailto:name@example.org)".to_owned()
            })
        }
        "tel" => (!rest.bytes().any(|b| b.is_ascii_digit()))
            .then(|| "has no number after \"tel:\"".to_owned()),
        other => Some(format!(
            "starts with \"{other}:\", which is not a web, mail or phone address (give https://…, or slide:<id>)"
        )),
    }
}

fn quoted(words: &str) -> String {
    let mut shown: String = words.chars().take(QUOTED).collect();
    if words.chars().count() > QUOTED {
        shown.push('…');
    }
    shown
}

pub fn broken_links(scene: &Scene, sink: &mut Sink) {
    let slides: HashSet<&str> = scene.deck.slides.iter().map(|s| s.id.as_str()).collect();
    for (n, top) in scene.slide.elements.iter().enumerate() {
        let unit = scene.units.get(n);
        let id = unit.map_or(top.id(), |u| u.id);
        let describe_top = || unit.map_or_else(|| describe(top), describe_unit);
        each(std::slice::from_ref(top), &mut |e| {
            let mut add = |link: &str, whose: String, problem: String| {
                sink.add(Found {
                    rule: "broken-link",
                    order: n + 1,
                    key: &format!("{}|{link}", e.id()),
                    rank: 0.0,
                    element: Some(id),
                    message: sentence(&format!("{whose} has a link that {problem}.")),
                    hint: "Point it at a slide or a page that exists, or take the link off.",
                });
            };
            if let Some(link) = e.base().link.as_deref()
                && let Some(problem) = link_problem(link, &slides)
            {
                add(link, describe_top(), problem);
            }
            for run in texts_of(e)
                .iter()
                .flat_map(|t| t.paragraphs.iter())
                .flat_map(|p| p.runs.iter())
            {
                if let Some(link) = run.link.as_deref()
                    && let Some(problem) = link_problem(link, &slides)
                {
                    add(
                        link,
                        format!("The words \"{}\" in {}", quoted(&run.t), describe_top()),
                        problem,
                    );
                }
            }
        });
    }
}
