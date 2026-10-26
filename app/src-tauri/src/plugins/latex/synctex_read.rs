//! The content part of a SyncTeX file: one record per line, the first letter
//! telling what it is, the rest `tag,line:x,y[:w[,h,d]]`.

use super::synctex::{Frame, Hit, Node, SyncTexError};

const MAX_NODES: usize = 2_000_000;
/// Boxes inside boxes: real pages nest a few dozen deep.
const MAX_DEPTH: usize = 1024;

struct Record {
    tag: u32,
    line: u32,
    x: f64,
    y: f64,
    size: [f64; 3],
}

/// `tag,line:x,y[:w[,h,d]]`, the part of a record after its letter.
fn record(rest: &str) -> Option<Record> {
    let mut parts = rest.split(':');
    let mut ids = parts.next()?.split(',');
    let tag = ids.next()?.trim().parse().ok()?;
    let line = ids.next()?.trim().parse().ok()?;
    let mut at = parts.next()?.split(',');
    let x = number(at.next()?)?;
    let y = number(at.next()?)?;
    let mut size = [0.0; 3];
    if let Some(sizes) = parts.next() {
        for (slot, value) in size.iter_mut().zip(sizes.split(',')) {
            *slot = number(value)?;
        }
    }
    Some(Record {
        tag,
        line,
        x,
        y,
        size,
    })
}

fn number(text: &str) -> Option<f64> {
    text.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

/// The record's place in PDF points; `None` when a number is so big that it
/// does not stay a number (the record is then skipped like any odd one).
fn hit_of(record: &Record, page: u32, frame: &Frame) -> Option<Hit> {
    let hit = Hit {
        page,
        x: (record.x + frame.x_offset) * frame.scale,
        y: (record.y + frame.y_offset) * frame.scale,
        width: record.size[0] * frame.scale,
        height: record.size[1] * frame.scale,
        depth: record.size[2] * frame.scale,
    };
    [hit.x, hit.y, hit.width, hit.height, hit.depth]
        .iter()
        .all(|v| v.is_finite())
        .then_some(hit)
}

/// The boxes and pieces of every page. Records that do not parse are skipped.
pub(super) fn read_content<'a>(
    lines: impl Iterator<Item = &'a str>,
    frame: &Frame,
) -> Result<Vec<Node>, SyncTexError> {
    let mut nodes = Vec::new();
    let mut page = 0_u32;
    // the boxes open now, innermost last
    let mut open: Vec<Hit> = Vec::new();
    // boxes opened below `MAX_DEPTH`, which are counted but not remembered
    let mut deeper = 0_usize;
    for line in lines {
        let line = line.trim_end();
        if line.starts_with("Postamble:") {
            break;
        }
        let mut chars = line.chars();
        let Some(kind) = chars.next() else {
            continue;
        };
        let rest = chars.as_str();
        match kind {
            '{' => {
                page = rest.trim().parse().unwrap_or(0);
                open.clear();
                deeper = 0;
            }
            '}' => {
                page = 0;
                open.clear();
                deeper = 0;
            }
            _ if page == 0 => {}
            ']' | ')' => {
                if deeper > 0 {
                    deeper -= 1;
                } else {
                    open.pop();
                }
            }
            '[' | '(' | 'v' | 'h' => {
                let hit = record(rest).and_then(|r| Some((hit_of(&r, page, frame)?, r)));
                if let Some((hit, r)) = &hit {
                    nodes.push(Node {
                        tag: r.tag,
                        line: r.line,
                        boxed: true,
                        hit: *hit,
                    });
                }
                if matches!(kind, '[' | '(') {
                    // a box that does not read still has its closing mark
                    let hit = hit.map_or(Hit::empty(page), |(hit, _)| hit);
                    if open.len() < MAX_DEPTH {
                        open.push(hit);
                    } else {
                        deeper += 1;
                    }
                }
            }
            'k' | 'g' | '$' | 'x' => {
                if let Some(r) = record(rest) {
                    // a piece stands for the box it sits in
                    let hit = open.last().copied().or_else(|| {
                        let mut point = hit_of(&r, page, frame)?;
                        point.width = 0.0;
                        point.height = 0.0;
                        point.depth = 0.0;
                        Some(point)
                    });
                    if let Some(hit) = hit {
                        nodes.push(Node {
                            tag: r.tag,
                            line: r.line,
                            boxed: false,
                            hit,
                        });
                    }
                }
            }
            _ => {}
        }
        if nodes.len() > MAX_NODES {
            return Err(SyncTexError::TooLarge);
        }
    }
    Ok(nodes)
}
