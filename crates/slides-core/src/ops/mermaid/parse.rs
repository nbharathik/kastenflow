//! A small reader for Mermaid flowcharts, written here so that no Mermaid library is needed.
//!
//! It understands `flowchart` or `graph` with a direction (`TD`, `TB`, `BT`, `LR`, `RL`), boxes
//! (`A`, `A[text]`, `A(text)`, `A([text])`, `A((text))`, `A{text}`, `A{{text}}`, `A[(text)]`,
//! `A[/text/]`), and arrows (`-->`, `---`, `-.->`, `==>`, with a word as `-->|word|` or
//! `-- word -->`), chained (`A --> B --> C`) or fanned (`A & B --> C`). `subgraph` and `end`
//! lines are skipped and what is inside is drawn as if it stood on its own; `style`, `classDef`,
//! `class`, `click` and `linkStyle` lines are skipped. An arrow from a box to itself is dropped.

use std::collections::HashMap;

use crate::ops::diagram::{DiagramEdge, DiagramNode, Direction};

/// The longest a Mermaid source is, in characters.
pub const MOST_SOURCE: usize = 20_000;

/// A flowchart read from text.
#[derive(Debug)]
pub struct Flow {
    pub direction: Direction,
    pub nodes: Vec<DiagramNode>,
    pub edges: Vec<DiagramEdge>,
}

/// How each kind of bracket draws a box: what opens it, what closes it, and the shape.
const SHAPES: [(&str, &str, &str); 12] = [
    ("(((", ")))", "ellipse"),
    ("((", "))", "ellipse"),
    ("([", "])", "roundRect"),
    ("[(", ")]", "can"),
    ("[[", "]]", "rect"),
    ("[/", "/]", "parallelogram"),
    ("[\\", "\\]", "parallelogram"),
    ("{{", "}}", "hexagon"),
    ("[", "]", "rect"),
    ("(", ")", "roundRect"),
    ("{", "}", "diamond"),
    (">", "]", "rect"),
];

/// The characters an arrow is drawn with.
const ARROW: &str = "-=.<>";

struct Reader {
    chars: Vec<char>,
    at: usize,
}

impl Reader {
    fn new(text: &str) -> Reader {
        Reader {
            chars: text.chars().collect(),
            at: 0,
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.at).copied()
    }

    fn done(&self) -> bool {
        self.at >= self.chars.len()
    }

    fn skip_space(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.at += 1;
        }
    }

    fn matches_at(&self, at: usize, text: &str) -> bool {
        text.chars()
            .enumerate()
            .all(|(i, c)| self.chars.get(at + i) == Some(&c))
    }

    fn starts_with(&self, text: &str) -> bool {
        self.matches_at(self.at, text)
    }

    /// The next few characters, for a message.
    fn rest(&self) -> String {
        self.chars[self.at.min(self.chars.len())..]
            .iter()
            .take(20)
            .collect()
    }

    /// Everything up to `end`, which is read as well; None when `end` never comes.
    fn take_until(&mut self, end: &str) -> Option<String> {
        let mut i = self.at;
        while i < self.chars.len() {
            if self.matches_at(i, end) {
                let text = self.chars[self.at..i].iter().collect();
                self.at = i + end.chars().count();
                return Some(text);
            }
            i += 1;
        }
        None
    }
}

/// The words of a label: line breaks written as `<br/>` become new lines.
fn clean(label: &str) -> String {
    let mut text = label.to_owned();
    for br in ["<br/>", "<br />", "<br>", "<BR/>", "<BR />", "<BR>"] {
        text = text.replace(br, "\n");
    }
    text.split('\n')
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}

/// The statements of a source: one to a line or to a `;`, comments left out.
fn statements(source: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in source.lines() {
        let line = line.trim();
        if line.starts_with("%%") {
            continue;
        }
        let mut current = String::new();
        let mut quoted = false;
        for c in line.chars() {
            match c {
                '"' => {
                    quoted = !quoted;
                    current.push(c);
                }
                ';' if !quoted => out.push(std::mem::take(&mut current)),
                _ => current.push(c),
            }
        }
        out.push(current);
    }
    out.into_iter()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty() && !s.starts_with("%%"))
        .collect()
}

/// Lines that style or group the chart and add no box or arrow.
fn is_decoration(statement: &str) -> bool {
    let word = statement
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    matches!(
        word.as_str(),
        "style"
            | "classdef"
            | "class"
            | "click"
            | "linkstyle"
            | "subgraph"
            | "end"
            | "direction"
            | "acctitle"
            | "accdescr"
            | "title"
    )
}

#[derive(Default)]
struct Graph {
    nodes: Vec<DiagramNode>,
    index: HashMap<String, usize>,
    edges: Vec<DiagramEdge>,
}

impl Graph {
    /// A box named `id`, with the words and shape its brackets gave it, if they did.
    fn declare(&mut self, id: &str, look: Option<(String, &str)>) {
        let (label, shape) = match look {
            Some((label, shape)) => (
                Some(if label.is_empty() {
                    id.to_owned()
                } else {
                    label
                }),
                shape,
            ),
            None => (None, "rect"),
        };
        match self.index.get(id) {
            Some(&i) => {
                if let Some(label) = label {
                    self.nodes[i].label = label;
                    self.nodes[i].shape = Some(shape.to_owned());
                }
            }
            None => {
                self.index.insert(id.to_owned(), self.nodes.len());
                self.nodes.push(DiagramNode {
                    id: id.to_owned(),
                    label: label.unwrap_or_else(|| id.to_owned()),
                    shape: Some(shape.to_owned()),
                    color: None,
                    emphasis: false,
                });
            }
        }
    }
}

