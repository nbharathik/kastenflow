//! Boards in memory: reading any formatting, writing the house style,
//! keeping unknown keys, and the edits agents make. Boards on disk are
//! tested in `tests/board.rs`.

mod changes;
mod connections;
mod edits;
mod extras;
mod format;
mod refusals;
mod shapes;
mod source;

use serde_json::Value;

use super::{Canvas, FileItem};
use crate::error::{Error, Result};
use crate::time::Instant;

/// The moment the integration tests use too.
const NOW: Instant = Instant {
    millis: 1_790_236_800_000,
};

fn item(path: &str, tags: &[&str]) -> FileItem {
    FileItem {
        path: path.to_owned(),
        tags: tags.iter().map(|t| (*t).to_owned()).collect(),
    }
}

fn node<'a>(canvas: &'a Canvas, id: &str) -> &'a Value {
    canvas.node(id).unwrap_or_else(|| panic!("no node {id}"))
}

fn edge<'a>(canvas: &'a Canvas, id: &str) -> &'a Value {
    let found = canvas.edges().iter().find(|e| e["id"] == id);
    found.unwrap_or_else(|| panic!("no edge {id}"))
}

fn rect(node: &Value) -> (i64, i64, i64, i64) {
    let n = |key: &str| node[key].as_i64().unwrap();
    (n("x"), n("y"), n("width"), n("height"))
}

fn keys(value: &Value) -> Vec<&str> {
    let object = value.as_object().unwrap();
    object.keys().map(String::as_str).collect()
}

fn is_hex16(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The message of an `Error::Invalid`.
fn invalid<T: std::fmt::Debug>(result: Result<T>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected Error::Invalid, got {other:?}"),
    }
}
