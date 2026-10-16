//! The plan: a short checklist the model keeps while it works on something
//! with several steps. It is a chat-only tool (`update_plan`) that never
//! reaches the vault: the turn answers it itself, the window shows the list
//! above the answer, the thread keeps it, and it goes back into the
//! conversation whenever earlier steps are summarised.

use kasten_mcp::tools::ToolSpec;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The tool's name.
pub const TOOL: &str = "update_plan";
/// The most items a plan holds, and the most characters of one.
const MAX_ITEMS: usize = 30;
const MAX_TEXT: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanStatus {
    Todo,
    Doing,
    Done,
}

impl PlanStatus {
    fn of(word: &str) -> Option<PlanStatus> {
        match word.trim().to_ascii_lowercase().as_str() {
            "todo" | "to do" | "pending" | "" => Some(PlanStatus::Todo),
            "doing" | "in_progress" | "in progress" | "active" => Some(PlanStatus::Doing),
            "done" | "complete" | "completed" | "finished" => Some(PlanStatus::Done),
            _ => None,
        }
    }
}

/// One line of the plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanItem {
    /// Stays with the item while the model rewrites the list around it.
    pub id: String,
    pub text: String,
    pub status: PlanStatus,
}

/// The tool as the model sees it.
pub fn spec() -> ToolSpec {
    ToolSpec {
        name: TOOL.to_owned(),
        description: "Writes or updates your plan for the task: a short checklist the person sees above your answer. \
Use it for work with several steps: write the plan first, then call it again as steps start (`doing`) and finish \
(`done`). Each call replaces the whole list, so send every item each time. Keep it to a few lines; it changes nothing \
in the vault."
            .to_owned(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "The whole plan, in order.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string", "description": "One step, in a few words."},
                            "status": {"type": "string", "enum": ["todo", "doing", "done"]}
                        },
                        "required": ["text", "status"]
                    }
                }
            },
            "required": ["items"]
        }),
        read_only: false,
    }
}

fn number_of(id: &str) -> u64 {
    id.strip_prefix('p')
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

fn short(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match text.char_indices().nth(MAX_TEXT) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text,
    }
}

/// The plan the model's call makes, with `old`'s ids kept for items whose
/// words did not change. Anything that is not a list of steps is an error
/// the model reads and mends.
pub fn update(old: &[PlanItem], input: &Value) -> Result<Vec<PlanItem>, String> {
    let Some(items) = input["items"].as_array() else {
        return Err(
            "update_plan needs `items`: a list of steps, each with `text` and `status` (todo, doing or done)"
                .to_owned(),
        );
    };
    if items.len() > MAX_ITEMS {
        return Err(format!(
            "A plan holds at most {MAX_ITEMS} steps; send a shorter one"
        ));
    }
    let mut taken: Vec<&str> = Vec::new();
    let mut top = old.iter().map(|i| number_of(&i.id)).max().unwrap_or(0);
    let mut out: Vec<PlanItem> = Vec::new();
    for item in items {
        let (text, status) = match item {
            Value::String(text) => (short(text), PlanStatus::Todo),
            Value::Object(_) => {
                let status = item["status"].as_str().unwrap_or("todo");
                let Some(status) = PlanStatus::of(status) else {
                    return Err(format!(
                        "“{status}” is not a step's status: use todo, doing or done"
                    ));
                };
                (short(item["text"].as_str().unwrap_or_default()), status)
            }
            _ => return Err("Each step is an object with `text` and `status`".to_owned()),
        };
        if text.is_empty() {
            return Err("Each step needs some `text`".to_owned());
        }
        let same = old
            .iter()
            .find(|o| o.text == text && !taken.contains(&o.id.as_str()));
        let id = match same {
            Some(old) => old.id.clone(),
            None => {
                top += 1;
                format!("p{top}")
            }
        };
        out.push(PlanItem { id, text, status });
        taken.push(match same {
            Some(old) => old.id.as_str(),
            None => "",
        });
    }
    Ok(out)
}

/// The plan as lines for the model to read again, such as after a summary.
pub fn as_text(plan: &[PlanItem]) -> String {
    plan.iter()
        .map(|item| {
            let mark = match item.status {
                PlanStatus::Todo => "[ ]",
                PlanStatus::Doing => "[~]",
                PlanStatus::Done => "[x]",
            };
            format!("- {mark} {}", item.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// What the tool answers the model: the list as it now stands.
pub fn answer(plan: &[PlanItem]) -> String {
    if plan.is_empty() {
        return "Plan cleared.".to_owned();
    }
    let done = plan.iter().filter(|i| i.status == PlanStatus::Done).count();
    format!(
        "Plan saved ({done} of {} done):\n{}",
        plan.len(),
        as_text(plan)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(items: Value) -> Result<Vec<PlanItem>, String> {
        update(&[], &json!({ "items": items }))
    }

    #[test]
    fn a_plan_is_the_list_the_model_sends() {
        let plan = call(json!([
            {"text": "Read the outline", "status": "done"},
            {"text": "Write the slides", "status": "doing"},
            {"text": "Check them", "status": "todo"},
        ]))
        .unwrap();
        let shown: Vec<_> = plan.iter().map(|i| (i.id.as_str(), i.status)).collect();
        assert_eq!(
            shown,
            [
                ("p1", PlanStatus::Done),
                ("p2", PlanStatus::Doing),
                ("p3", PlanStatus::Todo)
            ]
        );
    }

    #[test]
    fn an_item_keeps_its_id_while_the_list_changes_around_it() {
        let first = call(json!([
            {"text": "One", "status": "todo"},
            {"text": "Two", "status": "todo"},
        ]))
        .unwrap();
        let next = update(
            &first,
            &json!({"items": [
                {"text": "Two", "status": "doing"},
                {"text": "Three", "status": "todo"},
                {"text": "One", "status": "done"},
            ]}),
        )
        .unwrap();
        let ids: Vec<_> = next.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["p2", "p3", "p1"], "a new item never reuses an id");
    }

    #[test]
    fn what_is_not_a_plan_is_an_error_the_model_can_mend() {
        for bad in [
            json!({}),
            json!({"items": "no"}),
            json!({"items": [{"text": "x", "status": "maybe"}]}),
            json!({"items": [{"text": "  ", "status": "todo"}]}),
            json!({"items": [3]}),
        ] {
            let err = update(&[], &bad).unwrap_err();
            assert!(!err.is_empty(), "{bad}");
        }
        let long: Vec<_> = (0..31).map(|i| json!({"text": format!("s{i}")})).collect();
        assert!(call(json!(long)).unwrap_err().contains("at most 30"));
        // Plain words and a missing status are taken kindly.
        let kind = call(json!(["Just a line", {"text": "Another"}])).unwrap();
        assert!(kind.iter().all(|i| i.status == PlanStatus::Todo));
    }

    #[test]
    fn a_long_step_is_cut_and_the_plan_reads_back_as_lines() {
        let plan = call(json!([
            {"text": "x".repeat(500), "status": "doing"},
            {"text": "Done thing", "status": "done"},
        ]))
        .unwrap();
        assert_eq!(plan[0].text.chars().count(), MAX_TEXT + 1);
        let text = as_text(&plan);
        assert!(text.contains("- [~] xxx") && text.ends_with("- [x] Done thing"));
        assert!(answer(&plan).starts_with("Plan saved (1 of 2 done):"));
        assert_eq!(answer(&[]), "Plan cleared.");
    }
}
