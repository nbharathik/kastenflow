//! A subset of Mermaid's flowcharts (`graph` and `flowchart`): nodes with the
//! usual shapes, arrows (`-->`, `---`, `-.->`, `==>`, `<-->`) with their
//! labels, chains and `A & B --> C`, and subgraphs. Styling (`classDef`,
//! `class`, `style`, `linkStyle`, `click`) is read and left out, and said.
//! Other kinds of Mermaid diagram are refused with a pointer to the spec.

use std::collections::BTreeMap;

use super::{Spec, SpecEdge, SpecGroup, SpecNode};
use crate::error::{Error, Result};

pub struct Parsed {
    pub spec: Spec,
    /// What the text said that is not drawn.
    pub ignored: Vec<String>,
}

fn invalid<T>(why: impl Into<String>) -> Result<T> {
    Err(Error::Invalid(why.into()))
}

/// The name a subgraph gets from its title.
fn slug(text: &str) -> String {
    let s: String = text
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_owned();
    if s.is_empty() { "group".to_owned() } else { s }
}

fn plain(text: &str) -> String {
    let t = text.trim();
    let t = t
        .strip_prefix('"')
        .and_then(|t| t.strip_suffix('"'))
        .unwrap_or(t);
    t.replace("<br/>", "\n")
        .replace("<br>", "\n")
        .replace("<br />", "\n")
        .trim()
        .to_owned()
}

/// A node's brackets: the opening and closing marks, and the kind it draws as.
const SHAPES: [(&str, &str, &str); 11] = [
    ("[(", ")]", "database"),
    ("[[", "]]", "subprocess"),
    ("([", "])", "terminator"),
    ("((", "))", "connector"),
    ("{{", "}}", "process"),
    ("[/", "/]", "io"),
    ("[\\", "\\]", "io"),
    ("[", "]", "process"),
    ("(", ")", "process"),
    ("{", "}", "decision"),
    (">", "]", "process"),
];

