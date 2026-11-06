//! Claude Code's output: `claude -p --output-format stream-json --verbose
//! --include-partial-messages` prints one JSON object per line. `system` (the
//! `init` event names the session and the MCP servers), `stream_event`
//! (partial text), `assistant` (a whole message: its text and tool calls),
//! `user` (tool results), and `result` (the end, with the session id). With
//! `--permission-prompt-tool stdio` the CLI also sends `control_request`
//! lines with `can_use_tool`, which are answered on its input
//! (`allow_line`, `deny_line`). This is the protocol the Agent SDK speaks.

use serde_json::{Value, json};

use super::items::{Ask, Finish, Item, Problem, classify, content_text};

/// Reads Claude Code's lines one at a time.
#[derive(Debug, Default)]
pub struct ClaudeParser {
    /// Text came as partial pieces since the last whole message: the whole
    /// message then repeats it, and its text is not told again.
    streamed: bool,
}

fn text_of(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| !s.is_empty())
}

impl ClaudeParser {
    pub fn feed(&mut self, line: &str) -> Vec<Item> {
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
            return Vec::new();
        };
        match event["type"].as_str() {
            Some("system") => self.system(&event),
            Some("stream_event") => self.partial(&event["event"]),
            Some("assistant") => self.assistant(&event),
            Some("user") => Self::results(&event),
            Some("result") => Self::result(&event),
            Some("control_request") => Self::control(&event),
            Some("control_cancel_request") => text_of(&event["request_id"])
                .map(|id| vec![Item::AskWithdrawn(id.to_owned())])
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    fn system(&mut self, event: &Value) -> Vec<Item> {
        match event["subtype"].as_str() {
            Some("init") => {
                let mut out = Vec::new();
                if let Some(id) = text_of(&event["session_id"]) {
                    out.push(Item::Session(id.to_owned()));
                }
                let servers = event["mcp_servers"].as_array().into_iter().flatten();
                for server in servers {
                    let status = server["status"].as_str().unwrap_or_default();
                    if server["name"] == super::SERVER && status != "connected" {
                        out.push(Item::Notice {
                            text: format!(
                                "KastenFlow's tools are not connected to {} (status: {status}), so it cannot read or change your notes in this answer.",
                                "Claude Code"
                            ),
                            code: Some("mcp".to_owned()),
                        });
                    }
                }
                out
            }
            Some("api_retry") => {
                let attempt = event["attempt"].as_u64().unwrap_or(1);
                let of = event["max_retries"].as_u64();
                let why = text_of(&event["error"]).unwrap_or("a problem");
                let text = match of {
                    Some(of) => {
                        format!("Claude Code is trying again after {why} ({attempt} of {of})")
                    }
                    None => format!("Claude Code is trying again after {why}"),
                };
                vec![Item::Notice {
                    text,
                    code: Some("retry".to_owned()),
                }]
            }
            _ => Vec::new(),
        }
    }

    fn partial(&mut self, event: &Value) -> Vec<Item> {
        // A new message starts with no pieces of its text told yet.
        if event["type"] == "message_start" {
            self.streamed = false;
        }
        if event["type"] == "content_block_delta"
            && event["delta"]["type"] == "text_delta"
            && let Some(text) = text_of(&event["delta"]["text"])
        {
            self.streamed = true;
            return vec![Item::Text(text.to_owned())];
        }
        Vec::new()
    }

    fn assistant(&mut self, event: &Value) -> Vec<Item> {
        // A failed request is told as a message whose text is the reason; the
        // closing `result` says it again, so the text is not shown twice.
        let failed = event["error"].is_string();
        let blocks = event["message"]["content"]
            .as_array()
            .map_or(&[][..], Vec::as_slice);
        // Only a message with text uses up the partial pieces: a thinking or tool message between does not.
        let has_text = blocks.iter().any(|b| b["type"] == "text");
        let skip_text = self.streamed || failed;
        if has_text {
            self.streamed = false;
        }
        let mut out = Vec::new();
        for block in blocks {
            match block["type"].as_str() {
                Some("text") if !skip_text => {
                    if let Some(text) = text_of(&block["text"]) {
                        out.push(Item::Text(text.to_owned()));
                    }
                }
                Some("tool_use") => out.push(Item::Tool {
                    id: block["id"].as_str().unwrap_or_default().to_owned(),
                    name: block["name"].as_str().unwrap_or_default().to_owned(),
                    input: block["input"].clone(),
                }),
                _ => {}
            }
        }
        out
    }

    fn results(event: &Value) -> Vec<Item> {
        event["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|b| b["type"] == "tool_result")
            .map(|b| Item::ToolDone {
                id: b["tool_use_id"].as_str().unwrap_or_default().to_owned(),
                ok: b["is_error"] != true,
                text: content_text(&b["content"]),
            })
            .collect()
    }

    fn result(event: &Value) -> Vec<Item> {
        let subtype = event["subtype"].as_str().unwrap_or_default();
        let ok = event["is_error"] != true && (subtype.is_empty() || subtype == "success");
        let mut text = event["result"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_owned();
        if text.is_empty() {
            let errors: Vec<&str> = event["errors"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            text = if errors.is_empty() {
                subtype.replace('_', " ")
            } else {
                errors.join("\n")
            };
        }
        let problem = if ok {
            Problem::Other
        } else {
            classify(event["error"].as_str(), &text)
        };
        let mut out = Vec::new();
        if let Some(id) = text_of(&event["session_id"]) {
            out.push(Item::Session(id.to_owned()));
        }
        out.push(Item::Finished(Finish { ok, text, problem }));
        out
    }

    fn control(event: &Value) -> Vec<Item> {
        let request = &event["request"];
        if request["subtype"] != "can_use_tool" {
            return Vec::new();
        }
        let Some(id) = text_of(&event["request_id"]) else {
            return Vec::new();
        };
        let title = text_of(&request["title"])
            .or_else(|| text_of(&request["description"]))
            .map(str::to_owned);
        vec![Item::Ask(Ask {
            request_id: id.to_owned(),
            tool: request["tool_name"].as_str().unwrap_or_default().to_owned(),
            input: request["input"].clone(),
            title,
        })]
    }
}

/// The line that answers a question with yes: the tool runs with `input`.
pub fn allow_line(request_id: &str, input: &Value) -> String {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": { "behavior": "allow", "updatedInput": input },
        },
    })
    .to_string()
}

/// The line that answers no; the CLI tells the model `message`.
pub fn deny_line(request_id: &str, message: &str) -> String {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": { "behavior": "deny", "message": message },
        },
    })
    .to_string()
}

/// The first line sent: the person's message, as the stream-json input takes it.
pub fn user_line(text: &str) -> String {
    json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
    })
    .to_string()
}

/// The `initialize` request the SDK sends first (no hooks, no agents).
pub fn initialize_line() -> String {
    json!({
        "type": "control_request",
        "request_id": "req_init",
        "request": { "subtype": "initialize" },
    })
    .to_string()
}
