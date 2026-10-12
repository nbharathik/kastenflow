//! OpenAI-compatible chat completions, as OpenAI, vLLM, Ollama and others
//! serve them: the request, and the stream of `data:` chunks that answers
//! it. Servers differ in what they leave out (ids, indexes, the final
//! `[DONE]`), so each chunk is read for what it has.

use kasten_core::{Instant, ulid_at};
use serde_json::{Value, json};

use super::model::{Call, Message, Reply, Stop, ToolCall, tool_schema};
use super::sse::SseEvent;

/// `/chat/completions` under `base`, such as `https://api.openai.com/v1`
/// or `http://llm-server:8000/v1`.
pub fn url(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(
            "An OpenAI-compatible provider needs its base URL, such as http://localhost:8000/v1"
                .to_owned(),
        );
    }
    if base.ends_with("/chat/completions") {
        return Ok(base.to_owned());
    }
    Ok(format!("{base}/chat/completions"))
}

pub fn body(url: &str, model: &str, max_tokens: u32, call: &Call<'_>) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages(call.system, call.messages),
        "stream": true,
    });
    // OpenAI's reasoning models refuse the older `max_tokens`; servers such
    // as vLLM and Ollama take it.
    let limit = if url.starts_with("https://api.openai.com/") {
        "max_completion_tokens"
    } else {
        "max_tokens"
    };
    body[limit] = json!(max_tokens);
    if !call.tools.is_empty() {
        let tools: Vec<Value> = call
            .tools
            .iter()
            .map(|t| {
                json!({"type": "function", "function": {
                    "name": t.name, "description": t.description, "parameters": tool_schema(t)
                }})
            })
            .collect();
        body["tools"] = json!(tools);
    }
    body
}

/// Arguments as they go back to the server. Some servers parse the ones in
/// the history, so arguments that were not JSON go back as `{}`; the tool's
/// error told the model what was wrong with them.
pub(super) fn arguments(call: &ToolCall) -> String {
    match call.input() {
        Ok(_) if !call.arguments.trim().is_empty() => call.arguments.clone(),
        _ => "{}".to_owned(),
    }
}

/// The thread as `messages`, the system prompt first.
pub fn messages(system: &str, thread: &[Message]) -> Vec<Value> {
    let mut out = Vec::new();
    if !system.is_empty() {
        out.push(json!({"role": "system", "content": system}));
    }
    for message in thread {
        match message {
            Message::User(text) => out.push(json!({"role": "user", "content": text})),
            Message::Assistant(reply) => {
                let mut message = json!({"role": "assistant", "content": reply.text});
                if !reply.calls.is_empty() {
                    if reply.text.is_empty() {
                        message["content"] = Value::Null;
                    }
                    let calls: Vec<Value> = reply
                        .calls
                        .iter()
                        .map(|c| {
                            json!({"id": c.id, "type": "function", "function": {
                                "name": c.name, "arguments": arguments(c)
                            }})
                        })
                        .collect();
                    message["tool_calls"] = json!(calls);
                }
                out.push(message);
            }
            Message::Results(results) => {
                for result in results {
                    let content = if result.is_error {
                        format!("Error: {}", result.content)
                    } else {
                        result.content.clone()
                    };
                    out.push(
                        json!({"role": "tool", "tool_call_id": result.id, "content": content}),
                    );
                }
            }
        }
    }
    out
}

#[derive(Debug, Default)]
struct Partial {
    index: Option<u64>,
    id: String,
    name: String,
    arguments: String,
}

/// An answer being streamed.
#[derive(Debug, Default)]
pub struct Stream {
    text: String,
    calls: Vec<Partial>,
    stop: Option<String>,
    done: bool,
}

impl Stream {
    /// Reads one event; returns the text it adds, if any.
    pub fn event(&mut self, event: &SseEvent) -> Result<Option<String>, String> {
        let data = event.data.trim();
        if data == "[DONE]" {
            self.done = true;
            return Ok(None);
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            return Ok(None);
        };
        if let Some(error) = chunk.get("error").filter(|e| !e.is_null()) {
            let message = error["message"].as_str().or(error.as_str());
            return Err(message.unwrap_or("the stream failed").to_owned());
        }
        // A chunk with usage alone has no choices.
        let Some(choice) = chunk["choices"].as_array().and_then(|c| c.first()) else {
            return Ok(None);
        };
        let delta = &choice["delta"];
        let mut piece = String::new();
        for key in ["content", "refusal"] {
            if let Some(text) = delta[key].as_str() {
                piece.push_str(text);
            }
        }
        for call in delta["tool_calls"].as_array().into_iter().flatten() {
            self.tool_delta(call);
        }
        if let Some(reason) = choice["finish_reason"].as_str() {
            self.stop = Some(reason.to_owned());
        }
        self.text.push_str(&piece);
        Ok(Some(piece).filter(|p| !p.is_empty()))
    }

    /// A piece of a tool call: found by its index, else its id, else it
    /// continues the last one.
    fn tool_delta(&mut self, delta: &Value) {
        let index = delta["index"].as_u64();
        let id = delta["id"].as_str().unwrap_or_default();
        let found = match index {
            Some(i) => self.calls.iter().position(|c| c.index == Some(i)),
            None if !id.is_empty() => self.calls.iter().position(|c| c.id == id),
            None => self.calls.len().checked_sub(1),
        };
        let at = found.unwrap_or_else(|| {
            self.calls.push(Partial {
                index,
                ..Partial::default()
            });
            self.calls.len() - 1
        });
        let call = &mut self.calls[at];
        if call.id.is_empty() {
            call.id = id.to_owned();
        }
        let function = &delta["function"];
        if let Some(name) = function["name"].as_str()
            && call.name.is_empty()
        {
            call.name = name.to_owned();
        }
        match &function["arguments"] {
            Value::String(piece) => call.arguments.push_str(piece),
            Value::Null => {}
            // A few servers send the arguments as an object.
            whole => call.arguments.push_str(&whole.to_string()),
        }
    }

    /// Whether the server said the answer is complete.
    pub fn ended(&self) -> bool {
        self.done
    }

    /// Whether the answer said how it ended, even if `[DONE]` never came.
    pub fn complete(&self) -> bool {
        self.done || self.stop.is_some()
    }

    /// The answer so far; cut short (`cancelled`), without its tool calls.
    pub fn reply(self, cancelled: bool) -> Reply {
        let stop = if cancelled {
            Stop::Cancelled
        } else {
            match self.stop.as_deref() {
                Some("tool_calls" | "function_call") => Stop::Tools,
                Some("length") => Stop::Length,
                Some("content_filter") => Stop::Refusal,
                _ => Stop::End,
            }
        };
        let calls = if cancelled {
            Vec::new()
        } else {
            self.calls
                .into_iter()
                .filter(|c| !c.name.is_empty())
                .map(|c| ToolCall {
                    id: if c.id.is_empty() {
                        format!("call_{}", ulid_at(Instant::now().millis).to_lowercase())
                    } else {
                        c.id
                    },
                    name: c.name,
                    arguments: c.arguments,
                })
                .collect()
        };
        Reply {
            text: self.text,
            calls,
            stop,
            blocks: None,
            items: None,
        }
    }
}
