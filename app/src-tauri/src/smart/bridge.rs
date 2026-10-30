//! The app's side of the bridge: the calls of a smart page that need the
//! vault. The window checks the message and the rate of calls (a page cannot
//! send more than 50 a second), keeps watches alive and answers the page's
//! own housekeeping (theme, size, log); everything that reads or changes
//! notes comes here, with the path of the page it came from.

use kasten_core::smart::{BridgeCall, BridgeError, BridgeErrorCode, MAX_ANSWER_BYTES};
use kasten_core::{Instant, Kasten};
use serde_json::{Value, json};

use super::runtime::Runtime;
use super::{page, reads, writes};

fn fail(code: BridgeErrorCode, message: impl Into<String>) -> BridgeError {
    BridgeError {
        code,
        message: message.into(),
    }
}

/// The error a failed call becomes: a note or board that is not there says so,
/// the rest of what a read refuses is a bad request, and a write that is
/// refused was held back by the rules (a lock, a private folder, a limit).
fn classify(message: String, write: bool) -> BridgeError {
    let lower = message.to_lowercase();
    let code = if [
        "no note called",
        "no board called",
        "there is nothing called",
        "not found",
    ]
    .iter()
    .any(|words| lower.contains(words))
    {
        BridgeErrorCode::NotFound
    } else if write {
        BridgeErrorCode::Refused
    } else {
        BridgeErrorCode::BadRequest
    };
    fail(code, message)
}

fn read_tool(
    kasten: &Kasten,
    runtime: &Runtime,
    path: &str,
    name: &str,
    args: Value,
    now: Instant,
) -> Result<Value, String> {
    kasten_mcp::tools::call(kasten, &runtime.session(path, now), name, args)
}

/// Runs one call of the smart page at `page_path`.
pub fn handle(
    kasten: &Kasten,
    runtime: &Runtime,
    page_path: &str,
    call: &BridgeCall,
    now: Instant,
) -> Result<Value, BridgeError> {
    let note = page::read(kasten, page_path).map_err(|m| fail(BridgeErrorCode::Refused, m))?;
    let write = call.is_write();
    let outcome = match call {
        BridgeCall::Query(spec) => reads::query(kasten, spec),
        BridgeCall::List {
            project,
            tag,
            note_type,
        } => reads::list(
            kasten,
            project.as_deref(),
            tag.as_deref(),
            note_type.as_deref(),
        ),
        BridgeCall::Read { id } => read_tool(
            kasten,
            runtime,
            page_path,
            "read_note",
            json!({ "note": id }),
            now,
        ),
        BridgeCall::Search { q, limit } => read_tool(
            kasten,
            runtime,
            page_path,
            "search",
            json!({ "query": q, "limit": limit }),
            now,
        ),
        BridgeCall::Journal { date } => read_tool(
            kasten,
            runtime,
            page_path,
            "get_journal",
            json!({ "date": date }),
            now,
        ),
        BridgeCall::Project => reads::project(kasten, &note, now),
        BridgeCall::Tasks { project, tag, done } => {
            reads::tasks(kasten, project.as_deref(), tag.as_deref(), *done)
        }
        BridgeCall::Board { path } => read_tool(
            kasten,
            runtime,
            page_path,
            "read_board",
            json!({ "board": path }),
            now,
        ),
        BridgeCall::Open { target } => reads::open(kasten, target),
        _ if write => {
            let session = runtime.session(page_path, now);
            match writes::run(kasten, &session, &note, call) {
                Some(result) => result,
                None => {
                    return Err(fail(
                        BridgeErrorCode::BadRequest,
                        "That call is not one the app knows.",
                    ));
                }
            }
        }
        other => {
            return Err(fail(
                BridgeErrorCode::BadRequest,
                format!("The window answers “{}” itself.", other.kind()),
            ));
        }
    };
    let value = outcome.map_err(|m| classify(m, write))?;
    let size = serde_json::to_vec(&value).map_or(usize::MAX, |bytes| bytes.len());
    if size > MAX_ANSWER_BYTES {
        return Err(fail(
            BridgeErrorCode::TooLarge,
            "That answer is more than 2 MB. Ask for fewer notes.",
        ));
    }
    Ok(value)
}
