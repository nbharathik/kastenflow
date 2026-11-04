//! OpenCode's output: `opencode run --format json` prints one JSON object per
//! line, each with `type`, `timestamp`, `sessionID` and the payload in `part`:
//! `step_start`, `text` (a finished piece of the answer), `tool_use` (a tool
//! call, printed when it ends), `step_finish` and `error`. OpenCode's own
//! documentation does not list the shapes; these are the ones its `run`
//! command prints and the community parsers read. A line of a kind this does
//! not know is skipped, so a newer OpenCode adds nothing that breaks it.
//!
//! In this mode OpenCode answers every permission question itself, with a
//! refusal (it has nobody to ask); the refused call shows as a failed tool.

use std::collections::HashSet;

use serde_json::Value;

use super::items::{Finish, Item, classify};

#[derive(Debug, Default)]
pub struct OpenCodeParser {
    session: Option<String>,
    /// Calls already told, so a call seen twice is told once.
    started: HashSet<String>,
    /// Pieces of text told so far: the next one starts a new paragraph.
    texts: usize,
}

fn words(error: &Value, event: &Value) -> String {
    [
        &error["data"]["message"],
        &error["message"],
        &event["message"],
        &error["name"],
    ]
    .into_iter()
    .find_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()))
    .unwrap_or("OpenCode reported an error")
    .to_owned()
}

impl OpenCodeParser {
    pub fn feed(&mut self, line: &str) -> Vec<Item> {
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if let Some(id) = event["sessionID"].as_str()
            && self.session.as_deref() != Some(id)
        {
            self.session = Some(id.to_owned());
            out.push(Item::Session(id.to_owned()));
        }
        let part = &event["part"];
        match event["type"].as_str() {
            Some("text") => {
                if let Some(text) = part["text"].as_str().filter(|t| !t.trim().is_empty()) {
                    let lead = if self.texts > 0 { "\n\n" } else { "" };
                    self.texts += 1;
                    out.push(Item::Text(format!("{lead}{}", text.trim_end())));
                }
            }
            Some("tool_use") => out.extend(self.tool(part)),
            Some("error") => {
                let error = &event["error"];
                let text = words(error, &event);
                let category = error["name"].as_str();
                let status = error["data"]["statusCode"].as_u64();
                let mut problem = classify(category, &text);
                if status == Some(429) {
                    problem = super::items::Problem::Limit;
                } else if status == Some(401) || status == Some(403) {
                    problem = super::items::Problem::SignIn;
                }
                out.push(Item::Finished(Finish {
                    ok: false,
                    text,
                    problem,
                }));
            }
            _ => {}
        }
        out
    }

    fn tool(&mut self, part: &Value) -> Vec<Item> {
        let id = part["callID"].as_str().unwrap_or_default().to_owned();
        let state = &part["state"];
        let mut out = Vec::new();
        if self.started.insert(id.clone()) {
            out.push(Item::Tool {
                id: id.clone(),
                name: part["tool"].as_str().unwrap_or_default().to_owned(),
                input: state["input"].clone(),
            });
        }
        match state["status"].as_str() {
            Some("completed") => {
                let ok = state["metadata"]["exit"]
                    .as_i64()
                    .is_none_or(|code| code == 0);
                out.push(Item::ToolDone {
                    id,
                    ok,
                    text: state["output"].as_str().unwrap_or_default().to_owned(),
                });
            }
            Some("error") => out.push(Item::ToolDone {
                id,
                ok: false,
                text: state["error"]
                    .as_str()
                    .or_else(|| state["output"].as_str())
                    .unwrap_or("The call was refused or failed")
                    .to_owned(),
            }),
            _ => {}
        }
        out
    }
}
