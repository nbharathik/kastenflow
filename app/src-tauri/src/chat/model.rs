//! A thread's conversation in no provider's format, and the model that
//! answers it. The HTTP model speaks to real providers; tests use a fake,
//! so the loop is tested without a network.

use std::future::Future;
use std::sync::atomic::AtomicBool;

use kasten_mcp::tools::ToolSpec;
use serde_json::{Value, json};

/// A tool call as the model made it.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// The arguments as the model wrote them: JSON text, maybe broken.
    pub arguments: String,
}

impl ToolCall {
    /// The arguments as JSON, or why they are not.
    pub fn input(&self) -> Result<Value, String> {
        if self.arguments.trim().is_empty() {
            return Ok(json!({}));
        }
        serde_json::from_str(&self.arguments).map_err(|e| e.to_string())
    }
}

/// Why an answer ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stop {
    /// The model finished.
    End,
    /// The model wants its tool calls run.
    Tools,
    /// The answer hit its token limit.
    Length,
    /// The conversation no longer fits the model's context window.
    Full,
    /// The model or its provider declined to go on.
    Refusal,
    /// The person stopped it.
    Cancelled,
}

/// One answer from the model.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub text: String,
    pub calls: Vec<ToolCall>,
    pub stop: Stop,
    /// Anthropic's content blocks as they came, thinking and signatures
    /// included: sent back unchanged, as the API requires.
    pub blocks: Option<Vec<Value>>,
    /// The Responses API's output items as they go back (reasoning with its
    /// encrypted content, text, function calls). Only that API reads them:
    /// a thread that switches provider sends the text and calls instead.
    pub items: Option<Vec<Value>>,
}

impl Reply {
    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty() && self.calls.is_empty()
    }
}

/// A tool's result as the model reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolOutput {
    pub id: String,
    pub content: String,
    pub is_error: bool,
}

/// One entry of a thread, appended in order and never changed, so each
/// request repeats the ones before it byte for byte.
#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    User(String),
    Assistant(Reply),
    /// The results of the tool calls in the answer before.
    Results(Vec<ToolOutput>),
}

/// What one request to the model holds.
#[derive(Debug, Clone, Copy)]
pub struct Call<'a> {
    pub system: &'a str,
    pub messages: &'a [Message],
    pub tools: &'a [ToolSpec],
}

/// A request that failed, with what the model had said by then.
#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub message: String,
    pub partial: Option<Reply>,
}

impl Failure {
    pub fn new(message: impl Into<String>) -> Failure {
        Failure {
            message: message.into(),
            partial: None,
        }
    }
}

/// A model that answers a conversation.
pub trait Model: Send + Sync {
    /// Streams one answer, passing each piece of text to `text` as it
    /// comes. Once `cancel` is set it ends early with `Stop::Cancelled`.
    fn reply(
        &self,
        call: &Call<'_>,
        text: &(dyn Fn(&str) + Sync),
        cancel: &AtomicBool,
    ) -> impl Future<Output = Result<Reply, Failure>> + Send;
}

/// A tool's argument schema as providers take it: the JSON Schema draft
/// that MCP names in `$schema` is left out, since not every endpoint
/// accepts the key.
pub fn tool_schema(spec: &ToolSpec) -> Value {
    let mut schema = spec.input_schema.clone();
    if let Some(object) = schema.as_object_mut() {
        object.remove("$schema");
    }
    schema
}

/// The whole text of one answer without tools, for one-shot uses such as
/// the board brainstorm.
pub(crate) async fn complete(
    model: &impl Model,
    system: &str,
    user: &str,
) -> Result<String, String> {
    let messages = [Message::User(user.to_owned())];
    let call = Call {
        system,
        messages: &messages,
        tools: &[],
    };
    let reply = model
        .reply(&call, &|_| {}, &AtomicBool::new(false))
        .await
        .map_err(|f| f.message)?;
    match reply.stop {
        Stop::Length => Err("The answer reached its length limit".to_owned()),
        Stop::Full => Err("The request is longer than the model can read".to_owned()),
        Stop::Refusal => Err("The model declined to answer".to_owned()),
        _ => Ok(reply.text),
    }
}
