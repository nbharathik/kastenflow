//! The messages between a smart page and the app, as JSON on `postMessage`.
//!
//! Page to app: `{ id, kind, args }` (`BridgeRequest`). App to page: one
//! answer per request, `{ id, ok, value | error }` (`BridgeAnswer`), and
//! events nobody asked for, `{ event, ... }` (`BridgeEvent`). A call with no
//! arguments (`project`, `theme`) leaves `args` out. The TypeScript side
//! mirrors these in `app/src/lib/vault/smart-types.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::manifest::QuerySpec;

/// Which way the app looks: the page follows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SmartTheme {
    Light,
    Dark,
}

/// What kind of error a page reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorKind {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "unhandledrejection")]
    UnhandledRejection,
    #[serde(rename = "console.error")]
    ConsoleError,
}

/// An error the kit caught, as it sends it (the app adds the time).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorReport {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// One entry of a page's error log (the last `MAX_ERROR_RECORDS` are kept).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorRecord {
    /// When it happened (ISO time).
    pub time: String,
    pub kind: ErrorKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// The file `.kasten/cache/smart/<id>.log.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ErrorLog {
    #[serde(default)]
    pub records: Vec<ErrorRecord>,
}

/// What a page asks the app to do. Reads, live reads, the page's own
/// housekeeping, then writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "args",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BridgeCall {
    /// Notes tagged `tag`, filtered and sorted.
    Query(QuerySpec),
    List {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tag: Option<String>,
        /// A note type, for example `note` or `source`.
        #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
        note_type: Option<String>,
    },
    Read {
        id: String,
    },
    Search {
        q: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
    },
    /// The journal page of a day (`YYYY-MM-DD`).
    Journal {
        date: String,
    },
    /// The project this page lives in.
    Project,
    Tasks {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tag: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        done: Option<bool>,
    },
    Board {
        path: String,
    },
    /// Run `query` now and again, debounced, whenever the vault changes;
    /// each result comes as a `watch` event for `watch_id`.
    Watch {
        watch_id: String,
        query: QuerySpec,
    },
    Unwatch {
        watch_id: String,
    },
    /// Open a note by id or a page by path in the app.
    Open {
        target: String,
    },
    /// The app's theme now (answered as `"light"` or `"dark"`).
    Theme,
    /// Ask for the frame to be `px` tall.
    Resize {
        px: u32,
    },
    Log {
        args: Vec<Value>,
    },
    /// An error the kit caught.
    Report(ErrorReport),
    Update {
        id: String,
        props: Map<String, Value>,
    },
    AddTags {
        id: String,
        tags: Vec<String>,
    },
    CreateNote {
        title: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        tags: Vec<String>,
        #[serde(default, skip_serializing_if = "Map::is_empty")]
        props: Map<String, Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<String>,
    },
    Append {
        id: String,
        md: String,
    },
    /// Tick or untick the `index`th checkbox of a note (from 0).
    ToggleTodo {
        id: String,
        index: u32,
    },
}

impl BridgeCall {
    /// The `kind` as it is written on the wire.
    pub fn kind(&self) -> &'static str {
        match self {
            BridgeCall::Query(_) => "query",
            BridgeCall::List { .. } => "list",
            BridgeCall::Read { .. } => "read",
            BridgeCall::Search { .. } => "search",
            BridgeCall::Journal { .. } => "journal",
            BridgeCall::Project => "project",
            BridgeCall::Tasks { .. } => "tasks",
            BridgeCall::Board { .. } => "board",
            BridgeCall::Watch { .. } => "watch",
            BridgeCall::Unwatch { .. } => "unwatch",
            BridgeCall::Open { .. } => "open",
            BridgeCall::Theme => "theme",
            BridgeCall::Resize { .. } => "resize",
            BridgeCall::Log { .. } => "log",
            BridgeCall::Report(_) => "report",
            BridgeCall::Update { .. } => "update",
            BridgeCall::AddTags { .. } => "addTags",
            BridgeCall::CreateNote { .. } => "createNote",
            BridgeCall::Append { .. } => "append",
            BridgeCall::ToggleTodo { .. } => "toggleTodo",
        }
    }

    /// Whether the call changes the vault (and so runs as an agent actor).
    pub fn is_write(&self) -> bool {
        matches!(
            self,
            BridgeCall::Update { .. }
                | BridgeCall::AddTags { .. }
                | BridgeCall::CreateNote { .. }
                | BridgeCall::Append { .. }
                | BridgeCall::ToggleTodo { .. }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BridgeRequest {
    /// Chosen by the page; the answer carries it back.
    pub id: u32,
    #[serde(flatten)]
    pub call: BridgeCall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BridgeErrorCode {
    /// More than `MAX_CALLS_PER_SECOND` calls in a second.
    RateLimited,
    /// The answer would be more than `MAX_ANSWER_BYTES`.
    TooLarge,
    /// The guardrails or the agent mode do not allow it.
    Refused,
    /// The message did not fit the schema.
    BadRequest,
    NotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BridgeError {
    pub code: BridgeErrorCode,
    /// One plain sentence.
    pub message: String,
}

/// The answer to one request: `ok` with a `value` (left out when null), or
/// not `ok` with an `error`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BridgeAnswer {
    pub id: u32,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub value: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<BridgeError>,
}

impl BridgeAnswer {
    pub fn ok(id: u32, value: Value) -> Self {
        BridgeAnswer {
            id,
            ok: true,
            value,
            error: None,
        }
    }

    pub fn err(id: u32, code: BridgeErrorCode, message: &str) -> Self {
        BridgeAnswer {
            id,
            ok: false,
            value: Value::Null,
            error: Some(BridgeError {
                code,
                message: message.to_string(),
            }),
        }
    }
}

/// Sent to the page without being asked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BridgeEvent {
    /// First message: who the page is, the theme, and the named view to show
    /// (the `#view` of `![[Page#view]]`).
    Init {
        page_id: String,
        theme: SmartTheme,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view: Option<String>,
    },
    /// A watched query ran again.
    Watch {
        watch_id: String,
        value: Value,
    },
    Theme {
        theme: SmartTheme,
    },
}
