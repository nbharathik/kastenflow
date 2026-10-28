//! How many pages a built document has: from what TeX printed ("Output written
//! on main.pdf (3 pages, 41234 bytes)"), else by counting the page objects of
//! the PDF. A PDF that keeps its pages inside compressed object streams cannot
//! be counted this way; then the answer is none, never a guess.

use std::path::Path;

use crate::plugins::latex::collect::{pdf_path, pdf_stamp};
use crate::plugins::latex::snapshot::read_plain;

/// The most of a log read for the count.
const MAX_LOG: u64 = 8 * 1024 * 1024;
/// The most of a PDF read to count its pages.
const MAX_PDF: u64 = 16 * 1024 * 1024;

/// The page count TeX printed at the end of `log`, if it did.
pub fn pages_in_log(log: &str) -> Option<u32> {
    let at = log.rfind("Output written on ")?;
    // A long file name wraps the line, so look a little past it.
    let rest: String = log[at..].chars().take(400).collect();
    let open = rest.find('(')?;
    let after = &rest[open + 1..];
    let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
    let tail = after[digits.len()..].trim_start();
    if tail.starts_with("page") {
        digits.parse().ok().filter(|n| *n > 0)
    } else {
        None
    }
}

/// The number of page objects (`/Type /Page`, not `/Type /Pages`) in `pdf`.
pub fn pages_in_pdf(pdf: &[u8]) -> Option<u32> {
    let mut pages = 0u32;
    let mut i = 0;
    while i < pdf.len() {
        if pdf[i] == b'/' && pdf[i..].starts_with(b"/Type") {
            let mut j = i + 5;
            while j < pdf.len() && pdf[j].is_ascii_whitespace() {
                j += 1;
            }
            if pdf[j..].starts_with(b"/Page") {
                let next = pdf.get(j + 5).copied().unwrap_or(b' ');
                if !next.is_ascii_alphanumeric() {
                    pages += 1;
                }
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    (pages > 0).then_some(pages)
}

/// The pages of the build of `stem` in `out`.
pub fn page_count(out: &Path, stem: &str) -> Option<u32> {
    let log = read_plain(&out.join(format!("{stem}.log")), MAX_LOG)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
    if let Some(n) = log.as_deref().and_then(pages_in_log) {
        return Some(n);
    }
    let pdf = pdf_path(out, stem);
    let (len, _) = pdf_stamp(&pdf)?;
    if len > MAX_PDF {
        return None;
    }
    pages_in_pdf(&read_plain(&pdf, MAX_PDF)?)
}
