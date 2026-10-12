//! A page cut into slides: one for each section at a heading level.

use super::Block;
use crate::model::Run;

/// The words and pictures of one slide of a page: a title, and the blocks under it.
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    pub title: Vec<Run>,
    pub blocks: Vec<Block>,
}

/// The heading level a page is cut at when none is asked for: the shallowest level that more than one heading has (the
/// sections of a page that has one title), else the shallowest there is. 0 for a page with no heading.
fn level_for(blocks: &[Block]) -> u8 {
    let mut counts = [0usize; 7];
    for block in blocks {
        if let Block::Heading { level, .. } = block {
            counts[usize::from(*level).min(6)] += 1;
        }
    }
    (1u8..=6)
        .find(|&l| counts[usize::from(l)] >= 2)
        .or_else(|| (1u8..=6).find(|&l| counts[usize::from(l)] >= 1))
        .unwrap_or(0)
}

/// The slides of a page: a heading at `split` (or a shallower one) starts one and gives it its title, and everything
/// down to the next such heading is its body. Words before the first heading go on a slide called `intro`. `split` of 0
/// is the level the page is best cut at.
pub fn parts(blocks: &[Block], split: u8, intro: &str) -> Vec<Part> {
    let level = if (1..=6).contains(&split) {
        split
    } else {
        level_for(blocks)
    };
    let mut out: Vec<Part> = Vec::new();
    let mut lead: Vec<Block> = Vec::new();
    for block in blocks {
        match block {
            Block::Heading { level: at, runs } if level != 0 && *at <= level => {
                if out.is_empty() && says_something(&lead) {
                    out.push(Part {
                        title: vec![Run::plain(intro)],
                        blocks: std::mem::take(&mut lead),
                    });
                }
                out.push(Part {
                    title: runs.clone(),
                    blocks: Vec::new(),
                });
            }
            other => match out.last_mut() {
                Some(part) => part.blocks.push(other.clone()),
                None => lead.push(other.clone()),
            },
        }
    }
    if out.is_empty() && says_something(&lead) {
        out.push(Part {
            title: vec![Run::plain(intro)],
            blocks: lead,
        });
    }
    out
}

/// Whether blocks hold anything to show: a rule alone does not.
fn says_something(blocks: &[Block]) -> bool {
    blocks.iter().any(|b| !matches!(b, Block::Rule))
}
