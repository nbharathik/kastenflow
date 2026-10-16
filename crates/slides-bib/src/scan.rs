//! The span scanner. It walks a BibTeX text once and says where everything is:
//! each entry, `@string`, `@comment` and `@preamble`, with the places of an
//! entry's key and of every field's name and value, and the text between them.
//! The spans follow one another without a gap, so putting their texts together
//! gives the input back, byte for byte. That is what lets an editor change one
//! value of one entry and leave every other byte alone.
//!
//! The scanner is as tolerant as the reader built on it: odd spacing, a missing
//! comma, an entry that never closes (the next line that starts an entry ends
//! it), and nothing recurses, panics or reads without limit, so any text at all
//! is safe to give it.

use std::ops::Range;

/// The most bytes of a text that are scanned, and the most entries taken from it.
/// What lies beyond the limit is one span of text.
pub const MOST_BYTES: usize = 8 * 1024 * 1024;
pub const MOST_ENTRIES: usize = 20_000;

/// What a span is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `@article{key, field = value, ...}` and the other types of entry.
    Entry,
    /// `@string{name = value}`: a macro.
    String,
    Comment,
    Preamble,
    /// Whatever lies between the others: blank lines, `%` lines, stray words.
    Text,
}

/// What a piece of a field's value is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PieceKind {
    /// `{...}`, braces balanced inside.
    Braced,
    /// `"..."`, a quote inside braces not ending it.
    Quoted,
    /// A number or the name of a macro.
    Word,
}

/// One piece of a value; a value is pieces joined by `#`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Piece {
    pub kind: PieceKind,
    /// The text of the piece: inside the delimiters of a braced or quoted piece.
    pub text: Range<usize>,
}

/// A field of an entry: `name = value`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FieldSpan {
    /// The name in lower case.
    pub name: String,
    /// Where the name is written.
    pub name_at: Range<usize>,
    /// From the first byte of the name to the last of the value.
    pub whole: Range<usize>,
    /// The value as written, delimiters included; empty when the field has none.
    pub value: Range<usize>,
    /// Inside the braces or quotes, when the value is exactly one braced or quoted
    /// piece that was closed.
    pub inner: Option<Range<usize>>,
    pub pieces: Vec<Piece>,
    /// False when the value was cut short by the end or by the line of the next entry.
    pub complete: bool,
}

/// One stretch of the text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub kind: Kind,
    /// The bytes of the span; the spans' ranges follow one another from 0 to the end.
    pub whole: Range<usize>,
    /// The word after the `@`, as written (`Article`); empty for text.
    pub name: Range<usize>,
    /// The key of an entry, or the name of a macro.
    pub key: Option<Range<usize>>,
    /// The fields of an entry; for a macro, its one field.
    pub fields: Vec<FieldSpan>,
    /// Whether the closing brace or parenthesis was read.
    pub closed: bool,
}

fn slice<'a>(text: &'a str, range: &Range<usize>) -> &'a str {
    text.get(range.clone()).unwrap_or("")
}

impl Span {
    /// The text of the span.
    pub fn text<'a>(&self, text: &'a str) -> &'a str {
        slice(text, &self.whole)
    }

    /// The key of an entry as written.
    pub fn key_in<'a>(&self, text: &'a str) -> Option<&'a str> {
        self.key.as_ref().map(|key| slice(text, key))
    }

    /// The type of an entry in lower case (`article`).
    pub fn type_in(&self, text: &str) -> String {
        slice(text, &self.name).to_ascii_lowercase()
    }

    /// The first field called `name` (lower case).
    pub fn field(&self, name: &str) -> Option<&FieldSpan> {
        self.fields.iter().find(|f| f.name == name)
    }
}

impl FieldSpan {
    /// The value as written, delimiters included.
    pub fn value_in<'a>(&self, text: &'a str) -> &'a str {
        slice(text, &self.value)
    }
}