fn node(r: &mut Reader, graph: &mut Graph) -> Result<String, String> {
    let start = r.at;
    while r.peek().is_some_and(|c| c.is_alphanumeric() || c == '_') {
        r.at += 1;
    }
    if r.at == start {
        return Err(format!(
            "expected the name of a box where the text reads \"{}\"",
            r.rest()
        ));
    }
    let id: String = r.chars[start..r.at].iter().collect();
    let mut look = None;
    for (open, close, preset) in SHAPES {
        if !r.starts_with(open) {
            continue;
        }
        r.at += open.chars().count();
        let unclosed =
            || format!("the box `{id}` opens with `{open}` and never closes with `{close}`");
        let raw = if r.peek() == Some('"') {
            r.at += 1;
            let quoted = r.take_until("\"").ok_or_else(unclosed)?;
            r.skip_space();
            if !r.starts_with(close) {
                return Err(unclosed());
            }
            r.at += close.chars().count();
            quoted
        } else {
            r.take_until(close).ok_or_else(unclosed)?
        };
        look = Some((clean(&raw), preset));
        break;
    }
    // `A:::name` gives a class, which only styles.
    if r.starts_with(":::") {
        r.at += 3;
        while r
            .peek()
            .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            r.at += 1;
        }
    }
    graph.declare(&id, look);
    Ok(id)
}

fn group(r: &mut Reader, graph: &mut Graph) -> Result<Vec<String>, String> {
    let mut ids = vec![node(r, graph)?];
    loop {
        r.skip_space();
        if r.peek() == Some('&') {
            r.at += 1;
            r.skip_space();
            ids.push(node(r, graph)?);
        } else {
            return Ok(ids);
        }
    }
}

/// An arrow and the word on it, if any.
fn link(r: &mut Reader) -> Result<Option<String>, String> {
    let start = r.at;
    while r.peek().is_some_and(|c| ARROW.contains(c)) {
        r.at += 1;
    }
    let run: String = r.chars[start..r.at].iter().collect();
    let strokes = run.chars().filter(|c| *c == '-' || *c == '=').count();
    if strokes < 2 {
        r.at = start;
        return Err(format!(
            "expected an arrow such as --> where the text reads \"{}\"",
            r.rest()
        ));
    }
    let bare = run.trim_start_matches('<');
    if bare == "--" || bare == "==" {
        // `A -- word --> B`: the word sits between the two halves of the arrow.
        let from = r.at;
        let mut i = from;
        let close = loop {
            if i + 1 >= r.chars.len() {
                return Err("an arrow written as `-- word -->` never gets its end".to_owned());
            }
            if "-=".contains(r.chars[i]) && "-=".contains(r.chars[i + 1]) {
                break i;
            }
            i += 1;
        };
        let word = clean(&r.chars[from..close].iter().collect::<String>());
        r.at = close;
        while r.peek().is_some_and(|c| ARROW.contains(c)) {
            r.at += 1;
        }
        return Ok((!word.is_empty()).then_some(word));
    }
    r.skip_space();
    if r.peek() == Some('|') {
        r.at += 1;
        let word = r
            .take_until("|")
            .ok_or_else(|| "a word on an arrow opens with | and never closes".to_owned())?;
        let word = clean(word.trim_matches('"'));
        return Ok((!word.is_empty()).then_some(word));
    }
    Ok(None)
}

fn chain(text: &str, graph: &mut Graph) -> Result<(), String> {
    let mut r = Reader::new(text);
    let mut left = group(&mut r, graph)?;
    loop {
        r.skip_space();
        if r.done() {
            return Ok(());
        }
        let word = link(&mut r)?;
        r.skip_space();
        let right = group(&mut r, graph)?;
        for from in &left {
            for to in &right {
                if from != to {
                    graph.edges.push(DiagramEdge {
                        from: from.clone(),
                        to: to.clone(),
                        label: word.clone(),
                    });
                }
            }
        }
        left = right;
    }
}

fn direction_of(word: &str) -> Option<Direction> {
    match word.to_uppercase().as_str() {
        "TD" | "TB" | "BT" => Some(Direction::TopDown),
        "LR" | "RL" => Some(Direction::LeftToRight),
        _ => None,
    }
}

/// Reads a flowchart. The error says in words what is wrong and where.
pub fn parse(source: &str) -> Result<Flow, String> {
    if source.chars().count() > MOST_SOURCE {
        return Err(format!(
            "a Mermaid source is at most {MOST_SOURCE} characters; split a bigger chart over several slides"
        ));
    }
    let mut all = statements(source).into_iter();
    let Some(header) = all.next() else {
        return Err(
            "the Mermaid source is empty; start with `flowchart TD` or `flowchart LR`".to_owned(),
        );
    };
    let mut words = header.split_whitespace();
    let kind = words.next().unwrap_or("").to_lowercase();
    if kind != "flowchart" && kind != "graph" {
        return Err(format!(
            "only flowcharts are understood: start with `flowchart TD` or `flowchart LR`, not \"{header}\""
        ));
    }
    let direction = match words.next() {
        None => Direction::TopDown,
        Some(word) => direction_of(word)
            .ok_or_else(|| format!("`{word}` is not a direction; use TD, TB, BT, LR or RL"))?,
    };
    let mut graph = Graph::default();
    for statement in all {
        if is_decoration(&statement) {
            continue;
        }
        chain(&statement, &mut graph).map_err(|m| format!("{m} (in \"{statement}\")"))?;
    }
    if graph.nodes.is_empty() {
        return Err("the flowchart has no boxes".to_owned());
    }
    Ok(Flow {
        direction,
        nodes: graph.nodes,
        edges: graph.edges,
    })
}
