//! The rules about what is in the diagram: ids, parents, edges, words,
//! size, places, links and pictures.

use std::collections::HashMap;

use super::{MANY_NODES, Severity, Sink, TOO_MANY_NODES};
use crate::diagrams::model::{Cell, Kind, plain_label};
use crate::diagrams::steps::{image_ok, link_ok};

/// How many findings of one rule are told one by one before the rest are counted.
const EACH: usize = 8;

impl Sink<'_> {
    /// Findings of one rule: the first few one by one, then one that counts the rest.
    pub(super) fn many(
        &mut self,
        rule: &'static str,
        severity: Severity,
        found: Vec<(String, String)>,
        hint: &str,
    ) {
        let more = found.len().saturating_sub(EACH);
        for (cell, message) in found.into_iter().take(EACH) {
            self.add(rule, severity, Some(&cell), message, hint);
        }
        if more > 0 {
            self.add(
                rule,
                severity,
                None,
                format!("{more} more cells have the same problem"),
                hint,
            );
        }
    }

    pub(super) fn is_group(&self, c: &Cell) -> bool {
        self.page.children_of(&c.id).any(|k| k.kind == Kind::Vertex)
    }
}

pub(super) fn run(s: &mut Sink) {
    structure(s);
    words(s);
    places(s);
    links(s);
}

fn structure(s: &mut Sink) {
    let page = s.page;
    // The same id on two cells.
    let mut seen: HashMap<&str, usize> = HashMap::new();
    for c in page.live() {
        *seen.entry(&c.id).or_default() += 1;
    }
    let mut twice: Vec<(&str, usize)> = seen.into_iter().filter(|(_, n)| *n > 1).collect();
    twice.sort_unstable();
    for (id, n) in twice {
        s.add(
            "duplicate-id",
            Severity::Error,
            Some(id),
            format!("{n} cells have the id “{id}”"),
            "Give each cell an id of its own; the editor may drop all but one",
        );
    }
    for c in page
        .live()
        .filter(|c| matches!(c.kind, Kind::Vertex | Kind::Edge))
    {
        let problem = match c.parent.as_deref() {
            None => Some("has no parent".to_owned()),
            Some(p) => match page.get(p) {
                None => Some(format!("has the parent “{p}”, which is not there")),
                Some(parent) if parent.kind == Kind::Edge => {
                    Some(format!("is inside the edge “{p}”"))
                }
                Some(_) if page.ancestors(&c.id).iter().skip(1).any(|a| *a == c.id) => {
                    Some("is its own ancestor".to_owned())
                }
                Some(_) => None,
            },
        };
        if let Some(problem) = problem {
            s.add(
                "bad-parent",
                Severity::Error,
                Some(&c.id),
                format!("“{}” {problem}", c.id),
                "Put it in a layer (parent 1) or in a group that is there",
            );
        }
    }
    for e in page.edges() {
        let mut ends = 0;
        for (what, end) in [("source", &e.source), ("target", &e.target)] {
            match end {
                Some(id) if page.get(id).is_none() => s.add(
                    "dangling-edge",
                    Severity::Error,
                    Some(&e.id),
                    format!(
                        "The edge “{}” has the {what} “{id}”, which is not there",
                        e.id
                    ),
                    "Point it at a node that is there, or take the edge out",
                ),
                Some(_) => ends += 1,
                None => {}
            }
        }
        if ends < 2 && e.extra_points.is_empty() {
            s.add(
                "dangling-edge",
                Severity::Warning,
                Some(&e.id),
                format!(
                    "The edge “{}” is attached at {} end",
                    e.id,
                    if ends == 1 { "only one" } else { "neither" }
                ),
                "Give it a source and a target so it moves with the nodes",
            );
        }
    }
}