/// The largest prefix of `text` that is at most `max` bytes and ends between characters.
pub(crate) fn cut(text: &str, max: usize) -> &str {
    let mut end = max.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn is_blank(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

/// A byte that ends a key or a macro name.
fn ends_word(byte: u8) -> bool {
    is_blank(byte) || matches!(byte, b',' | b'}' | b')' | b'{' | b'(' | b'"' | b'#' | b'=')
}

fn in_field_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b':' | b'.')
}

struct Reader<'a> {
    text: &'a str,
    bytes: &'a [u8],
    at: usize,
    /// Set when a closing brace or parenthesis is read.
    closed: bool,
}

/// A value read: its pieces, whether it was cut short, and its place.
struct Value {
    pieces: Vec<Piece>,
    broken: bool,
    range: Range<usize>,
}

impl<'a> Reader<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn skip_blank(&mut self) {
        while self.peek().is_some_and(is_blank) {
            self.at += 1;
        }
    }

    /// Where the text ends, never past it.
    fn here(&self) -> usize {
        self.at.min(self.bytes.len())
    }

    /// Whether an entry begins at the `@` at `at`: letters, then a brace or a parenthesis.
    fn entry_begins(&self, at: usize) -> bool {
        let mut i = at + 1;
        let first = i;
        while self.bytes.get(i).is_some_and(u8::is_ascii_alphabetic) {
            i += 1;
        }
        if i == first {
            return false;
        }
        while self.bytes.get(i).copied().is_some_and(is_blank) {
            i += 1;
        }
        matches!(self.bytes.get(i), Some(b'{' | b'('))
    }

    /// Whether a line that starts an entry begins after the newline at `at`: the sign
    /// that a value never closed and the next entry has begun.
    fn new_entry_after(&self, at: usize) -> bool {
        self.bytes.get(at + 1) == Some(&b'@') && self.entry_begins(at + 1)
    }

    /// Moves to just after the next `@`, or to the end.
    fn find_at(&mut self) -> bool {
        let rest = self.bytes.get(self.at..).unwrap_or_default();
        match rest.iter().position(|b| *b == b'@') {
            Some(offset) => {
                self.at += offset + 1;
                true
            }
            None => {
                self.at = self.bytes.len();
                false
            }
        }
    }

    /// Reads a group whose opening brace has been read; returns the text inside it and
    /// whether it was cut short by the end or by the next entry.
    fn braced(&mut self) -> (Range<usize>, bool) {
        let start = self.at;
        let mut depth = 1usize;
        while let Some(byte) = self.peek() {
            match byte {
                b'\\' => self.at += 1,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        let inside = start..self.at;
                        self.at += 1;
                        return (inside, false);
                    }
                }
                b'\n' if self.new_entry_after(self.at) => {
                    let inside = start..self.at;
                    self.at += 1;
                    return (inside, true);
                }
                _ => {}
            }
            self.at += 1;
        }
        self.at = self.bytes.len();
        (start.min(self.at)..self.at, true)
    }

    /// Reads a quoted value whose opening quote has been read. Braces protect quotes.
    fn quoted(&mut self) -> (Range<usize>, bool) {
        let start = self.at;
        let mut depth = 0usize;
        while let Some(byte) = self.peek() {
            match byte {
                b'\\' => self.at += 1,
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                b'"' if depth == 0 => {
                    let inside = start..self.at;
                    self.at += 1;
                    return (inside, false);
                }
                b'\n' if self.new_entry_after(self.at) => {
                    let inside = start..self.at;
                    self.at += 1;
                    return (inside, true);
                }
                _ => {}
            }
            self.at += 1;
        }
        self.at = self.bytes.len();
        (start.min(self.at)..self.at, true)
    }

    /// Skips a group opened by `open` (a brace or a parenthesis), which has been read.
    fn skip_group(&mut self, open: u8) {
        if open == b'{' {
            let (_, broken) = self.braced();
            self.closed = !broken;
            return;
        }
        let mut depth = 0usize;
        while let Some(byte) = self.peek() {
            self.at += 1;
            match byte {
                b'\\' => self.at += 1,
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                b')' if depth == 0 => {
                    self.closed = true;
                    return;
                }
                b'\n' if self.new_entry_after(self.at - 1) => return,
                _ => {}
            }
        }
        self.at = self.bytes.len();
    }

    fn name(&mut self) -> Range<usize> {
        let start = self.at;
        while self.peek().is_some_and(|b| !ends_word(b)) {
            self.at += 1;
        }
        start..self.at
    }

    /// A field's value: braces, quotes, a number or a macro, joined by `#`.
    fn value(&mut self) -> Value {
        self.skip_blank();
        let start = self.at;
        let mut end = start;
        let mut pieces = Vec::new();
        let mut broken = false;
        loop {
            self.skip_blank();
            let (piece, outer_end) = match self.peek() {
                Some(b'{') => {
                    self.at += 1;
                    let (inside, cut_short) = self.braced();
                    broken = cut_short;
                    let outer = if cut_short {
                        inside.end
                    } else {
                        inside.end + 1
                    };
                    (
                        Piece {
                            kind: PieceKind::Braced,
                            text: inside,
                        },
                        outer,
                    )
                }
                Some(b'"') => {
                    self.at += 1;
                    let (inside, cut_short) = self.quoted();
                    broken = cut_short;
                    let outer = if cut_short {
                        inside.end
                    } else {
                        inside.end + 1
                    };
                    (
                        Piece {
                            kind: PieceKind::Quoted,
                            text: inside,
                        },
                        outer,
                    )
                }
                Some(byte) if !ends_word(byte) => {
                    let word = self.name();
                    let outer = word.end;
                    (
                        Piece {
                            kind: PieceKind::Word,
                            text: word,
                        },
                        outer,
                    )
                }
                _ => break,
            };
            end = outer_end;
            pieces.push(piece);
            if broken {
                break;
            }
            self.skip_blank();
            if self.peek() == Some(b'#') {
                self.at += 1;
            } else {
                break;
            }
        }
        Value {
            pieces,
            broken,
            range: start..end,
        }
    }

    /// The field whose name has been read, its `=` too, and the value after it.
    fn field(&mut self, name_at: Range<usize>) -> (FieldSpan, bool) {
        let value = self.value();
        let single = match value.pieces.as_slice() {
            [piece] if piece.kind != PieceKind::Word && !value.broken => Some(piece.text.clone()),
            _ => None,
        };
        let name = self.text[name_at.clone()].to_ascii_lowercase();
        let field = FieldSpan {
            name,
            whole: name_at.start..value.range.end,
            name_at,
            value: value.range,
            inner: single,
            pieces: value.pieces,
            complete: !value.broken,
        };
        (field, value.broken)
    }

    /// After what an entry read, skips to its closing delimiter.
    fn skip_rest(&mut self) {
        while let Some(byte) = self.peek() {
            match byte {
                b'}' | b')' => {
                    self.at += 1;
                    self.closed = true;
                    return;
                }
                b'@' => return,
                b'\\' => self.at += 2,
                b'{' => {
                    self.at += 1;
                    self.braced();
                }
                _ => self.at += 1,
            }
        }
        self.at = self.bytes.len();
    }

    /// `@string{name = value}`, after its opening delimiter.
    fn string(&mut self, sign: usize, name: Range<usize>) -> Span {
        self.skip_blank();
        let macro_name = self.name();
        self.skip_blank();
        let mut fields = Vec::new();
        if !macro_name.is_empty() && self.peek() == Some(b'=') {
            self.at += 1;
            let (field, _) = self.field(macro_name.clone());
            if !field.pieces.is_empty() {
                fields.push(field);
            }
        }
        self.skip_rest();
        Span {
            kind: Kind::String,
            whole: sign..self.here(),
            name,
            key: Some(macro_name),
            fields,
            closed: self.closed,
        }
    }

    /// The fields of an entry whose key has been read, up to its closing delimiter.
    /// Gives them and where the entry ends.
    fn fields(&mut self, key_end: usize) -> (Vec<FieldSpan>, usize) {
        let mut fields = Vec::new();
        let mut last = key_end;
        loop {
            self.skip_blank();
            match self.peek() {
                None | Some(b'@') => break,
                Some(b',') => {
                    self.at += 1;
                    continue;
                }
                Some(b'}' | b')') => {
                    self.at += 1;
                    self.closed = true;
                    return (fields, self.here());
                }
                _ => {}
            }
            let start = self.at;
            while self.peek().is_some_and(in_field_name) {
                self.at += 1;
            }
            if self.at == start {
                break;
            }
            let name_at = start..self.at;
            self.skip_blank();
            if self.peek() != Some(b'=') {
                break;
            }
            self.at += 1;
            let (field, broken) = self.field(name_at);
            last = last.max(field.whole.end);
            fields.push(field);
            if broken {
                break;
            }
        }
        (fields, last)
    }

    /// An entry whose type and opening delimiter have been read.
    fn entry(&mut self, sign: usize, name: Range<usize>) -> Option<Span> {
        self.skip_blank();
        let start = self.at;
        while self.peek().is_some_and(|b| !ends_word(b) || b == b'#') {
            self.at += 1;
        }
        let key = start..self.at;
        if key.is_empty() {
            self.skip_rest();
            return None;
        }
        let (fields, end) = self.fields(key.end);
        Some(Span {
            kind: Kind::Entry,
            whole: sign..end,
            name,
            key: Some(key),
            fields,
            closed: self.closed,
        })
    }
}

