//! `set_chart_data`: the numbers of a chart and how it looks, set in one change. What is asked for is worked out in
//! `crate::ops::chart_data`; the chart is changed with `patch_elements`, so the change is undone, marked and kept like any
//! other change to an element.

use serde_json::{Value, json};

use super::edit::apply_all;
use super::read::slide_id;
use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolResult};
use crate::model::Element;
use crate::ops::chart_data::{ChartInput, operations};

pub fn set_chart_data(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let input = ChartInput::read(args)?;
    let edited = agent.edit(store, &name, None, |engine| {
        let slide = slide_id(engine.deck(), args.get("slide").unwrap_or(&Value::Null))?;
        let id = args
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(|| ToolError::new("`id` is the chart element's id; get_slide shows the elements of a slide."))?;
        let chart = match engine.deck().slide(&slide).and_then(|s| s.element(id)) {
            Some(Element::Chart(chart)) => chart.clone(),
            Some(other) => {
                return Err(ToolError::new(format!(
                    "`{id}` is a {} element, not a chart. add_elements with type `chart` makes one.",
                    other.kind()
                )));
            }
            None => {
                return Err(ToolError::new(format!(
                    "There is no element `{id}` on slide `{slide}`. get_slide shows its elements."
                )));
            }
        };
        let (changed, told) = input.apply(&chart)?;
        apply_all(engine, operations(&slide, id, &changed))?;
        Ok(serde_json::to_value(&told).unwrap_or(Value::Null))
    })?;
    agent.answer(store, &edited, json!({}))
}