fn words(s: &mut Sink) {
    let page = s.page;
    let unlabelled: Vec<(String, String)> = page
        .edges()
        .filter(|e| e.text().trim().is_empty())
        .map(|e| (e.id.clone(), format!("The edge “{}” has no label", e.id)))
        .collect();
    // An edge needs no label in a diagram that is only a few boxes.
    if page.edges().count() >= 3 {
        s.many(
            "unlabeled-edge",
            Severity::Info,
            unlabelled,
            "Say what flows or happens along it, in a word or two",
        );
    }
    let empty: Vec<(String, String)> = page
        .vertices()
        .filter(|c| c.text().trim().is_empty() && !s.is_group(c) && !pictured(c) && !tiny(c))
        .map(|c| (c.id.clone(), format!("The node “{}” has no label", c.id)))
        .collect();
    s.many("empty-label", Severity::Warning, empty, "Name what it is");
    let long: Vec<(String, String)> = page
        .vertices()
        .filter(|c| c.style.bare() != Some("text"))
        .filter_map(|c| {
            let text = c.text();
            let (chars, lines) = (text.chars().count(), text.lines().count());
            (chars > 80 || lines > 4).then(|| {
                (
                    c.id.clone(),
                    format!(
                        "The label of “{}” is long ({chars} characters, {lines} lines)",
                        c.id
                    ),
                )
            })
        })
        .collect();
    s.many(
        "long-label",
        Severity::Warning,
        long,
        "Shorten it to a few words; put the detail in a note or the page it links to",
    );
    let nodes = page.vertices().filter(|c| !s.is_group(c)).count();
    if nodes > TOO_MANY_NODES {
        s.add(
            "too-many-nodes",
            Severity::Error,
            None,
            format!("The page has {nodes} nodes; more than {TOO_MANY_NODES} cannot be read"),
            "Split it over pages or draw the parts as groups on one level up",
        );
    } else if nodes > MANY_NODES {
        s.add(
            "too-many-nodes",
            Severity::Warning,
            None,
            format!("The page has {nodes} nodes; more than {MANY_NODES} is hard to read"),
            "Split it over pages or group them",
        );
    }
}

/// A picture or icon needs no label to be understood.
fn pictured(c: &Cell) -> bool {
    c.style.has("image")
        || c.style
            .get("shape")
            .is_some_and(|s| s.starts_with("mxgraph.") || s == "image")
}

fn tiny(c: &Cell) -> bool {
    c.geo.as_ref().is_some_and(|g| g.w <= 24.0 && g.h <= 24.0)
}

fn places(s: &mut Sink) {
    let page = s.page;
    // Boxes beside each other that overlap.
    let mut by_parent: HashMap<&str, Vec<&Cell>> = HashMap::new();
    for c in page
        .vertices()
        .filter(|c| c.style.bare() != Some("text") && !tiny(c))
    {
        by_parent
            .entry(c.parent.as_deref().unwrap_or(""))
            .or_default()
            .push(c);
    }
    let mut parents: Vec<&&str> = by_parent.keys().collect();
    parents.sort_unstable();
    let mut overlapping = Vec::new();
    for parent in parents {
        let boxes = &by_parent[*parent];
        for (i, a) in boxes.iter().enumerate() {
            let Some(ra) = page.abs(&a.id) else { continue };
            for b in &boxes[i + 1..] {
                let Some(rb) = page.abs(&b.id) else { continue };
                let backdrop = |outer: &Cell,
                                ro: &crate::diagrams::model::Rect,
                                ri: &crate::diagrams::model::Rect| {
                    (outer.style.get("fillColor") == Some("none")
                        || outer.style.flag("container")
                        || outer.style.bare() == Some("swimlane"))
                        && ro.contains(ri)
                };
                if ra.overlaps(&rb, 4.0) && !backdrop(a, &ra, &rb) && !backdrop(b, &rb, &ra) {
                    overlapping.push((a.id.clone(), format!("“{}” overlaps “{}”", a.id, b.id)));
                }
            }
        }
    }
    s.many(
        "overlap",
        Severity::Warning,
        overlapping,
        "Move one of them, or lay the diagram out again",
    );
    let off_grid: Vec<(String, String)> = page
        .vertices()
        .filter_map(|c| {
            let r = page.abs(&c.id)?;
            let off = |v: f64| (v / 10.0 - (v / 10.0).round()).abs() > 0.01;
            (off(r.x) || off(r.y)).then(|| {
                (
                    c.id.clone(),
                    format!("“{}” is not on the 10 pixel grid ({}, {})", c.id, r.x, r.y),
                )
            })
        })
        .collect();
    s.many(
        "off-grid",
        Severity::Info,
        off_grid,
        "Lay the diagram out, or move it to a multiple of 10",
    );
    let (w, h) = (page.width.unwrap_or(850.0), page.height.unwrap_or(1100.0));
    let mut off_page = Vec::new();
    for c in page.vertices() {
        let Some(r) = page.abs(&c.id) else { continue };
        if r.right() <= 0.0 || r.bottom() <= 0.0 || r.x >= w || r.y >= h {
            off_page.push((
                c.id.clone(),
                format!("“{}” is outside the page ({w} by {h})", c.id),
            ));
        }
    }
    s.many(
        "off-page",
        Severity::Warning,
        off_page,
        "Move it onto the page, or make the page bigger with set_page",
    );
    // Boxes of the same look and nearly the same size.
    let mut same_look: HashMap<String, Vec<&Cell>> = HashMap::new();
    for c in page
        .vertices()
        .filter(|c| !s.is_group(c) && c.geo.is_some())
    {
        same_look.entry(c.style.to_string()).or_default().push(c);
    }
    let mut looks: Vec<&String> = same_look.keys().collect();
    looks.sort_unstable();
    let mut uneven = Vec::new();
    for look in looks {
        let group = &same_look[look];
        if group.len() < 3 {
            continue;
        }
        let size = |c: &Cell| {
            c.geo
                .as_ref()
                .map_or((0, 0), |g| (g.w.round() as i64, g.h.round() as i64))
        };
        let mut tally: HashMap<(i64, i64), usize> = HashMap::new();
        for c in group {
            *tally.entry(size(c)).or_default() += 1;
        }
        let modal = tally
            .iter()
            .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
            .map(|(k, _)| *k)
            .unwrap_or((0, 0));
        for c in group {
            let (w, h) = size(c);
            let (dw, dh) = ((w - modal.0).abs(), (h - modal.1).abs());
            if (dw > 0 || dh > 0) && dw <= 30 && dh <= 30 {
                uneven.push((
                    c.id.clone(),
                    format!(
                        "“{}” is {w} by {h} where the others like it are {} by {}",
                        c.id, modal.0, modal.1
                    ),
                ));
            }
        }
    }
    s.many(
        "inconsistent-size",
        Severity::Info,
        uneven,
        "Give boxes of the same kind the same size",
    );
}

