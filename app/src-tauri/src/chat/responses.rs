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

use super::capabilities::Applied;
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
    /// Send the reasoning effort the person asked for, if they did. Dropped
    /// first when the server turns it down (and remembered for that model,
    /// not for the route: this stays true in what the account learns).
    pub effort: bool,
    /// Ask for the reasoning, encrypted, so it can go back with the next
    /// request.
    pub reasoning: bool,
    /// Group the tools in one namespace instead of listing them flat.
    pub namespaced: bool,
}

impl Default for Shape {
    fn default() -> Shape {
        Shape {
            effort: true,
            reasoning: true,
            namespaced: false,
        }
    }
}

/// A part of the request that a refusal can name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Part {
    Effort,
    Include,
    Tools,
}

/// The part the refusal's `param` names, which is the surest word the
/// server gives (`include`, `reasoning.effort`, `tools[0]`).
fn named_by_param(param: &str) -> Option<Part> {
    let param = param.trim();
    if param.starts_with("include") {
        Some(Part::Include)
    } else if param.starts_with("reasoning") {
        Some(Part::Effort)
    } else if param.starts_with("tools") || param.starts_with("tool_choice") {
        Some(Part::Tools)
    } else {
        None
    }
}

/// The part the words of a refusal speak of, for a refusal whose `param`
/// names none: the `include` parameter's own name has "reasoning" in it, and
/// is not an effort.
fn named_by_words(all: &str) -> Option<Part> {
    let include = all.contains("include") || all.contains("encrypted");
    if all.contains("effort") || (all.contains("reasoning") && !include) {
        Some(Part::Effort)
    } else if include || all.contains("reasoning") {
        Some(Part::Include)
    } else if all.contains("tool") || all.contains("function") {
        Some(Part::Tools)
    } else {
        None
    }
}

impl Shape {
    /// The shape to try after the server refused this one with `body`, if
    /// the refusal names a part the request can do without. The refusal's
    /// `param` is read first and its words only when `param` names nothing
    /// known. `sent_effort` is whether the request carried a reasoning
    /// effort: a refusal of "reasoning" cannot be about one that was not
    /// sent, so it is about the encrypted reasoning.
    pub fn adapted(self, body: &str, sent_effort: bool) -> Option<Shape> {
        let parsed: Value = serde_json::from_str(body).ok()?;
        let error = &parsed["error"];
        let said = |key: &str| error[key].as_str().unwrap_or_default().to_lowercase();
        let (code, param, message) = (said("code"), said("param"), said("message"));
        let all = format!("{code} {param} {message}");
        if !(all.contains("unsupported") || all.contains("unknown") || all.contains("not allowed"))
        {
            return None;
        }
        match named_by_param(&param).or_else(|| named_by_words(&all))? {
            Part::Effort if self.effort && sent_effort => Some(Shape {
                effort: false,
                ..self
            }),
            Part::Effort | Part::Include if self.reasoning => Some(Shape {
                reasoning: false,
                ..self
            }),
            Part::Tools if !self.namespaced => Some(Shape {
                namespaced: true,
                ..self
            }),
            _ => None,
        }
    }

    /// The parts of the request that `next` leaves out and this one has:
    /// what a refusal taught.
    pub fn dropped(self, next: Shape) -> Vec<crate::chat::chatgpt::Feature> {
        use crate::chat::chatgpt::Feature;
        let mut parts = Vec::new();
        if self.effort && !next.effort {
            parts.push(Feature::Effort);
        }
        if self.reasoning && !next.reasoning {
            parts.push(Feature::Include);
        }
        if !self.namespaced && next.namespaced {
            parts.push(Feature::Flat);
        }
        parts
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
/// a temperature, a previous response) is sent: of `applied` only the
/// reasoning effort is read, and only while the shape allows it.
pub fn body(model: &str, call: &Call<'_>, shape: Shape, applied: &Applied) -> Value {
    let mut body = json!({
        "model": model,
        "input": input(call.messages),
        "store": false,
        "stream": true,
    });
    if !call.system.is_empty() {
        body["instructions"] = json!(call.system);
    }
    if let Some(effort) = applied.effort.filter(|_| shape.effort) {
        body["reasoning"] = json!({"effort": effort.as_str()});
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
            Message::UserImages { text, images } => {
                out.push(json!({"role": "user", "content": super::parts::responses(text, images)}))
            }
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
