//! What the index keeps from a note's body: links, headings, to-dos with
//! their dates, a readable excerpt for cards, and a word count. A line
//! scanner that knows code fences and code spans, so examples in code never
//! count as links or tasks.

pub use crate::dates::due_date;
use crate::dates::{due_at, is_real_day, time_after};
pub use crate::readable::readable;
use crate::readable::{inline_text, window};

/// A `[[link]]` or `![[embed]]` in the body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    /// The linked title as written, without `#heading` or `|alias`.
    pub target: String,
    pub embed: bool,
    /// Line number in the body, from 0.
    pub line: usize,
    /// The line, as readable text, for backlink snippets.
    pub context: String,
    /// For a link to a real day, the time (`HH:MM`) that directly follows it.
    pub at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub line: usize,
}

/// A `- [ ] to-do` line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub done: bool,
    pub text: String,
    pub line: usize,
    /// The first day the task mentions: `[[2026-10-01]]`, `@2026-10-01` or `📅 2026-10-01`.
    pub due: Option<String>,
    /// The time (`HH:MM`) that directly follows that day link or `@date`.
    pub at: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Extract {
    pub links: Vec<Link>,
    pub headings: Vec<Heading>,
    pub tasks: Vec<Task>,
    /// The first readable text, for card previews.
    pub excerpt: String,
    pub words: u32,
}

const EXCERPT_CHARS: usize = 220;

pub fn extract(body: &str) -> Extract {
    extract_titled(body, None)
}

/// Like `extract`, for a note titled `title`: a first line that only
/// repeats the title (as captures once did, or an `# Title` heading) stays
/// out of the excerpt.
pub fn extract_titled(body: &str, title: Option<&str>) -> Extract {
    let mut out = Extract::default();
    let mut repeat = title.map(str::trim).filter(|t| !t.is_empty());
    let mut fence: Option<(char, usize)> = None;
    let mut excerpt = String::new();
    let mut excerpt_chars = 0;
    // Inside a `$$` block: equations stay out of the excerpt.
    let mut math = false;
    for (i, raw) in body.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        out.words += count_words(line);
        let (after, marker) = fence_after(fence, line);
        fence = after;
        if marker || fence.is_some() {
            continue;
        }
        let has_link = line.contains("[[");
        let maybe_task = line.contains("] ") || line.ends_with(']');
        let code_free: std::borrow::Cow<str> = if (has_link || maybe_task) && line.contains('`') {
            std::borrow::Cow::Owned(without_code_spans(line))
        } else {
            std::borrow::Cow::Borrowed(line)
        };
        if has_link {
            let refs = wiki_refs(&code_free);
            if !refs.is_empty() {
                let context: String = readable(window(line, 800)).chars().take(200).collect();
                for found in refs {
                    let at = is_real_day(&found.target)
                        .then(|| time_after(&code_free[found.end..]))
                        .flatten();
                    out.links.push(Link {
                        target: found.target,
                        embed: found.embed,
                        line: i,
                        context: context.clone(),
                        at,
                    });
                }
            }
        }
        if line.trim_start().starts_with('#')
            && let Some(heading) = heading(line, i)
        {
            out.headings.push(heading);
        }
        if maybe_task && let Some(task) = task(&code_free, i) {
            out.tasks.push(task);
        }
        let trimmed = line.trim();
        let math_line = math || trimmed.starts_with("$$");
        if trimmed == "$$" {
            math = !math;
        } else if trimmed.starts_with("$$") && !(trimmed.len() > 2 && trimmed.ends_with("$$")) {
            math = true;
        } else if math && trimmed.ends_with("$$") {
            math = false;
        }
        // Tables and equations read badly as a line of text.
        let prose = !math_line && !trimmed.starts_with('|');
        if prose && excerpt_chars < EXCERPT_CHARS && !trimmed.is_empty() && !is_html_only(line) {
            // The excerpt needs a few hundred characters at most.
            let text = readable(window(line, 4 * EXCERPT_CHARS));
            // Only the first line with text can repeat the title.
            if !text.is_empty() && repeat.take().is_some_and(|t| t == text) {
                continue;
            }
            if !text.is_empty() {
                if !excerpt.is_empty() {
                    excerpt.push(' ');
                }
                excerpt_chars += text.chars().count() + 1;
                excerpt.push_str(&text);
            }
        }
    }
    out.excerpt = truncate(&excerpt, EXCERPT_CHARS);
    out
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let cut: String = text.chars().take(max).collect();
    let cut = cut
        .rsplit_once(' ')
        .map_or(cut.as_str(), |(head, _)| head)
        .trim_end();
    format!("{cut}…")
}

fn is_html_only(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('<') && t.ends_with('>') && !t.contains("</u>") && !t.contains("</span>")
}

