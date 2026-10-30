//! Web addresses and network calls in a smart page's code. A page runs with no
//! network: it loads its own files and reads notes through the kit. These are
//! found by reading the text (no parser), so they are meant to catch what a
//! model writes out of habit, with a line for each and a way to put it right.
//! It is advice: the app's sandbox is what keeps a page off the network, and a
//! page that builds an address from pieces is not seen here.

use std::collections::HashSet;

use super::{Finding, Lines, PER_FILE};

/// Addresses that are only names (XML namespaces), not something to load.
const NAMESPACES: [&str; 1] = ["http://www.w3.org/"];

/// The calls that need a network, with how a page does the same without one;
/// the flag says the name is only a call when a `(` follows.
const CALLS: [(&str, &str, bool); 6] = [
    ("fetch", "fetch()", true),
    ("xmlhttprequest", "XMLHttpRequest", false),
    ("websocket", "WebSocket", false),
    ("eventsource", "EventSource", false),
    ("sendbeacon", "sendBeacon()", false),
    ("importscripts", "importScripts()", true),
];

const HOW: &str = "The page has no network at all (not even for its own files): keep data in the folder as a .js file loaded with a script tag, or read notes with kasten.query(...)";

fn word_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$'
}

/// How the address at `at` is used, from the text before it.
#[derive(PartialEq)]
enum Use {
    /// Something the browser would load: a script, style, picture or frame.
    Loads,
    /// An ordinary link.
    Link,
    /// Only text.
    Text,
}

/// Where the `<` and `>` of a text are, so that asking whether a place is
/// inside a tag is a search and not a walk back through the text.
struct Marks {
    open: Vec<usize>,
    close: Vec<usize>,
}

impl Marks {
    fn new(low: &str) -> Marks {
        let at = |c: u8| -> Vec<usize> {
            low.bytes()
                .enumerate()
                .filter(|(_, b)| *b == c)
                .map(|(i, _)| i)
                .collect()
        };
        Marks {
            open: at(b'<'),
            close: at(b'>'),
        }
    }

    /// The start of the tag the place `at` is inside, if it is inside one.
    fn tag_at(&self, at: usize) -> Option<usize> {
        let open = self.open[..self.open.partition_point(|&p| p < at)].last()?;
        let closed = self.close[..self.close.partition_point(|&p| p < at)].last();
        closed.is_none_or(|c| c < open).then_some(*open)
    }
}

fn use_of(low: &str, marks: &Marks, at: usize) -> Use {
    if let Some(open) = marks.tag_at(at) {
        let name: String = low[open + 1..at]
            .chars()
            .take_while(char::is_ascii_alphanumeric)
            .take(16)
            .collect();
        return if name == "a" { Use::Link } else { Use::Loads };
    }
    let before = &low[..at];
    let t = before.trim_end_matches(['"', '\'', '`', ' ']);
    if ["url(", "@import", "from", "import", "import("]
        .iter()
        .any(|word| t.ends_with(word))
    {
        return Use::Loads;
    }
    Use::Text
}

/// The address at `at`, cut at its end or after 60 characters.
fn shown(text: &str, at: usize) -> String {
    text[at..]
        .chars()
        .take_while(|c| !(c.is_whitespace() || matches!(c, '"' | '\'' | ')' | '>' | '<' | '`')))
        .take(60)
        .collect()
}

/// The findings of one file, at most `PER_FILE`, each place once.
struct Sink<'a> {
    file: &'a str,
    lines: Lines,
    out: Vec<Finding>,
    seen: HashSet<(u32, String)>,
}

impl Sink<'_> {
    fn full(&self) -> bool {
        self.out.len() >= PER_FILE
    }

    fn push(&mut self, severity: &'static str, at: usize, message: String) {
        let line = self.lines.of(at);
        if !self.full() && self.seen.insert((line, message.clone())) {
            self.out
                .push(Finding::new(severity, self.file, Some(line), message));
        }
    }
}

/// What is wrong with the network use of one text file of the page.
pub(super) fn findings(file: &str, text: &str) -> Vec<Finding> {
    let low = text.to_ascii_lowercase();
    let bytes = low.as_bytes();
    let marks = Marks::new(&low);
    let mut sink = Sink {
        file,
        lines: Lines::new(text),
        out: Vec::new(),
        seen: HashSet::new(),
    };
    for scheme in ["https://", "http://", "wss://", "ws://", "ftp://"] {
        let mut from = 0;
        while let Some(found) = low[from..].find(scheme) {
            if sink.full() {
                break;
            }
            let at = from + found;
            from = at + scheme.len();
            // "http://" can sit in "xhttp://" words, and "ws://" in "news://".
            if at > 0 && word_char(bytes[at - 1]) {
                continue;
            }
            if NAMESPACES.iter().any(|ns| low[at..].starts_with(ns)) {
                continue;
            }
            let address = shown(text, at);
            match use_of(&low, &marks, at) {
                Use::Loads => sink.push(
                    "error",
                    at,
                    format!("“{address}” is loaded from the web. {HOW}."),
                ),
                Use::Link => sink.push(
                    "warning",
                    at,
                    format!(
                        "A link to “{address}”: a page cannot open web addresses by itself. Show it as text, or let the person copy it"
                    ),
                ),
                Use::Text => sink.push(
                    "warning",
                    at,
                    format!(
                        "The web address “{address}” is in the code. If the page tries to load it, it will fail: {HOW}"
                    ),
                ),
            }
        }
    }
    // "//host/path" in an attribute or url(...): the page's own scheme, so the web.
    let mut at = 0;
    while let Some(found) = low[at..].find("//") {
        if sink.full() {
            break;
        }
        let pos = at + found;
        at = pos + 2;
        let Some(&prev) = pos.checked_sub(1).map(|p| &bytes[p]) else {
            continue;
        };
        if !matches!(prev, b'"' | b'\'' | b'(' | b'`' | b'=') {
            continue;
        }
        let host: String = low[pos + 2..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
            .take(80)
            .collect();
        if host.contains('.')
            && host
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric())
        {
            sink.push(
                "error",
                pos,
                format!("“//{host}…” is loaded from the web. {HOW}."),
            );
        }
    }
    for (needle, name, needs_call) in CALLS {
        let mut at = 0;
        while let Some(found) = low[at..].find(needle) {
            if sink.full() {
                break;
            }
            let pos = at + found;
            at = pos + needle.len();
            if pos > 0 && word_char(bytes[pos - 1]) {
                continue;
            }
            // "fetch (url)" is a call as much as "fetch(url)"; "fetched" is not.
            let after = low[at..].trim_start_matches([' ', '\t', '\r', '\n']);
            let is_call = after.starts_with('(');
            let is_word = after.as_bytes().first().is_some_and(|b| word_char(*b))
                && at == low.len() - after.len();
            if is_word || (needs_call && !is_call) {
                continue;
            }
            sink.push(
                "error",
                pos,
                format!("{name} needs a network, and a smart page has none. {HOW}."),
            );
        }
    }
    sink.out.sort_by_key(|f| f.line);
    sink.out
}