fn text_span(range: Range<usize>) -> Span {
    Span {
        kind: Kind::Text,
        name: 0..0,
        key: None,
        fields: Vec::new(),
        closed: true,
        whole: range,
    }
}

/// The spans of `text`, from its first byte to its last.
pub fn scan(text: &str) -> Vec<Span> {
    let parsed = cut(text, MOST_BYTES);
    let mut reader = Reader {
        text: parsed,
        bytes: parsed.as_bytes(),
        at: 0,
        closed: false,
    };
    let mut spans: Vec<Span> = Vec::new();
    let mut gap = 0usize;
    let mut entries = 0usize;
    while entries < MOST_ENTRIES && reader.find_at() {
        let sign = reader.at - 1;
        reader.skip_blank();
        let start = reader.at;
        while reader.peek().is_some_and(|b| b.is_ascii_alphanumeric()) {
            reader.at += 1;
        }
        if reader.at == start {
            continue;
        }
        let name = start..reader.at;
        let word = parsed[name.clone()].to_ascii_lowercase();
        reader.skip_blank();
        let Some(open @ (b'{' | b'(')) = reader.peek() else {
            continue;
        };
        reader.at += 1;
        reader.closed = false;
        let span = match word.as_str() {
            "comment" | "preamble" => {
                reader.skip_group(open);
                Some(Span {
                    kind: if word == "comment" {
                        Kind::Comment
                    } else {
                        Kind::Preamble
                    },
                    whole: sign..reader.here(),
                    name,
                    key: None,
                    fields: Vec::new(),
                    closed: reader.closed,
                })
            }
            "string" => Some(reader.string(sign, name)),
            _ => reader.entry(sign, name),
        };
        let Some(span) = span else {
            continue;
        };
        if span.kind == Kind::Entry {
            entries += 1;
        }
        if sign > gap {
            spans.push(text_span(gap..sign));
        }
        gap = span.whole.end.max(sign);
        spans.push(span);
    }
    if gap < text.len() {
        spans.push(text_span(gap..text.len()));
    }
    spans
}
