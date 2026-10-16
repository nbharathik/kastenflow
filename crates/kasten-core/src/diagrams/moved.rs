//! How much of a drawing a change moved: an agent's layout of a diagram a
//! person arranged by hand waits for review when it moves too many boxes.

use super::model::Doc;
use crate::error::Result;

/// How many of the boxes of `old` are somewhere else in `new` (by more than a
/// pixel, on the page), and how many `old` had.
pub fn moved_cells(old: &str, new: &str) -> Result<(usize, usize)> {
    let before = Doc::parse(old)?;
    let after = Doc::parse(new)?;
    let (mut moved, mut total) = (0, 0);
    for page in &before.pages {
        let other = after.pages.iter().find(|p| p.id == page.id);
        for cell in page.vertices() {
            let Some(was) = page.abs(&cell.id) else {
                continue;
            };
            total += 1;
            let now = other.and_then(|p| p.abs(&cell.id));
            if now.is_some_and(|n| (n.x - was.x).abs() >= 1.0 || (n.y - was.y).abs() >= 1.0) {
                moved += 1;
            }
        }
    }
    Ok((moved, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::steps::{Step, replay};

    const XML: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/diagrams/editor-output.drawio"
    ));

    #[test]
    fn a_box_that_stays_is_not_moved_and_one_that_goes_is_counted() {
        let steps: Vec<Step> = serde_json::from_value(serde_json::json!([
            {"op": "move", "id": "web", "dx": 50},
            {"op": "move", "id": "api", "dx": 0.4},
            {"op": "add_node", "id": "new"},
        ]))
        .unwrap();
        let out = replay(XML, None, None, &steps).unwrap();
        assert_eq!(moved_cells(XML, &out.xml).unwrap(), (1, 3));
        assert_eq!(moved_cells(XML, XML).unwrap(), (0, 3));
    }
}