/// A fence opener or closer: the character and run length.
/// A line read against the code fence open before it: the fence open
/// after it, and whether the line opened or closed one. A fence closes on
/// a line of its character, at least as long, with nothing else on it.
pub(crate) fn fence_after(
    fence: Option<(char, usize)>,
    line: &str,
) -> (Option<(char, usize)>, bool) {
    let Some(marker) = fence_marker(line) else {
        return (fence, false);
    };
    let after = match fence {
        None => Some(marker),
        Some((c, n)) if c == marker.0 && marker.1 >= n && line.trim().len() == marker.1 => None,
        open => open,
    };
    (after, true)
}

fn fence_marker(line: &str) -> Option<(char, usize)> {
    let t = line.trim_start();
    if line.len() - t.len() > 3 {
        return None;
    }
    let c = t.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = t.chars().take_while(|&x| x == c).count();
    (n >= 3).then_some((c, n))
}

/// The line with `code spans` blanked out.
pub(crate) fn without_code_spans(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_code = false;
    for c in line.chars() {
        if c == '`' {
            in_code = !in_code;
            out.push(' ');
        } else {
            out.push(if in_code { ' ' } else { c });
        }
    }
    out
}

/// A link found in a line, with where it ends.
pub(crate) struct WikiRef {
    pub target: String,
    pub embed: bool,
    /// Byte offset in the line just after the closing `]]`.
    pub end: usize,
}

/// Link targets in a line: `[[Title]]`, `[[Title#Heading|alias]]`, `![[Title]]`.
pub fn wiki_targets(line: &str) -> Vec<(String, bool)> {
    wiki_refs(line)
        .into_iter()
        .map(|found| (found.target, found.embed))
        .collect()
}

/// `wiki_targets`, with the byte offset after each link, so the text that
/// follows a link can be read.
pub(crate) fn wiki_refs(line: &str) -> Vec<WikiRef> {
    let mut out = Vec::new();
    let mut rest = line;
    let mut offset = 0;
    while let Some(start) = rest.find("[[") {
        let at = offset + start;
        let escaped = at > 0 && line.as_bytes()[at - 1] == b'\\';
        let embed = at > 0 && line.as_bytes()[at - 1] == b'!';
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let inner = &after[..end];
        let used = start + 2 + end + 2;
        if !escaped && !inner.is_empty() && !inner.contains('[') {
            let target = inner.split('|').next().unwrap_or(inner);
            let title = target.split('#').next().unwrap_or(target).trim();
            if !title.is_empty() {
                out.push(WikiRef {
                    target: title.to_owned(),
                    embed,
                    end: offset + used,
                });
            }
        }
        offset += used;
        rest = &rest[used..];
    }
    out
}

fn heading(line: &str, i: usize) -> Option<Heading> {
    let t = line.trim_start();
    if line.len() - t.len() > 3 {
        return None;
    }
    let level = t.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = &t[level..];
    if !(rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t')) {
        return None;
    }
    // Only inline marks: "## 4. Evaluation" keeps its number.
    let text = inline_text(rest.trim().trim_end_matches('#').trim());
    (!text.is_empty()).then_some(Heading {
        level: level as u8,
        text,
        line: i,
    })
}

fn task(line: &str, i: usize) -> Option<Task> {
    let t = line.trim_start();
    let marker = t.split_once(' ')?.0;
    // Checked without slicing: a first word may end in any letter.
    let numbered = marker
        .strip_suffix(['.', ')'])
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    let listed = matches!(marker, "-" | "*" | "+") || numbered;
    if !listed {
        return None;
    }
    let rest = t[marker.len()..].trim_start();
    let done = match rest.get(..3)? {
        "[ ]" => false,
        "[x]" | "[X]" => true,
        _ => return None,
    };
    let text = rest[3..].trim();
    let (due, at) = match due_at(text) {
        Some((day, at)) => (Some(day), at),
        None => (None, None),
    };
    Some(Task {
        done,
        text: readable(text),
        line: i,
        due,
        at,
    })
}

/// Words in a line of Markdown, in one pass: runs of letters and digits
/// (with inner apostrophes), outside HTML tags.
fn count_words(text: &str) -> u32 {
    let mut words = 0;
    let mut in_word = false;
    let mut in_tag = false;
    let mut prev = ' ';
    for c in text.chars() {
        if in_tag {
            in_tag = c != '>';
            prev = c;
            continue;
        }
        if c == '<' {
            in_tag = true;
            in_word = false;
        } else if c.is_alphanumeric() {
            if !in_word {
                words += 1;
                in_word = true;
            }
        } else if !((c == '\'' || c == '’') && prev.is_alphanumeric()) {
            in_word = false;
        }
        prev = c;
    }
    words
}

#[cfg(test)]
#[path = "extract_tests.rs"]
mod tests;
