//! The Responses API's stream of typed events, read into one answer: its
//! text as it comes, and the items (reasoning with its encrypted content,
//! text, function calls) as they go back with the next request.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::call_item;
use crate::chat::chatgpt::words;
use crate::chat::model::{Reply, Stop, ToolCall};
use crate::chat::sse::SseEvent;

#[derive(Debug)]
enum Item {
    Message(String),
    Call {
        call_id: String,
        name: String,
        arguments: String,
        namespace: Option<String>,
    },
    /// Finished, as it goes back: with its encrypted content.
    Reasoning(Option<Value>),
    Skipped,
}

/// How the stream said the answer ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ended {
    Completed,
    Length,
    Refusal,
    Full,
}

/// An answer being streamed.
#[derive(Debug, Default)]
pub struct Stream {
    items: BTreeMap<u64, Item>,
    text: String,
    ended: Option<Ended>,
    /// Some of the text was a refusal.
    refused: bool,
}

fn string(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_owned()
}

impl Stream {
    /// Reads one event; returns the text it adds, if any.
    pub fn event(&mut self, event: &SseEvent) -> Result<Option<String>, String> {
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else {
            return Ok(None);
        };
        let kind = data["type"].as_str().unwrap_or(&event.event);
        let index = data["output_index"].as_u64().unwrap_or(0);
        match kind {
            "response.output_item.added" => self.added(index, &data["item"]),
            "response.output_text.delta" | "response.refusal.delta" => {
                self.refused |= kind == "response.refusal.delta";
                let piece = data["delta"].as_str().unwrap_or_default();
                if let Item::Message(text) = self
                    .items
                    .entry(index)
                    .or_insert_with(|| Item::Message(String::new()))
                {
                    text.push_str(piece);
                    self.text.push_str(piece);
                }
                return Ok(Some(piece.to_owned()).filter(|p| !p.is_empty()));
            }
            "response.function_call_arguments.delta" => {
                if let Some(Item::Call { arguments, .. }) = self.items.get_mut(&index) {
                    arguments.push_str(data["delta"].as_str().unwrap_or_default());
                }
            }
            "response.function_call_arguments.done" => {
                if let (Some(Item::Call { arguments, .. }), Some(whole)) =
                    (self.items.get_mut(&index), data["arguments"].as_str())
                {
                    *arguments = whole.to_owned();
                }
            }
            "response.output_item.done" => return Ok(self.done(index, &data["item"])),
            "response.completed" => return Ok(self.finish(Ended::Completed, &data["response"])),
            "response.incomplete" => {
                let reason = data["response"]["incomplete_details"]["reason"].as_str();
                let ended = if reason == Some("content_filter") {
                    Ended::Refusal
                } else {
                    Ended::Length
                };
                return Ok(self.finish(ended, &data["response"]));
            }
            "response.failed" => return self.failed(&data["response"]["error"]),
            "error" => return self.failed(&data),
            // Created, in progress, content parts, reasoning summaries,
            // and whatever comes later.
            _ => {}
        }
        Ok(None)
    }

    fn added(&mut self, index: u64, item: &Value) {
        let new = match item["type"].as_str().unwrap_or_default() {
            "message" => Item::Message(String::new()),
            "function_call" => Item::Call {
                call_id: string(item, "call_id"),
                name: string(item, "name"),
                arguments: string(item, "arguments"),
                namespace: item["namespace"].as_str().map(str::to_owned),
            },
            "reasoning" => Item::Reasoning(None),
            _ => Item::Skipped,
        };
        self.items.insert(index, new);
    }