/// A style word an arrow adds.
type Extra = Option<(&'static str, &'static str)>;
/// An arrow's mark, the edge kind it draws as, and its style word.
type Op = (&'static str, &'static str, Extra);
/// An arrow read: its kind, style word and label.
type Link = (&'static str, Extra, Option<String>);

struct Parser {
    spec: Spec,
    ignored: Vec<String>,
    stack: Vec<String>,
}

impl Parser {
    fn ignore(&mut self, what: &str) {
        let note = format!("{what} is not drawn");
        if !self.ignored.contains(&note) {
            self.ignored.push(note);
        }
    }

    fn node(&mut self, id: &str, label: Option<String>, kind: Option<&str>) -> Result<()> {
        if let Some(n) = self.spec.nodes.iter_mut().find(|n| n.id == id) {
            if let Some(l) = label {
                n.label = l;
            }
            if let Some(k) = kind {
                n.kind = Some(k.to_owned());
            }
            return Ok(());
        }
        // An arrow may end at a subgraph: that is a group, not a node of its own.
        if self.spec.groups.iter().any(|g| g.id == id) {
            return Ok(());
        }
        self.spec.nodes.push(SpecNode {
            id: id.to_owned(),
            label: label.unwrap_or_else(|| id.to_owned()),
            kind: Some(kind.unwrap_or("process").to_owned()),
            shape: None,
            group: self.stack.last().cloned(),
            x: None,
            y: None,
            set: None,
        });
        Ok(())
    }

    /// One node at the start of `rest`: its id and, if it has brackets, its words and shape.
    fn read_node(&mut self, rest: &mut &str) -> Result<String> {
        let s = *rest;
        // Letters, digits and _; a single - between them (a double one starts an arrow).
        let chars: Vec<(usize, char)> = s.char_indices().collect();
        let id_end = chars
            .iter()
            .enumerate()
            .find(|(i, (_, c))| {
                let hyphen_inside = *c == '-'
                    && *i > 0
                    && chars.get(i + 1).is_some_and(|(_, n)| n.is_alphanumeric());
                !(c.is_alphanumeric() || *c == '_' || hyphen_inside)
            })
            .map_or(s.len(), |(_, (at, _))| *at);
        let id = &s[..id_end];
        if id.is_empty() {
            return invalid(format!(
                "Expected a node name at “{}”",
                s.chars().take(20).collect::<String>()
            ));
        }
        let mut after = &s[id_end..];
        let mut label = None;
        let mut kind = None;
        if let Some((open, close, k)) = SHAPES.iter().find(|(open, ..)| after.starts_with(open)) {
            let body = &after[open.len()..];
            let (text, tail) = if let Some(quoted) = body.strip_prefix('"') {
                let q = quoted.find('"').ok_or_else(|| {
                    Error::Invalid(format!("The label of “{id}” is never closed"))
                })?;
                let tail = quoted[q + 1..].trim_start();
                let tail = tail.strip_prefix(close).ok_or_else(|| {
                    Error::Invalid(format!("The label of “{id}” is not closed with {close}"))
                })?;
                (quoted[..q].to_owned(), tail)
            } else {
                let q = body.find(close).ok_or_else(|| {
                    Error::Invalid(format!("The label of “{id}” is not closed with {close}"))
                })?;
                (body[..q].to_owned(), &body[q + close.len()..])
            };
            label = Some(plain(&text));
            kind = Some(*k);
            after = tail;
        }
        // A `:::class` after a node is styling.
        if let Some(styled) = after.strip_prefix(":::") {
            let n = styled
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(styled.len());
            after = &styled[n..];
            self.ignore("A node class (:::)");
        }
        *rest = after;
        self.node(id, label, kind)?;
        Ok(id.to_owned())
    }

    /// `A & B` at the start of `rest`.
    fn read_group(&mut self, rest: &mut &str) -> Result<Vec<String>> {
        let mut out = vec![self.read_node(rest)?];
        loop {
            let t = rest.trim_start();
            match t.strip_prefix('&') {
                Some(more) => {
                    *rest = more.trim_start();
                    out.push(self.read_node(rest)?);
                }
                None => {
                    *rest = t;
                    return Ok(out);
                }
            }
        }
    }

    /// An arrow at the start of `rest`: its kind, style words and label.
    fn read_link(&mut self, rest: &mut &str) -> Result<Link> {
        let s = *rest;
        const OPS: [Op; 10] = [
            ("<-->", "both", None),
            ("-.->", "async", None),
            ("-->", "flow", None),
            ("==>", "flow", Some(("strokeWidth", "3"))),
            ("---", "line", None),
            ("-.-", "line", Some(("dashed", "1"))),
            ("===", "line", Some(("strokeWidth", "3"))),
            ("--x", "flow", None),
            ("--o", "flow", None),
            ("~~~", "line", Some(("strokeColor", "none"))),
        ];
        if let Some((op, kind, extra)) = OPS.iter().find(|(op, ..)| s.starts_with(op)) {
            let mut after = &s[op.len()..];
            let mut label = None;
            if let Some(piped) = after.strip_prefix('|') {
                let q = piped.find('|').ok_or_else(|| {
                    Error::Invalid("A label between | | is never closed".to_owned())
                })?;
                label = Some(plain(&piped[..q]));
                after = &piped[q + 1..];
            }
            *rest = after;
            return Ok((*kind, *extra, label));
        }
        // `-- text -->`, `-. text .->`, `== text ==>`
        for (open, ends) in [
            ("-- ", [(" -->", "flow"), (" ---", "line")]),
            ("-. ", [(" .->", "async"), (" .-", "line")]),
            ("== ", [(" ==>", "flow"), (" ===", "line")]),
        ] {
            if let Some(body) = s.strip_prefix(open) {
                let found = ends
                    .iter()
                    .filter_map(|(end, kind)| body.find(end).map(|at| (at, *end, *kind)))
                    .min_by_key(|f| f.0);
                if let Some((at, end, kind)) = found {
                    *rest = &body[at + end.len()..];
                    let extra = (open == "== ").then_some(("strokeWidth", "3"));
                    return Ok((kind, extra, Some(plain(&body[..at]))));
                }
            }
        }
        invalid(format!(
            "Expected an arrow (-->, ---, -.->, ==>) at “{}”",
            s.chars().take(20).collect::<String>()
        ))
    }

    fn statement(&mut self, line: &str) -> Result<()> {
        let mut rest = line.trim();
        let mut from = self.read_group(&mut rest)?;
        while !rest.is_empty() {
            let (kind, extra, label) = self.read_link(&mut rest)?;
            rest = rest.trim_start();
            let to = self.read_group(&mut rest)?;
            for a in &from {
                for b in &to {
                    self.spec.edges.push(SpecEdge {
                        from: a.clone(),
                        to: b.clone(),
                        label: label.clone(),
                        kind: Some(kind.to_owned()),
                        set: extra.map(|(k, v)| BTreeMap::from([(k.to_owned(), v.to_owned())])),
                    });
                }
            }
            from = to;
        }
        Ok(())
    }

    fn subgraph(&mut self, rest: &str) -> Result<()> {
        let rest = rest.trim();
        let (id, title) = match rest.split_once('[') {
            Some((id, title)) => (id.trim().to_owned(), plain(title.trim_end_matches(']'))),
            None => (slug(rest), plain(rest)),
        };
        let id = if id.is_empty() { slug(&title) } else { id };
        if self.spec.groups.iter().any(|g| g.id == id) || self.spec.nodes.iter().any(|n| n.id == id)
        {
            return invalid(format!("“{id}” is used twice"));
        }
        self.spec.groups.push(SpecGroup {
            id: id.clone(),
            label: title,
            kind: Some("container".to_owned()),
            group: self.stack.last().cloned(),
        });
        self.stack.push(id);
        Ok(())
    }
}

/// Reads Mermaid flowchart text into a spec.
pub fn parse(text: &str) -> Result<Parsed> {
    let mut p = Parser {
        spec: Spec {
            preset: Some("flowchart".to_owned()),
            ..Spec::default()
        },
        ignored: Vec::new(),
        stack: Vec::new(),
    };
    let mut header = false;
    for raw in text.lines() {
        let line = raw.split("%%").next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if !header {
            let mut words = line.split_whitespace();
            match words.next() {
                Some("graph" | "flowchart") => {
                    let direction = match words.next().map(str::to_uppercase).as_deref() {
                        Some("LR") => "LR",
                        Some("RL") => {
                            p.ignore("The direction RL (drawn left to right)");
                            "LR"
                        }
                        Some("BT") => {
                            p.ignore("The direction BT (drawn top to bottom)");
                            "TB"
                        }
                        _ => "TB",
                    };
                    p.spec.direction = Some(direction.to_owned());
                    header = true;
                    continue;
                }
                Some(other)
                    if other.contains("iagram")
                        || matches!(
                            other,
                            "gantt"
                                | "pie"
                                | "journey"
                                | "mindmap"
                                | "timeline"
                                | "gitGraph"
                                | "sankey-beta"
                                | "quadrantChart"
                                | "requirementDiagram"
                        ) =>
                {
                    return invalid(format!(
                        "Only Mermaid flowcharts (graph, flowchart) are read, not “{other}”. Describe other diagrams with a spec or a template"
                    ));
                }
                Some(_) => {
                    return invalid("Start the text with graph LR, graph TD or flowchart LR");
                }
                None => continue,
            }
        }
        for statement in line.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            let word = statement.split_whitespace().next().unwrap_or("");
            match word {
                "end" => {
                    p.stack.pop();
                }
                "subgraph" => p.subgraph(&statement["subgraph".len()..])?,
                "direction" => p.ignore("A direction inside a subgraph"),
                "classDef" | "class" => p.ignore("Styling (classDef, class)"),
                "style" => p.ignore("Styling (style)"),
                "linkStyle" => p.ignore("Styling (linkStyle)"),
                "click" | "callback" | "href" => p.ignore("Clicks and links (click)"),
                "accTitle" | "accDescr" => p.ignore("Accessibility text"),
                _ => p.statement(statement)?,
            }
        }
    }
    if !header {
        return invalid("Start the text with graph LR, graph TD or flowchart LR");
    }
    if !p.stack.is_empty() {
        return invalid("A subgraph is never closed with end");
    }
    // A subgraph that holds nothing has nothing to draw.
    let holders: Vec<String> = p
        .spec
        .nodes
        .iter()
        .filter_map(|n| n.group.clone())
        .chain(p.spec.groups.iter().filter_map(|g| g.group.clone()))
        .collect();
    let empty: Vec<String> = p
        .spec
        .groups
        .iter()
        .filter(|g| !holders.contains(&g.id))
        .map(|g| g.id.clone())
        .collect();
    if !empty.is_empty() {
        p.spec.groups.retain(|g| !empty.contains(&g.id));
        p.ignored.push(format!(
            "Empty subgraphs ({}) are not drawn",
            empty.join(", ")
        ));
    }
    Ok(Parsed {
        spec: p.spec,
        ignored: p.ignored,
    })
}
