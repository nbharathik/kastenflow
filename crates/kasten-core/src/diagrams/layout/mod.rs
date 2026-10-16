//! Automatic layout of a page. Boxes are put in layers along the flow
//! (left to right or top to bottom), ordered to cross as few edges as can be
//! found, and set on the 10 pixel grid. Groups are laid out first, deepest
//! first, sized to what they hold and then placed as boxes of the level above;
//! swimlanes share one flow; boxes with no edges go into a grid; edges are
//! told which sides to leave and enter and given the bends that keep them off
//! the boxes between. Everything is worked out in the order of the file, with
//! nothing random, so the same diagram is always laid out the same way.

mod containers;
mod coords;
mod lanes;
pub mod layers;
pub mod place;
mod route;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use crate::diagrams::model::{Page, Rect};
use crate::error::Result;

pub use route::Route;

/// What a layout is asked to do.
#[derive(Debug, Clone)]
pub struct Options {
    /// A group's id; the whole page when none.
    pub scope: Option<String>,
    /// Layers run left to right (otherwise top to bottom).
    pub horizontal: bool,
    /// 1.0 is normal; less is tighter, more is looser.
    pub spacing: f64,
}

/// What a layout did.
#[derive(Debug, Clone, Default)]
pub struct Report {
    /// How many boxes ended somewhere else.
    pub moved: usize,
    /// Edges that still cross another.
    pub crossings: usize,
    pub notes: Vec<String>,
}

/// Lays out `page`.
pub fn run(page: &mut Page, options: &Options) -> Result<Report> {
    let before: HashMap<String, Rect> = page
        .vertices()
        .filter_map(|c| page.abs(&c.id).map(|r| (c.id.clone(), r)))
        .collect();
    let mut driver = containers::Driver {
        page,
        horizontal: options.horizontal,
        spacing: options.spacing.clamp(0.5, 3.0),
        routes: Vec::new(),
        crossings: 0,
    };
    match &options.scope {
        Some(id) => driver.within(id),
        None => driver.all(),
    }
    let routes = std::mem::take(&mut driver.routes);
    let crossings = driver.crossings;
    route::apply(page, &routes, options.horizontal);
    let moved =
        page.vertices()
            .filter(|c| {
                let now = page.abs(&c.id);
                before.get(&c.id).zip(now).is_some_and(|(was, n)| {
                    (was.x - n.x).abs() >= 1.0 || (was.y - n.y).abs() >= 1.0
                })
            })
            .count();
    let mut notes = Vec::new();
    if crossings > 0 {
        notes.push(format!(
            "{crossings} edge{} still cross{}; fewer cross if the boxes that talk to each other are grouped",
            if crossings == 1 { "" } else { "s" },
            if crossings == 1 { "es" } else { "" }
        ));
    }
    Ok(Report {
        moved,
        crossings,
        notes,
    })
}
