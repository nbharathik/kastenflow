//! The tools an AI agent builds decks with, as a library. Nothing here knows
//! about a protocol or a disk: [`tools`] lists the tools with their
//! descriptions and JSON Schemas, [`instructions`] is what a server tells the
//! agent when it connects, and [`Agent::call`] runs one tool on a [`Store`].
//! `slides mcp` wraps them for a folder of decks; Kasten wraps them for a
//! vault. Every tool is a few operations of the deck engine (see [`crate::ops`]),
//! so everything an agent does is one undoable step, and nothing is deleted.

mod catalog;
mod create;
mod edit;
mod files;
mod images;
mod instructions;
mod memory;
mod place;
mod raw;
mod read;
mod session;
mod specs;
mod steps;
mod store;
mod template;
#[cfg(test)]
mod tests;

use std::fmt;

use serde_json::Value;

pub use images::{Kind as ImageKind, base64_encode, dimensions, sniff};
pub use instructions::{Facts, instructions, instructions_for};
pub use memory::{MemoryStore, hash_of};
pub use session::Agent;
pub use specs::{ToolSpec, tools};
pub use store::{
    AssetInfo, DeckInfo, DeckText, Draw, Drawn, Imported, Saved, Store, StoreError, StoreResult,
    Written,
};

use crate::error::Error;

/// A picture a tool returns.
#[derive(Clone, Debug, PartialEq)]
pub struct Image {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// What a tool answered.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ToolOutput {
    /// The answer in words or JSON text, for the agent to read.
    pub text: String,
    /// The same as structured JSON, for a host that shows it another way.
    pub data: Option<Value>,
    /// Pictures, when a tool draws.
    pub images: Vec<Image>,
}

impl ToolOutput {
    pub fn text(text: impl Into<String>) -> ToolOutput {
        ToolOutput {
            text: text.into(),
            ..ToolOutput::default()
        }
    }

    /// A JSON answer: the text is the JSON, written for reading.
    pub fn json(value: Value) -> ToolOutput {
        ToolOutput {
            text: serde_json::to_string_pretty(&value).unwrap_or_default(),
            data: Some(value),
            images: Vec::new(),
        }
    }
}

/// Why a tool did not do what it was asked: a sentence the agent can act on.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolError {
    pub message: String,
}

impl ToolError {
    pub fn new(message: impl Into<String>) -> ToolError {
        ToolError {
            message: message.into(),
        }
    }
}

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ToolError {}

impl From<Error> for ToolError {
    fn from(e: Error) -> ToolError {
        ToolError::new(e.to_string())
    }
}

impl From<StoreError> for ToolError {
    fn from(e: StoreError) -> ToolError {
        ToolError::new(e.to_string())
    }
}

pub type ToolResult = Result<ToolOutput, ToolError>;

/// Runs one tool with nothing remembered from before: every call reads the
/// deck as it is. A server that keeps a connection uses an [`Agent`] instead,
/// which notices when a deck changed under it.
pub fn call(store: &mut dyn Store, name: &str, args: Value) -> ToolResult {
    Agent::new().call(store, name, args)
}