    /// An item is whole: its final form is the one that counts. Returns
    /// text no delta showed.
    fn done(&mut self, index: u64, item: &Value) -> Option<String> {
        if !self.items.contains_key(&index) {
            self.added(index, item);
        }
        match (self.items.get_mut(&index)?, item["type"].as_str()) {
            (Item::Message(text), Some("message")) if text.is_empty() => {
                let said: String = item["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|part| part["text"].as_str().or(part["refusal"].as_str()))
                    .collect();
                *text = said.clone();
                self.text.push_str(&said);
                Some(said).filter(|s| !s.is_empty())
            }
            (
                Item::Call {
                    call_id,
                    name,
                    arguments,
                    namespace,
                },
                Some("function_call"),
            ) => {
                for (own, key) in [
                    (call_id, "call_id"),
                    (name, "name"),
                    (arguments, "arguments"),
                ] {
                    if let Some(whole) = item[key].as_str().filter(|s| !s.is_empty()) {
                        *own = whole.to_owned();
                    }
                }
                if let Some(whole) = item["namespace"].as_str() {
                    *namespace = Some(whole.to_owned());
                }
                None
            }
            (Item::Reasoning(kept), Some("reasoning")) => {
                // Without its encrypted content it cannot go back.
                *kept = item["encrypted_content"]
                    .as_str()
                    .filter(|e| !e.is_empty())
                    .map(|encrypted| {
                        let mut fields = Map::new();
                        fields.insert("type".into(), json!("reasoning"));
                        fields.insert("summary".into(), item["summary"].clone());
                        fields.insert("encrypted_content".into(), json!(encrypted));
                        Value::Object(fields)
                    });
                None
            }
            _ => None,
        }
    }

    /// The answer says it is over. Its `output` fills in any item no event
    /// brought; returns the text that adds.
    fn finish(&mut self, ended: Ended, response: &Value) -> Option<String> {
        self.ended = Some(ended);
        let mut shown = String::new();
        for (index, item) in response["output"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            if !self.items.contains_key(&(index as u64)) {
                shown.extend(self.done(index as u64, item));
            }
        }
        Some(shown).filter(|s| !s.is_empty())
    }

    fn failed(&mut self, error: &Value) -> Result<Option<String>, String> {
        let code = error["code"].as_str().unwrap_or_default();
        if code == "context_length_exceeded" {
            self.ended = Some(Ended::Full);
            return Ok(None);
        }
        Err(words::stream_failure(
            code,
            error["message"].as_str().unwrap_or_default(),
        ))
    }

    /// Whether the server said the answer is over.
    pub fn ended(&self) -> bool {
        self.ended.is_some()
    }

    /// Whether the answer said how it ended.
    pub fn complete(&self) -> bool {
        self.ended.is_some()
    }

    /// The answer so far. Cut short (`cancelled`), it keeps its text and
    /// none of its calls, which may be half written.
    pub fn reply(self, cancelled: bool) -> Reply {
        let mut calls = Vec::new();
        let mut items = Vec::new();
        for item in self.items.into_values() {
            match item {
                Item::Message(text) if !text.trim().is_empty() => {
                    items.push(json!({"role": "assistant", "content": text}));
                }
                Item::Call {
                    call_id,
                    name,
                    arguments,
                    namespace,
                } if !cancelled && !name.is_empty() => {
                    let call = ToolCall {
                        id: call_id,
                        name,
                        arguments,
                    };
                    items.push(call_item(
                        &call.id,
                        &call.name,
                        &call.arguments,
                        namespace.as_deref(),
                    ));
                    calls.push(call);
                }
                Item::Reasoning(Some(kept)) => items.push(kept),
                _ => {}
            }
        }
        let stop = match self.ended {
            _ if cancelled => Stop::Cancelled,
            Some(Ended::Full) => Stop::Full,
            Some(Ended::Length) => Stop::Length,
            Some(Ended::Refusal) => Stop::Refusal,
            _ if self.refused => Stop::Refusal,
            _ if calls.is_empty() => Stop::End,
            _ => Stop::Tools,
        };
        Reply {
            text: self.text,
            calls,
            stop,
            blocks: None,
            items: (!cancelled).then_some(items),
        }
    }
}
