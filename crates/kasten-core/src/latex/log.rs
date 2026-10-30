//! A tolerant reader for what TeX (and Tectonic, and latexmk around them)
//! print: errors, warnings and box complaints, each with the file and line it
//! belongs to. TeX opens a file with `(name` and closes it with `)`, wraps
//! its output at 79 columns, and puts the line of an error in a context line
//! `l.<n>`; the file stack is rebuilt from the parentheses. Logs come from
//! many versions and can be cut short, so nothing here may panic or fail:
//! whatever cannot be understood is left out.

use serde::Serialize;

use super::log_text::{
    MAX_MESSAGE, clean_file, context_number, continuation, file_token, is_box_message, is_chatter,
    is_context_line, is_diag_start, is_tex_banner, number_after, skip_to, split_file_line,
    split_head, strip_head, tidy,
};

/// How far TeX prints before it breaks a line.
const WRAP: usize = 79;
const MAX_DIAGNOSTICS: usize = 2000;
const MAX_STACK: usize = 512;
/// How many lines after `! error` to look for the `l.<n>` context line.
const CONTEXT_REACH: usize = 40;
/// How many lines of a box dump to skip after `Overfull`.
const BOX_REACH: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    /// Overfull and underfull boxes: worth knowing, rarely worth fixing.
    Info,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    /// The source file, as TeX named it without a leading `./`.
    pub file: Option<String>,
    pub line: Option<u32>,
    pub severity: Severity,
    pub message: String,
}

struct Entry {
    diagnostic: Diagnostic,
    /// False for BibTeX's, which a later TeX run does not make stale.
    from_tex: bool,
}

/// The diagnostics in log `bytes` (not necessarily UTF-8).
pub fn parse_log_bytes(bytes: &[u8]) -> Vec<Diagnostic> {
    parse_log(&String::from_utf8_lossy(bytes))
}

/// The diagnostics in `text`, in the order the log gives them. When the log
/// holds several TeX runs (latexmk), only the last run's are kept.
pub fn parse_log(text: &str) -> Vec<Diagnostic> {
    let lines = unwrap_lines(text);
    let mut reader = Reader {
        lines: &lines,
        at: 0,
        stack: Vec::new(),
        out: Vec::new(),
        counts: [0; 3],
        tex_entries: 0,
        open: false,
    };
    reader.run();
    reader.finish()
}

