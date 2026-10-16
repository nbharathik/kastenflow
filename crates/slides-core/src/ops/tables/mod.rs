//! Operations on the cells of a table: the words and fill of a block of cells, rows and columns
//! added and taken away, cells joined and split. Each finds the table by its id, inside a group
//! too, works on it as a grid (see `crate::model::Matrix`) and checks the result against the
//! format's rules, so a table that would break them is refused and nothing changes. Places are
//! counted from 0, and the messages count the same way.

mod cells;
mod merge;
mod size;
mod structure;

use std::collections::HashSet;

pub(super) use cells::{ClearCells, SetCellFill, SetCells};
pub(super) use merge::{MergeCells, UnmergeCells};
pub(super) use structure::{DeleteColumns, DeleteRows, InsertColumns, InsertRows};

use self::size::Frame;
use super::Cx;
use super::elements::validate;
use super::geometry::{outer_group, pin, settle_groups};
use super::util::element_mut;
use crate::error::{Error, Result};
use crate::model::{Deck, Element, TableEl};

/// The most rows or columns one operation adds or takes away.
const MOST_LINES: usize = 500;

/// Finds the table `id` on the slide, lets `change` work on it, and checks it afterwards. The
/// groups that hold it follow if its box changed.
fn edit<T>(
    cx: &mut Cx,
    op: &str,
    slide_id: &str,
    id: &str,
    change: impl FnOnce(&mut TableEl, &mut Frame) -> Result<T>,
) -> Result<T> {
    let Deck {
        theme,
        slides,
        size,
        ..
    } = &mut *cx.deck;
    let slide = slides
        .iter_mut()
        .find(|s| s.id == slide_id)
        .ok_or_else(|| Error::no_slide(slide_id))?;
    let holders: HashSet<String> = outer_group(slide, id).into_iter().collect();
    let layout = slide.layout.clone();
    let element = element_mut(slide, id)?;
    pin(theme, &layout, element);
    let result = {
        let kind = element.kind();
        let Some((x, y, w, h)) = element.base().rect() else {
            return Err(Error::bad_input(
                op,
                format!("element `{id}` has no position to work from"),
            ));
        };
        let Element::Table(table) = &mut *element else {
            return Err(Error::refused(format!(
                "`{id}` is a {kind} element, not a table, so `{op}` cannot change it."
            )));
        };
        if let Some(problem) = table.problem() {
            return Err(Error::refused(format!(
                "The table cannot be changed as it is: {problem}"
            )));
        }
        let mut frame = Frame {
            x,
            y,
            w,
            h,
            slide_w: size.w,
            slide_h: size.h,
        };
        change(table, &mut frame)?
    };
    validate(element).map_err(|message| Error::bad_input(op, message))?;
    settle_groups(slide, &holders);
    Ok(result)
}

/// How many rows or columns to add or take away: between 1 and the most.
fn count_ok(op: &str, count: usize) -> Result<()> {
    if (1..=MOST_LINES).contains(&count) {
        Ok(())
    } else {
        Err(Error::bad_input(
            op,
            format!("`count` is between 1 and {MOST_LINES}, not {count}"),
        ))
    }
}
