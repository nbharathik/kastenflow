//! The Anthropic Messages API: the request, and the stream of events that
//! answers it. An answer's content blocks (text, thinking, tool use) are
//! kept as they came, since the API wants thinking blocks back unchanged,
//! in order and with their signatures. Unknown events, blocks and fields
//! are skipped, so a newer API still streams.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::model::{Call, Message, Reply, Stop, ToolCall, ToolOutput, tool_schema};
use super::sse::SseEvent;

pub const DEFAULT_BASE: &str = "https://api.anthropic.com";
pub const VERSION: &str = "2023-06-01";

/// `/v1/messages` under `base`, which may be given with or without `/v1`.
pub fn url(base: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    let base = if base.is_empty() { DEFAULT_BASE } else { base };
    if base.ends_with("/v1/messages") {
        return base.to_owned();
    }
    format!("{}/v1/messages", base.trim_end_matches("/v1"))
}

/// Marks a block as the end of a cached prefix.
fn cached() -> Value {
    json!({"type": "ephemeral"})
}

/// The request. The system prompt and the tools are the same on every
/// turn of a chat, so both end in a cache breakpoint: later turns read
/// them from the cache instead of paying for them again.
pub fn body(model: &str, max_tokens: u32, call: &Call<'_>) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages(call.messages),
        "stream": true,
    });
    if !call.system.is_empty() {
        body["system"] = json!([{"type": "text", "text": call.system, "cache_control": cached()}]);
    }
    if !call.tools.is_empty() {
        let mut tools: Vec<Value> = call
            .tools
            .iter()
            .map(|t| json!({"name": t.name, "description": t.description, "input_schema": tool_schema(t)}))
            .collect();
        if let Some(last) = tools.last_mut() {
            last["cache_control"] = cached();
        }
        body["tools"] = json!(tools);
    }
    body
}

/// Tool ids as the API accepts them; ids from other providers may carry
/// other characters.
fn tool_id(id: &str) -> String {
    let id: String = id
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-' => c,
            _ => '_',
        })
        .collect();
    if id.is_empty() { "call".to_owned() } else { id }
}

/// Adds a block to the user turn at the end, or starts one.
fn user(out: &mut Vec<Value>, block: Value) {
    match out.last_mut() {
        Some(last) if last["role"] == "user" => {
            if let Some(content) = last["content"].as_array_mut() {
                content.push(block);
            }
        }
        _ => out.push(json!({"role": "user", "content": [block]})),
    }
}

/// The thread as `messages`. Results and the person's next words share one
/// user turn, results first, as the API requires.
pub fn messages(thread: &[Message]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for message in thread {
        match message {
            Message::User(text) => user(&mut out, json!({"type": "text", "text": text})),
            Message::Results(results) => {
                for result in results {
                    user(&mut out, tool_result(result));
                }
            }
            Message::Assistant(reply) => {
                let content = reply.blocks.clone().unwrap_or_else(|| blocks_of(reply));
                out.push(json!({"role": "assistant", "content": content}));
            }
        }
    }
    out
}

fn tool_result(result: &ToolOutput) -> Value {
    let mut block = json!({
        "type": "tool_result",
        "tool_use_id": tool_id(&result.id),
        "content": result.content,
    });
    if result.is_error {
        block["is_error"] = json!(true);
    }
    block
}

/// Content blocks for an answer another provider gave.
fn blocks_of(reply: &Reply) -> Vec<Value> {
    let mut blocks = Vec::new();
    if !reply.text.trim().is_empty() {
        blocks.push(json!({"type": "text", "text": reply.text}));
    }
    for call in &reply.calls {
        blocks.push(json!({
            "type": "tool_use",
            "id": tool_id(&call.id),
            "name": call.name,
            "input": call.input().unwrap_or_else(|_| json!({})),
        }));
    }
    blocks
}

#[derive(Debug)]
enum Block {
    Text(String),
    Thinking {
        thinking: String,
        signature: String,
    },
    Tool {
        id: String,
        name: String,
        json: String,
        start: Value,
    },
    /// Kept as it came: redacted thinking, which goes back unchanged.
    Opaque(Value),
    Skipped,
}

/// An answer being streamed.
#[derive(Debug, Default)]
pub struct Stream {
    blocks: BTreeMap<u64, Block>,
    stop: Option<String>,
    done: bool,
}

