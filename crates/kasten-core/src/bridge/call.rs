//! What travels in the mailbox: the things the app can be asked to do
//! (`Call`, the one list to extend), and the request and reply files.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::agent::Session;
use crate::error::{Error, Result};

/// The longest document name a request may carry.
const MAX_DOC_BYTES: usize = 300;
/// How long, in milliseconds, a build may be waited for in one request.
pub const MAX_WAIT_MS: u64 = 300_000;

fn default_wait() -> u64 {
    90_000
}

/// Something the app is asked to do. A request holds one as a `kind` string
/// and a `params` object; this is the typed form both ends use. To add a
/// kind: add a variant here, its name to `KINDS` and `kind()`, what it names to
/// `check()`, and the app's handler.
///
/// A call never names a program, a path outside the vault or a network
/// address: only documents of the vault, by their folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "params", rename_all = "snake_case")]
pub enum Call {
    /// Build the LaTeX document in the folder `doc` now, and wait up to
    /// `wait_ms` for the build to end.
    ///
    /// With `preview`, the app builds what the asker's waiting changes would
    /// make of the files (the request's session says whose) in a scratch
    /// folder, and leaves the document's own build, and its last good PDF,
    /// alone. No text travels in the request: the app reads the changes
    /// itself.
    LatexBuild {
        doc: String,
        #[serde(default = "default_wait")]
        wait_ms: u64,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        preview: bool,
    },
    /// Build the document if it needs it, and keep its PDF in its folder.
    /// `reason` is for the person who reviews it.
    LatexExportPdf {
        doc: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Draw the diagram at the vault path `diagram` (one of its `page`s, by
    /// name) as a PNG in the app's window and answer with the picture. The app
    /// draws the picture the core already made and cleaned; it fetches nothing.
    DiagramPng {
        diagram: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        page: Option<String>,
    },
    /// The asker would like to read the person's selection: the app shares it
    /// (in `selection.json`, see `selection.rs`) for the next two minutes.
    WatchSelection {},
}

/// The longest page name a request may carry.
const MAX_PAGE_BYTES: usize = 200;

impl Call {
    /// Every kind there is, as written in a request.
    pub const KINDS: [&'static str; 4] = [
        "latex_build",
        "latex_export_pdf",
        "diagram_png",
        "watch_selection",
    ];

    /// The kind, as written in a request.
    pub fn kind(&self) -> &'static str {
        match self {
            Call::LatexBuild { .. } => "latex_build",
            Call::LatexExportPdf { .. } => "latex_export_pdf",
            Call::DiagramPng { .. } => "diagram_png",
            Call::WatchSelection {} => "watch_selection",
        }
    }

    /// The vault path the call is about: a document's folder, or a diagram's
    /// file. Empty for a call that is about no place.
    pub fn doc(&self) -> &str {
        match self {
            Call::LatexBuild { doc, .. } | Call::LatexExportPdf { doc, .. } => doc,
            Call::DiagramPng { diagram, .. } => diagram,
            Call::WatchSelection {} => "",
        }
    }

    /// The `params` object of a request for this call.
    pub fn params(&self) -> Value {
        serde_json::to_value(self)
            .ok()
            .and_then(|mut v| v.get_mut("params").map(Value::take))
            .unwrap_or_else(|| json!({}))
    }

    /// The call a `kind` and `params` make; why not, in a plain sentence.
    pub fn parse(kind: &str, params: &Value) -> std::result::Result<Call, String> {
        if !Self::KINDS.contains(&kind) {
            return Err(format!(
                "The app does not know how to do “{}”",
                kind.chars().take(60).collect::<String>()
            ));
        }
        serde_json::from_value(json!({ "kind": kind, "params": params }))
            .map_err(|_| format!("The request for {kind} is not complete"))
    }

    /// Whether the call names only things inside the vault (a call about no
    /// place names nothing).
    pub fn check(&self) -> Result<()> {
        match self {
            Call::WatchSelection {} => Ok(()),
            Call::DiagramPng { diagram, page } => {
                inside_the_vault(diagram)?;
                match page {
                    Some(page)
                        if page.len() > MAX_PAGE_BYTES || page.chars().any(char::is_control) =>
                    {
                        Err(Error::Invalid(
                            "That page name is too long or has odd characters in it".to_owned(),
                        ))
                    }
                    _ => Ok(()),
                }
            }
            _ => inside_the_vault(self.doc()),
        }
    }
}

/// A vault path, plain: relative, no `..`, no drive or network name, no
/// backslash, nothing hidden (`.kasten`, `.git`), no control character.
pub(super) fn inside_the_vault(doc: &str) -> Result<()> {
    let bad = |why: &str| {
        Err(Error::Invalid(format!(
            "“{}” is not a document of this vault ({why})",
            doc.chars().take(60).collect::<String>()
        )))
    };
    if doc.is_empty() {
        return bad("it names nothing");
    }
    if doc.len() > MAX_DOC_BYTES {
        return bad("the name is too long");
    }
    if doc.starts_with('/') || doc.contains(['\\', ':']) || doc.chars().any(char::is_control) {
        return bad("a vault path is relative and uses /");
    }
    for part in doc.trim_end_matches('/').split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return bad("it leaves the folder it is in");
        }
        if part.starts_with('.') {
            return bad("it is in a hidden folder");
        }
    }
    Ok(())
}

/// A request file: who asks, for what, and when.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    /// Unguessable; also the file's name.
    pub id: String,
    /// One of `Call::KINDS`.
    pub kind: String,
    /// The call's parameters, a JSON object.
    pub params: Value,
    /// The agent's session, for what is written in its name.
    #[serde(default)]
    pub session: Option<Session>,
    /// When it was made (milliseconds since the Unix epoch).
    pub created: u64,
}

impl Request {
    pub fn new(id: String, call: &Call, session: Option<&Session>, created: u64) -> Request {
        Request {
            id,
            kind: call.kind().to_owned(),
            params: call.params(),
            session: session.cloned(),
            created,
        }
    }

    /// The typed call, checked: why not, in a plain sentence.
    pub fn call(&self) -> std::result::Result<Call, String> {
        let call = Call::parse(&self.kind, &self.params)?;
        call.check().map_err(|err| err.to_string())?;
        Ok(call)
    }
}

/// The app's answer to a request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reply {
    /// The request's id.
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub result: Value,
    /// One plain sentence, when not `ok`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Reply {
    pub fn ok(id: &str, result: Value) -> Reply {
        Reply {
            id: id.to_owned(),
            ok: true,
            result,
            error: None,
        }
    }

    pub fn failed(id: &str, error: impl Into<String>) -> Reply {
        Reply {
            id: id.to_owned(),
            ok: false,
            result: Value::Null,
            error: Some(error.into()),
        }
    }
}
