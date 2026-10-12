//! The frame of a page's Markdown: its frontmatter, its fingerprint, and its sections.

use super::PageSection;
use super::inline::runs;
use super::lines::heading_of;
use crate::markdown::{fence_closes, fence_open};
use crate::model::Run;

/// The page's body: without a byte order mark or the frontmatter block at its top (a line that is `---`, up to the next one).
/// A block that is not closed is no frontmatter, so the whole text is the body.
pub fn strip_frontmatter(markdown: &str) -> &str {
    let text = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let Some(first) = text.split_inclusive('\n').next() else {
        return text;
    };
    if first.trim_end() != "---" {
        return text;
    }
    let mut offset = first.len();
    for line in text[offset..].split_inclusive('\n') {
        offset += line.len();
        if line.trim_end() == "---" {
            return &text[offset..];
        }
    }
    text
}

/// A fingerprint of Markdown for telling whether it changed: the same for the same words however the lines end, and
/// not changed by blank space at the end. 16 hex digits of FNV-1a.
pub fn fingerprint(markdown: &str) -> String {
    let text = markdown.replace("\r\n", "\n");
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.trim_end().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The words of some runs, without their marks.
pub fn plain(runs: &[Run]) -> String {
    runs.iter().map(|r| r.t.as_str()).collect()
}

/// Every heading of a page with what lies under it, up to the next heading at its level or above. A `#` in fenced code is no heading.
pub fn sections(markdown: &str) -> Vec<PageSection> {
    let body = strip_frontmatter(markdown);
    let lines: Vec<&str> = body.lines().collect();
    let mut found: Vec<PageSection> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for (n, line) in lines.iter().enumerate() {
        if let Some((ch, len)) = fence {
            if fence_closes(line, ch, len) {
                fence = None;
            }
            continue;
        }
        if let Some(open) = fence_open(line) {
            fence = Some(open);
            continue;
        }
        let Some((level, text)) = heading_of(line) else {
            continue;
        };
        found.push(PageSection {
            heading: text.to_owned(),
            title: plain(&runs(text)),
            level,
            line: n,
            end: lines.len(),
        });
    }
    // A section runs to the next heading at its own level or above; a deeper one inside it is part of it.
    for at in 0..found.len() {
        let level = found[at].level;
        if let Some(next) = found[at + 1..].iter().find(|s| s.level <= level) {
            found[at].end = next.line;
        }
    }
    found
}

/// The Markdown of the section under `heading` (found without regard to case, by the heading as written or without its marks):
/// the heading line and all that follows it up to the next heading at its level or above, without blank lines at the end.
pub fn section_markdown(markdown: &str, heading: &str) -> Option<String> {
    let wanted = heading.trim().to_lowercase();
    let body = strip_frontmatter(markdown);
    let lines: Vec<&str> = body.lines().collect();
    let all = sections(markdown);
    let section = all
        .iter()
        .find(|s| s.heading.trim().to_lowercase() == wanted)
        .or_else(|| all.iter().find(|s| s.title.trim().to_lowercase() == wanted))?;
    Some(
        lines[section.line..section.end.min(lines.len())]
            .join("\n")
            .trim_end()
            .to_owned(),
    )
}