impl Stream {
    /// Reads one event; returns the text it adds, if any.
    pub fn event(&mut self, event: &SseEvent) -> Result<Option<String>, String> {
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else {
            return Ok(None);
        };
        let kind = data["type"].as_str().unwrap_or(&event.event);
        let index = data["index"].as_u64().unwrap_or(0);
        match kind {
            "content_block_start" => {
                let block = &data["content_block"];
                let text = |key: &str| block[key].as_str().unwrap_or_default().to_owned();
                let new = match block["type"].as_str().unwrap_or_default() {
                    "text" => Block::Text(text("text")),
                    "thinking" => Block::Thinking {
                        thinking: text("thinking"),
                        signature: text("signature"),
                    },
                    "tool_use" => Block::Tool {
                        id: text("id"),
                        name: text("name"),
                        json: String::new(),
                        start: block["input"].clone(),
                    },
                    "redacted_thinking" => Block::Opaque(block.clone()),
                    _ => Block::Skipped,
                };
                let first = match &new {
                    Block::Text(t) if !t.is_empty() => Some(t.clone()),
                    _ => None,
                };
                self.blocks.insert(index, new);
                return Ok(first);
            }
            "content_block_delta" => {
                let delta = &data["delta"];
                let piece = |key: &str| delta[key].as_str().unwrap_or_default();
                let block =
                    self.blocks
                        .entry(index)
                        .or_insert_with(|| match delta["type"].as_str() {
                            Some("text_delta") => Block::Text(String::new()),
                            _ => Block::Skipped,
                        });
                match (delta["type"].as_str().unwrap_or_default(), block) {
                    ("text_delta", Block::Text(text)) => {
                        text.push_str(piece("text"));
                        return Ok(Some(piece("text").to_owned()).filter(|t| !t.is_empty()));
                    }
                    ("input_json_delta", Block::Tool { json, .. }) => {
                        json.push_str(piece("partial_json"))
                    }
                    ("thinking_delta", Block::Thinking { thinking, .. }) => {
                        thinking.push_str(piece("thinking"))
                    }
                    // The signature comes whole, just before the block ends.
                    ("signature_delta", Block::Thinking { signature, .. }) => {
                        *signature = piece("signature").to_owned()
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(reason) = data["delta"]["stop_reason"].as_str() {
                    self.stop = Some(reason.to_owned());
                }
            }
            "message_stop" => self.done = true,
            "error" => {
                let error = &data["error"];
                let message = error["message"].as_str().unwrap_or("the stream failed");
                return Err(match error["type"].as_str() {
                    Some(kind) => format!("{message} ({kind})"),
                    None => message.to_owned(),
                });
            }
            // message_start, content_block_stop, ping and whatever comes later.
            _ => {}
        }
        Ok(None)
    }

    /// Whether the server said the answer is complete.
    pub fn ended(&self) -> bool {
        self.done
    }

    /// Whether the answer said how it ended, even if `message_stop` never came.
    pub fn complete(&self) -> bool {
        self.done || self.stop.is_some()
    }

    /// The answer so far. Cut short (`cancelled`), it keeps only what is
    /// whole: its text and signed thinking, not half-written tool calls.
    pub fn reply(self, cancelled: bool) -> Reply {
        let stop = if cancelled {
            Stop::Cancelled
        } else {
            match self.stop.as_deref() {
                Some("tool_use") => Stop::Tools,
                Some("max_tokens") => Stop::Length,
                Some("model_context_window_exceeded") => Stop::Full,
                Some("refusal") => Stop::Refusal,
                _ => Stop::End,
            }
        };
        let mut text = String::new();
        let mut calls = Vec::new();
        let mut blocks = Vec::new();
        for block in self.blocks.into_values() {
            match block {
                Block::Text(t) => {
                    text.push_str(&t);
                    if !t.trim().is_empty() {
                        blocks.push(json!({"type": "text", "text": t}));
                    }
                }
                Block::Thinking {
                    thinking,
                    signature,
                } if !signature.is_empty() => {
                    blocks.push(
                        json!({"type": "thinking", "thinking": thinking, "signature": signature}),
                    );
                }
                Block::Tool {
                    id,
                    name,
                    json,
                    start,
                } if !cancelled => {
                    let parsed = if json.trim().is_empty() {
                        Ok(if start.is_object() { start } else { json!({}) })
                    } else {
                        serde_json::from_str::<Value>(&json)
                    };
                    let (input, arguments) = match parsed {
                        Ok(input) => (input.clone(), input.to_string()),
                        Err(_) => (json!({}), json),
                    };
                    blocks
                        .push(json!({"type": "tool_use", "id": id, "name": name, "input": input}));
                    calls.push(ToolCall {
                        id,
                        name,
                        arguments,
                    });
                }
                Block::Opaque(block) => blocks.push(block),
                _ => {}
            }
        }
        Reply {
            text,
            calls,
            stop,
            blocks: Some(blocks),
            items: None,
        }
    }
}
