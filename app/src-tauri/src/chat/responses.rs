//! OpenAI's Responses API, which a ChatGPT sign-in speaks: the request, and
//! the stream of typed events that answers it. Nothing is stored on
//! OpenAI's side (`store: false`), so each request carries the whole
//! thread, and an answer's items (encrypted reasoning, text, function
//! calls) are kept as they came, to go back with the next request. They
//! live in `Reply::items`, never in `blocks`, so a thread that switches
//! provider never sends one provider's items to another. Unknown events,
//! items and fields are skipped, so a newer API still streams.

mod stream;

use kasten_mcp::tools::ToolSpec;
use serde_json::{Value, json};

use super::model::{Call, Message, tool_schema};
use super::openai::arguments;

pub use stream::Stream;

/// The Responses API the sign-in's tokens are for. Fixed: no setting in a
/// vault can name another address.
pub const URL: &str = "https://api.openai.com/v1/responses";

/// What a request holds beyond the plain thread, as the server has been
/// found to take it. The first request asks for everything; a server that
/// names a feature it does not support gets the next one without it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    /// Ask for the reasoning, encrypted, so it can go back with the next
    /// request.
    pub reasoning: bool,
    /// Group the tools in one namespace instead of listing them flat.
    pub namespaced: bool,
}

impl Default for Shape {
    fn default() -> Shape {
        Shape {
            reasoning: true,
            namespaced: false,
        }
    }
}

impl Shape {
    /// The shape to try after the server refused this one with `body`, if
    /// the refusal names a feature the request can do without.
    pub fn adapted(self, body: &str) -> Option<Shape> {
        let parsed: Value = serde_json::from_str(body).ok()?;
        let error = &parsed["error"];
        let said = |key: &str| error[key].as_str().unwrap_or_default();
        let all = format!("{} {} {}", said("code"), said("param"), said("message")).to_lowercase();
        if !(all.contains("unsupported") || all.contains("unknown") || all.contains("not allowed"))
        {
            return None;
        }
        if self.reasoning && (all.contains("include") || all.contains("reasoning")) {
            return Some(Shape {
                reasoning: false,
                ..self
            });
        }
        if !self.namespaced && (all.contains("tool") || all.contains("function")) {
            return Some(Shape {
                namespaced: true,
                ..self
            });
        }
        None
    }
}

/// The tools in the request's form: one function each, or all of them in
/// a namespace.
fn tools(specs: &[ToolSpec], namespaced: bool) -> Value {
    let functions: Vec<Value> = specs
        .iter()
        .map(|t| {
            json!({"type": "function", "name": t.name, "description": t.description,
                "parameters": tool_schema(t)})
        })
        .collect();
    if namespaced {
        json!([{"type": "namespace", "name": "kasten",
            "description": "KastenFlow's tools for the notes, boards and decks in the vault.",
            "tools": functions}])
    } else {
        json!(functions)
    }
}

/// The request. The system prompt goes as `instructions`, since this route
/// refuses a system message, and nothing else it refuses (a token limit,
/// a temperature, a previous response) is sent.
pub fn body(model: &str, call: &Call<'_>, shape: Shape) -> Value {
    let mut body = json!({
        "model": model,
        "input": input(call.messages),
        "store": false,
        "stream": true,
    });
    if !call.system.is_empty() {
        body["instructions"] = json!(call.system);
    }
    if shape.reasoning {
        body["include"] = json!(["reasoning.encrypted_content"]);
    }
    if !call.tools.is_empty() {
        body["tools"] = tools(call.tools, shape.namespaced);
    }
    body
}

/// The thread as `input`: an answer from this API goes back as the items
/// it came as; one from another provider as its text and calls.
pub fn input(thread: &[Message]) -> Vec<Value> {
    let mut out = Vec::new();
    for message in thread {
        match message {
            Message::User(text) => out.push(json!({"role": "user", "content": text})),
            Message::Assistant(reply) => match &reply.items {
                Some(items) => out.extend(items.iter().cloned()),
                None => {
                    if !reply.text.trim().is_empty() {
                        out.push(json!({"role": "assistant", "content": reply.text}));
                    }
                    out.extend(
                        reply
                            .calls
                            .iter()
                            .map(|c| call_item(&c.id, &c.name, &arguments(c), None)),
                    );
                }
            },
            Message::Results(results) => {
                for result in results {
                    let output = if result.is_error {
                        format!("Error: {}", result.content)
                    } else {
                        result.content.clone()
                    };
                    out.push(json!({"type": "function_call_output", "call_id": result.id, "output": output}));
                }
            }
        }
    }
    out
}

fn call_item(call_id: &str, name: &str, arguments: &str, namespace: Option<&str>) -> Value {
    let mut item =
        json!({"type": "function_call", "call_id": call_id, "name": name, "arguments": arguments});
    if let Some(namespace) = namespace {
        item["namespace"] = json!(namespace);
    }
    item
}

/// Takes the function calls out of an answer's items, which will not run,
/// and the reasoning that led only to them.
pub fn without_calls(items: &mut Vec<Value>) {
    items.retain(|item| item["type"] != "function_call");
    while items.last().is_some_and(|item| item["type"] == "reasoning") {
        items.pop();
    }
}
