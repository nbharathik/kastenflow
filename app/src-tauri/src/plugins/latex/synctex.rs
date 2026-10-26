//! SyncTeX: which place in the PDF a line of source made, and the other way
//! round. TeX writes `<name>.synctex.gz`: a few lines about the inputs and
//! the units, then for each page the boxes (`[` vertical, `(` horizontal,
//! closed by `]` and `)`) and the loose pieces in them (`v`, `h`, `k`, `g`,
//! `$`, `x`), each tagged with the input file and line it came from. All
//! positions here are in PDF points (big points, 72 to the inch) from the
//! top left of the page, with `y` on the baseline.

use std::fmt;
use std::io::Read;

use flate2::read::GzDecoder;
use serde::Serialize;

use super::synctex_read::read_content;

/// The most a `.synctex.gz` may unpack to.
pub const MAX_UNPACKED: u64 = 64 * 1024 * 1024;
/// A real build names a few hundred inputs (every package and font file).
const MAX_INPUTS: usize = 20_000;
const MAX_HITS: usize = 100;
/// Scaled points (TeX's unit) in a PDF point.
const SP_PER_BP: f64 = 65781.76;
/// How far from every box a click may be and still name a line.
const SLACK_BP: f64 = 36.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncTexError {
    /// No box matches.
    NotFound,
    /// The file unpacks to more than `MAX_UNPACKED`, or holds too many boxes.
    TooLarge,
    /// Not a SyncTeX file (or one this reader cannot follow).
    Format(&'static str),
}

impl fmt::Display for SyncTexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => f.write_str("Nothing in the PDF matches that place"),
            Self::TooLarge => f.write_str("The SyncTeX file is too big to read"),
            Self::Format(why) => write!(f, "The SyncTeX file cannot be read: {why}"),
        }
    }
}

impl std::error::Error for SyncTexError {}

/// A box on a page, in PDF points.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Hit {
    pub page: u32,
    /// Left edge.
    pub x: f64,
    /// Baseline.
    pub y: f64,
    pub width: f64,
    /// Above the baseline.
    pub height: f64,
    /// Below the baseline.
    pub depth: f64,
}

impl Hit {
    pub(super) fn empty(page: u32) -> Self {
        Self {
            page,
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            depth: 0.0,
        }
    }

    pub fn top(&self) -> f64 {
        self.y - self.height
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.depth
    }
}

/// A place in the source, the file named as TeX saw it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Source {
    pub file: String,
    pub line: u32,
}

pub(super) struct Node {
    pub(super) tag: u32,
    pub(super) line: u32,
    /// A box, as opposed to a piece (kern, glue, math) that sits in one.
    pub(super) boxed: bool,
    pub(super) hit: Hit,
}

/// A read `.synctex(.gz)` file.
pub struct SyncTex {
    inputs: Vec<(u32, String)>,
    nodes: Vec<Node>,
}

/// How raw numbers become PDF points.
pub(super) struct Frame {
    pub(super) scale: f64,
    pub(super) x_offset: f64,
    pub(super) y_offset: f64,
}