fn links(s: &mut Sink) {
    let mut unsafe_links = Vec::new();
    let mut outside = Vec::new();
    for c in s
        .page
        .live()
        .filter(|c| matches!(c.kind, Kind::Vertex | Kind::Edge))
    {
        if let Some(link) = c
            .attr("link")
            .filter(|l| !l.trim().is_empty() && !link_ok(l))
        {
            unsafe_links.push((
                c.id.clone(),
                format!(
                    "“{}” links to {}, which is not allowed",
                    c.id,
                    shorten(link)
                ),
            ));
        }
        for href in tag_values(&c.label, "href") {
            if !link_ok(&href) && !href.starts_with('#') {
                unsafe_links.push((
                    c.id.clone(),
                    format!(
                        "The label of “{}” links to {}, which is not allowed",
                        c.id,
                        shorten(&href)
                    ),
                ));
            }
        }
        if let Some(image) = c.style.get("image").filter(|i| !image_ok(i)) {
            outside.push((
                c.id.clone(),
                format!(
                    "“{}” shows the picture {}, which the diagram does not hold",
                    c.id,
                    shorten(image)
                ),
            ));
        }
        for src in tag_values(&c.label, "src") {
            if !image_ok(&src) {
                outside.push((
                    c.id.clone(),
                    format!(
                        "The label of “{}” shows the picture {}, which the diagram does not hold",
                        c.id,
                        shorten(&src)
                    ),
                ));
            }
        }
    }
    s.many(
        "unsafe-link",
        Severity::Error,
        unsafe_links,
        "Link to an http(s) or mailto address, a [[Page]] of the vault, or a page of the diagram",
    );
    s.many(
        "external-image",
        Severity::Error,
        outside,
        "Use a picture inside the diagram (data:image/…) or one of the editor's own (img/lib/…)",
    );
}

fn shorten(text: &str) -> String {
    let t: String = text.chars().take(60).collect();
    if text.chars().count() > 60 {
        format!("“{t}…”")
    } else {
        format!("“{t}”")
    }
}

/// The values of attribute `name` in the tags of an HTML label.
fn tag_values(html: &str, name: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    for quote in ['"', '\''] {
        let key = format!("{name}={quote}");
        let mut from = 0;
        while let Some(at) = lower[from..].find(&key) {
            let start = from + at + key.len();
            let Some(len) = html[start..].find(quote) else {
                break;
            };
            out.push(plain_label(&html[start..start + len]).trim().to_owned());
            from = start + len;
        }
    }
    out
}