/// Joins the lines TeX broke at 79 columns back into one.
fn unwrap_lines(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        current.push_str(raw);
        if raw.len() != WRAP {
            lines.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

struct Reader<'a> {
    lines: &'a [String],
    at: usize,
    /// One entry per open parenthesis: the file it opened, if it was one.
    stack: Vec<Option<String>>,
    out: Vec<Entry>,
    /// How many of `out` there are of each severity.
    counts: [usize; 3],
    /// How many of `out` came from TeX itself (not BibTeX).
    tex_entries: usize,
    /// The last entry may be continued by `(package)  more` lines.
    open: bool,
}

impl Reader<'_> {
    fn run(&mut self) {
        let lines = self.lines;
        while self.at < lines.len() {
            let line = lines[self.at].trim_end();
            self.at += 1;
            self.read(line);
        }
    }

    fn read(&mut self, line: &str) {
        if line.trim().is_empty() {
            self.open = false;
            return;
        }
        if is_tex_banner(line) {
            self.forget_tex_run();
            self.stack.clear();
            self.open = false;
            return;
        }
        if is_chatter(line) || line.starts_with("note: ") {
            return;
        }
        if let Some(rest) = line.strip_prefix("error: ") {
            self.runner_message(Severity::Error, rest);
            return;
        }
        if let Some(rest) = line.strip_prefix("warning: ") {
            self.runner_message(Severity::Warning, rest);
            return;
        }
        self.read_tex(line);
    }

    /// The lines of TeX's own output.
    fn read_tex(&mut self, line: &str) {
        if let Some(rest) = line.strip_prefix('!') {
            self.open = false;
            self.tex_error(rest.trim());
            return;
        }
        let more = if self.open { continuation(line) } else { None };
        if let Some(more) = more {
            self.append(more);
            return;
        }
        self.open = false;
        if matches!(split_head(line), Some((_, true, _))) {
            let file = self.here();
            self.push(Severity::Warning, file, None, line, true);
            self.open = true;
        } else if is_box_message(line) {
            self.boxed(line);
        } else if line.starts_with("Missing character:") || line.starts_with("pdfTeX warning") {
            let file = self.here();
            self.push(Severity::Warning, file, None, line, true);
        } else if let Some(message) = line.strip_prefix("Warning--") {
            self.push(Severity::Warning, None, None, message, false);
        } else if line.starts_with("Runaway ") {
            self.at += 1; // the runaway text may hold any parentheses
        } else if line.starts_with("LaTeX ")
            || line.starts_with("Package ")
            || line.starts_with("Class ")
            || is_context_line(line)
        {
            // an info line or the context of a message: nothing to report,
            // and no files in it (its parentheses are the document's)
        } else if let Some((file, number, message)) = split_file_line(line) {
            self.push(
                Severity::Error,
                Some(clean_file(file)),
                Some(number),
                message,
                true,
            );
            let (_, next) = self.context(self.at);
            self.at = next;
        } else {
            self.scan(line);
        }
    }

    /// `! message` and the context lines after it.
    fn tex_error(&mut self, message: &str) {
        if message.is_empty() {
            return;
        }
        // a package's error goes on in `(package)  more` lines
        let mut message = message.to_owned();
        while message.len() < MAX_MESSAGE * 4 {
            let more = self
                .lines
                .get(self.at)
                .and_then(|l| continuation(l.trim_end()));
            let Some(more) = more else { break };
            message.push(' ');
            message.push_str(more);
            self.at += 1;
        }
        let message = message.as_str();
        let (line, next) = self.context(self.at);
        self.at = next;
        let file = self.here();
        // "! Emergency stop." follows the error that caused it, and is the
        // one that names the line when the first could not.
        if message.starts_with("Emergency stop") && self.merge_into_last_error(line) {
            return;
        }
        self.push(Severity::Error, file, line, message, true);
    }

    /// Gives `line` to the error just before, when it is the same problem.
    fn merge_into_last_error(&mut self, line: Option<u32>) -> bool {
        let Some(last) = self.out.last_mut() else {
            return false;
        };
        let d = &mut last.diagnostic;
        let same = d.line.is_none() || line.is_none() || d.line == line;
        if d.severity != Severity::Error || !same {
            return false;
        }
        d.line = d.line.or(line);
        true
    }

    /// `error: file:line: message` and `warning: ...` of Tectonic.
    fn runner_message(&mut self, severity: Severity, rest: &str) {
        if rest.starts_with("warnings were issued by the TeX engine") {
            return;
        }
        let (line, next) = if severity == Severity::Error {
            self.context(self.at)
        } else {
            (None, self.at)
        };
        self.at = next;
        match split_file_line(rest) {
            Some((file, number, message)) => {
                let severity = if is_box_message(message) {
                    Severity::Info
                } else {
                    severity
                };
                self.push(
                    severity,
                    Some(clean_file(file)),
                    Some(number),
                    message,
                    true,
                );
            }
            None => self.push(severity, None, line, rest, true),
        }
    }

    /// An overfull or underfull box: the line is where its paragraph began.
    fn boxed(&mut self, line: &str) {
        let number = number_after(line, "lines ").or_else(|| number_after(line, "at line "));
        let file = self.here();
        self.push(Severity::Info, file, number, line, true);
        let mut skipped = 0;
        while self.at < self.lines.len() && skipped < BOX_REACH {
            let next = self.lines[self.at].as_str();
            if next.trim().is_empty() || is_diag_start(next) || is_tex_banner(next) {
                break;
            }
            self.at += 1;
            skipped += 1; // the dump of the box
        }
    }

    /// The line number of the `l.<n>` context line after an error that starts
    /// at `start`, and where reading goes on (after the context).
    fn context(&self, start: usize) -> (Option<u32>, usize) {
        let end = (start + CONTEXT_REACH).min(self.lines.len());
        for (j, line) in self.lines.iter().enumerate().take(end).skip(start) {
            let line = line.as_str();
            if line.starts_with('!') || is_diag_start(line) || is_tex_banner(line) {
                break;
            }
            if let Some(number) = context_number(line) {
                let more = self.lines.get(j + 1).is_some_and(|l| l.starts_with(' '));
                return (Some(number), j + 1 + usize::from(more));
            }
        }
        (None, start)
    }

    /// Follows the parentheses of an ordinary line through the file stack.
    fn scan(&mut self, text: &str) {
        let bytes = text.as_bytes();
        let mut k = 0;
        while k < bytes.len() {
            match bytes[k] {
                b'(' => {
                    let (file, used) = file_token(&text[k + 1..]);
                    if self.stack.len() < MAX_STACK {
                        self.stack.push(file);
                    }
                    k += used;
                }
                b')' => {
                    self.stack.pop();
                }
                b'{' => k = skip_to(bytes, k, b'}'),
                b'<' => k = skip_to(bytes, k, b'>'),
                _ => {}
            }
            k += 1;
        }
    }

    fn here(&self) -> Option<String> {
        self.stack.iter().rev().find_map(Clone::clone)
    }

    fn push(
        &mut self,
        severity: Severity,
        file: Option<String>,
        line: Option<u32>,
        message: &str,
        from_tex: bool,
    ) {
        // each kind has its own room: thousands of box complaints must not
        // push the one error after them out
        let slot = severity as usize;
        if self.counts[slot] >= MAX_DIAGNOSTICS {
            return;
        }
        self.counts[slot] += 1;
        self.tex_entries += usize::from(from_tex);
        let mut message = strip_head(message);
        if let Some((end, _)) = message.char_indices().nth(MAX_MESSAGE * 4) {
            message.truncate(end); // a 10 MB line is not kept whole
        }
        self.out.push(Entry {
            diagnostic: Diagnostic {
                file,
                line,
                severity,
                message,
            },
            from_tex,
        });
    }

    /// Forgets the diagnostics of the TeX run before a new one.
    fn forget_tex_run(&mut self) {
        if self.tex_entries == 0 {
            return; // many banners in a row must not cost a walk each
        }
        self.tex_entries = 0;
        self.out.retain(|e| !e.from_tex);
        self.counts = [0; 3];
        for e in &self.out {
            self.counts[e.diagnostic.severity as usize] += 1;
        }
    }

    fn append(&mut self, more: &str) {
        if let Some(last) = self.out.last_mut() {
            let message = &mut last.diagnostic.message;
            if message.len() < MAX_MESSAGE * 4 {
                message.push(' ');
                message.push_str(more);
            }
        }
    }

    fn finish(self) -> Vec<Diagnostic> {
        self.out
            .into_iter()
            .filter_map(|entry| {
                let mut d = entry.diagnostic;
                tidy(&mut d);
                (!d.message.is_empty()).then_some(d)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reader's own cases live with the app's build tests; this keeps the
    /// moved reader honest where it now lives.
    #[test]
    fn an_error_with_its_file_and_line_and_nothing_else_is_read() {
        let log = "(./main.tex\n! Undefined control sequence.\nl.12 \\sectoin\n             {Introduction}\n?\n) \n";
        let found = parse_log(log);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].severity, Severity::Error);
        assert_eq!(found[0].file.as_deref(), Some("main.tex"));
        assert_eq!(found[0].line, Some(12));
        assert!(parse_log("").is_empty());
        assert!(parse_log_bytes(&[0xff, 0xfe, b'\n']).is_empty());
    }
}