impl SyncTex {
    /// Reads gzip-compressed SyncTeX, or plain SyncTeX text.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, SyncTexError> {
        Self::from_bytes_limited(bytes, MAX_UNPACKED)
    }

    pub(crate) fn from_bytes_limited(bytes: &[u8], limit: u64) -> Result<Self, SyncTexError> {
        if bytes.starts_with(&[0x1f, 0x8b]) {
            // never read more than one byte past the limit, whatever the
            // file claims to hold (a few KB of gzip can unpack to gigabytes)
            let mut unpacked = Vec::new();
            GzDecoder::new(bytes)
                .take(limit.saturating_add(1))
                .read_to_end(&mut unpacked)
                .map_err(|_| SyncTexError::Format("not a valid gzip file"))?;
            if unpacked.len() as u64 > limit {
                return Err(SyncTexError::TooLarge);
            }
            Self::parse(&String::from_utf8_lossy(&unpacked))
        } else {
            if bytes.len() as u64 > limit {
                return Err(SyncTexError::TooLarge);
            }
            Self::parse(&String::from_utf8_lossy(bytes))
        }
    }

    pub fn parse(text: &str) -> Result<Self, SyncTexError> {
        let mut lines = text.lines();
        if !lines
            .next()
            .is_some_and(|l| l.starts_with("SyncTeX Version:"))
        {
            return Err(SyncTexError::Format("not a SyncTeX file"));
        }
        let mut inputs = Vec::new();
        let (mut unit, mut magnification) = (1.0, 1000.0);
        let (mut x_offset, mut y_offset) = (0.0_f64, 0.0_f64);
        let mut has_content = false;
        for line in lines.by_ref() {
            let line = line.trim_end();
            if line == "Content:" {
                has_content = true;
                break;
            }
            if let Some(rest) = line.strip_prefix("Input:") {
                let named = rest
                    .split_once(':')
                    .and_then(|(tag, name)| Some((tag.trim().parse().ok()?, name.to_owned())));
                inputs.extend(named);
                if inputs.len() > MAX_INPUTS {
                    return Err(SyncTexError::TooLarge);
                }
            } else if let Some(v) = line.strip_prefix("Magnification:") {
                magnification = v.trim().parse().unwrap_or(magnification);
            } else if let Some(v) = line.strip_prefix("Unit:") {
                unit = v.trim().parse().unwrap_or(unit);
            } else if let Some(v) = line.strip_prefix("X Offset:") {
                x_offset = v.trim().parse().unwrap_or(x_offset);
            } else if let Some(v) = line.strip_prefix("Y Offset:") {
                y_offset = v.trim().parse().unwrap_or(y_offset);
            }
        }
        if !has_content {
            return Err(SyncTexError::Format("no content"));
        }
        let scale = unit * magnification / 1000.0 / SP_PER_BP;
        if !(scale.is_finite() && scale > 0.0 && x_offset.is_finite() && y_offset.is_finite()) {
            return Err(SyncTexError::Format("unusable units"));
        }
        let frame = Frame {
            scale,
            x_offset,
            y_offset,
        };
        let nodes = read_content(lines, &frame)?;
        Ok(Self { inputs, nodes })
    }

    /// The input files, with the tag the boxes refer to them by.
    #[cfg(test)]
    pub fn inputs(&self) -> &[(u32, String)] {
        &self.inputs
    }

    /// Where `line` of `file` is on the pages. `file` may be the full path, a
    /// path from the project, or just a name. A line that made no box has
    /// the next line after it that did (else the last before it).
    pub fn forward(&self, file: &str, line: u32) -> Result<Vec<Hit>, SyncTexError> {
        let tags = self.tags_of(file);
        let mut exact = false;
        let mut after: Option<u32> = None;
        let mut before: Option<u32> = None;
        for n in self
            .nodes
            .iter()
            .filter(|n| n.line > 0 && tags.contains(&n.tag))
        {
            if n.line == line {
                exact = true;
            } else if n.line > line {
                after = Some(after.map_or(n.line, |a| a.min(n.line)));
            } else {
                before = Some(before.map_or(n.line, |b| b.max(n.line)));
            }
        }
        let target = if exact {
            line
        } else {
            after.or(before).ok_or(SyncTexError::NotFound)?
        };
        let mut hits: Vec<Hit> = self
            .nodes
            .iter()
            .filter(|n| n.line == target && tags.contains(&n.tag))
            .map(|n| n.hit)
            .collect();
        hits.sort_by(|a, b| {
            a.page
                .cmp(&b.page)
                .then(a.y.total_cmp(&b.y))
                .then(a.x.total_cmp(&b.x))
                .then(a.width.total_cmp(&b.width))
                .then(a.height.total_cmp(&b.height))
                .then(a.depth.total_cmp(&b.depth))
        });
        hits.dedup();
        hits.truncate(MAX_HITS);
        Ok(hits)
    }

    /// The source of the smallest box around the point (`x`, `y`) of `page`,
    /// else of the nearest box within half an inch.
    pub fn inverse(&self, page: u32, x: f64, y: f64) -> Result<Source, SyncTexError> {
        if !(x.is_finite() && y.is_finite()) {
            return Err(SyncTexError::NotFound);
        }
        let mut best: Option<(f64, f64, &Node)> = None;
        for n in self
            .nodes
            .iter()
            .filter(|n| n.boxed && n.line > 0 && n.hit.page == page)
        {
            let distance = distance(&n.hit, x, y);
            let area = n.hit.width.abs() * (n.hit.height + n.hit.depth).abs();
            // later boxes are the ones inside earlier ones: they win a tie
            let better = best
                .is_none_or(|(d, a, _)| distance.total_cmp(&d).then(area.total_cmp(&a)).is_le());
            if better {
                best = Some((distance, area, n));
            }
        }
        let (distance, _, node) = best.ok_or(SyncTexError::NotFound)?;
        let file = self
            .inputs
            .iter()
            .find(|(tag, _)| *tag == node.tag)
            .map(|(_, name)| name.clone())
            .ok_or(SyncTexError::NotFound)?;
        if distance <= SLACK_BP {
            Ok(Source {
                file,
                line: node.line,
            })
        } else {
            Err(SyncTexError::NotFound)
        }
    }

    /// The tags of the inputs called `file`: an exact match, else one that
    /// ends the same way on a folder boundary. Letter case only counts when
    /// that finds nothing (Windows and macOS do not tell `Main.tex` from
    /// `main.tex`, and a drive letter may come in either case).
    fn tags_of(&self, file: &str) -> Vec<u32> {
        let wanted = normalize(file);
        if wanted.is_empty() {
            return Vec::new();
        }
        for fold in [false, true] {
            let key = |s: &str| if fold { s.to_lowercase() } else { s.to_owned() };
            let wanted = key(&wanted);
            let (tail, head) = (format!("/{wanted}"), wanted.clone());
            let named = |matches: &dyn Fn(&str) -> bool| -> Vec<u32> {
                let tags = self.inputs.iter();
                let hit = tags.filter(|(_, name)| matches(&key(&normalize(name))));
                hit.map(|(tag, _)| *tag).collect()
            };
            let exact = named(&|name| name == head);
            if !exact.is_empty() {
                return exact;
            }
            let suffix =
                named(&|name| name.ends_with(&tail) || head.ends_with(&format!("/{name}")));
            if !suffix.is_empty() {
                return suffix;
            }
        }
        Vec::new()
    }
}

/// Slashes forward, no leading `./` and no `\\?\` prefix.
fn normalize(path: &str) -> String {
    let path = path.replace('\\', "/");
    let mut rest = path.as_str();
    rest = rest.strip_prefix("//?/").unwrap_or(rest);
    while let Some(r) = rest.strip_prefix("./") {
        rest = r;
    }
    rest.to_owned()
}

/// How far the point is from the box (0 inside it).
fn distance(hit: &Hit, x: f64, y: f64) -> f64 {
    let (left, right) = (hit.x.min(hit.x + hit.width), hit.x.max(hit.x + hit.width));
    let (top, bottom) = (hit.top().min(hit.bottom()), hit.top().max(hit.bottom()));
    let dx = (left - x).max(x - right).max(0.0);
    let dy = (top - y).max(y - bottom).max(0.0);
    dx.hypot(dy)
}
