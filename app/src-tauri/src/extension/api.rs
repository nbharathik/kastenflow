//! What the three routes do once the door has let a request in: pair, list
//! where a capture can go, and keep one. The routes only add: nothing here
//! reads a note's text, changes or deletes anything. A capture is one
//! `capture_web` op, so it is one commit that Undo takes back.

use std::time::Instant;

use hyper::StatusCode;
use kasten_core::Kasten;
use kasten_core::clip::{Target, WebCapture};
use kasten_core::history::Actor;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::shared::{Shared, held};
use super::store::{Paired, hash, new_id, new_token};

/// How the captures from the extension are marked (`via:` on the card).
pub(super) const VIA: &str = "extension";
/// The most recent pages offered as places to quote into.
const RECENT_PAGES: usize = 15;
/// The longest label an extension may give itself.
const MAX_LABEL: usize = 40;

/// What a route answers.
pub(super) struct Reply {
    pub status: StatusCode,
    pub body: Value,
}

impl Reply {
    fn ok(body: Value) -> Reply {
        Reply {
            status: StatusCode::OK,
            body,
        }
    }

    pub fn no(status: StatusCode, why: impl Into<String>) -> Reply {
        Reply {
            status,
            body: json!({ "error": why.into() }),
        }
    }
}

/// `body` as a `T`: a JSON object (serde would also read an array as a
/// struct's fields in order), whole, with no field it does not know and none twice.
fn strict<T: DeserializeOwned>(body: &[u8]) -> Result<T, Reply> {
    if body.iter().find(|b| !b.is_ascii_whitespace()) != Some(&b'{') {
        return Err(bad("That request is not a JSON object"));
    }
    serde_json::from_slice(body).map_err(|e| {
        Reply::no(
            StatusCode::BAD_REQUEST,
            format!("That request is not what KastenFlow expects: {e}"),
        )
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairBody {
    code: String,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TargetBody {
    kind: String,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    heading: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CaptureBody {
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    html: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    target: Option<TargetBody>,
    #[serde(default)]
    tags: Vec<String>,
}

fn bad(why: &str) -> Reply {
    Reply::no(StatusCode::BAD_REQUEST, why)
}

/// Where a capture goes, or why the request names no place.
fn target_of(body: Option<TargetBody>) -> Result<Target, Reply> {
    let Some(body) = body else {
        return Ok(Target::Inbox);
    };
    let wants = |kept: &[&Option<String>]| kept.iter().all(|v| v.is_none());
    match body.kind.as_str() {
        "inbox" if wants(&[&body.project, &body.path, &body.heading]) => Ok(Target::Inbox),
        "project" if wants(&[&body.path, &body.heading]) => match body.project {
            Some(name) if !name.trim().is_empty() => Ok(Target::Project(name)),
            _ => Err(bad("A project target names the project")),
        },
        "page" if wants(&[&body.project]) => match body.path {
            Some(path)
                if path.ends_with(".md")
                    && !path.contains(['\\', '\0'])
                    && !path.contains("..") =>
            {
                Ok(Target::Page {
                    path,
                    heading: body.heading,
                })
            }
            _ => Err(bad("A page target names the page's path")),
        },
        "inbox" | "project" | "page" => Err(bad("That place has a field it does not use")),
        _ => Err(bad("A place is the inbox, a project or a page")),
    }
}

/// A label for the paired list: what the extension calls itself, without
/// control characters and not too long.
fn clean_label(label: &str) -> String {
    let text: String = label
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_LABEL)
        .collect();
    let text = text.trim();
    if text.is_empty() {
        "Browser".to_owned()
    } else {
        text.to_owned()
    }
}

/// Takes a pairing code and, if it is right, gives the extension a token
/// that is shown this once. `origin` is the extension's own, from the door.
pub(super) fn pair(shared: &Shared, origin: &str, body: &[u8], now: Instant, at_ms: u64) -> Reply {
    let request: PairBody = match strict(body) {
        Ok(request) => request,
        Err(reply) => return reply,
    };
    if !held(&shared.store).has_room_for(origin) {
        return Reply::no(
            StatusCode::CONFLICT,
            "Too many extensions are paired. Revoke one in KastenFlow's Settings first",
        );
    }
    if let Err(refused) = held(&shared.pairing).attempt(&request.code, now) {
        return Reply::no(StatusCode::FORBIDDEN, refused.words());
    }
    let (token, id) = match (new_token(), new_id()) {
        (Ok(token), Ok(id)) => (token, id),
        (Err(why), _) | (_, Err(why)) => {
            return Reply::no(StatusCode::INTERNAL_SERVER_ERROR, why);
        }
    };
    let paired = Paired {
        id: id.clone(),
        label: clean_label(request.label.as_deref().unwrap_or("")),
        origin: origin.to_owned(),
        token_hash: hash(&token),
        paired_at: at_ms,
    };
    if let Err(why) = held(&shared.store).add(paired) {
        return Reply::no(StatusCode::INTERNAL_SERVER_ERROR, why);
    }
    let vault = (shared.vault)()
        .map(|kasten| kasten.config().name.clone())
        .unwrap_or_default();
    Reply::ok(json!({ "token": token, "id": id, "vault": vault }))
}

/// The open vault, or the reply that says it is not there.
fn vault(shared: &Shared) -> Result<std::sync::Arc<Kasten>, Reply> {
    (shared.vault)().map_err(|why| Reply::no(StatusCode::SERVICE_UNAVAILABLE, why))
}

/// Where a capture can go: the inbox, the projects and the pages touched
/// lately, by name and path only (never a word of a note's text).
pub(super) fn targets(shared: &Shared) -> Reply {
    let kasten = match vault(shared) {
        Ok(kasten) => kasten,
        Err(reply) => return reply,
    };
    let listed = crate::crash::caught(|| kasten.list().map_err(|e| e.to_string()));
    let notes = match listed {
        Ok(notes) => notes,
        Err(why) => return Reply::no(StatusCode::INTERNAL_SERVER_ERROR, why),
    };
    let mut projects: Vec<(&str, &str)> = notes
        .iter()
        .filter(|n| n.kind == "project")
        .filter_map(|n| Some((n.project.as_deref()?, n.title.as_str())))
        .collect();
    projects.sort_by_key(|(slug, title)| (title.to_lowercase(), *slug));
    projects.dedup_by_key(|(slug, _)| *slug);
    let mut pages: Vec<_> = notes
        .iter()
        .filter(|n| matches!(n.kind.as_str(), "page" | "card"))
        .collect();
    pages.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.path.cmp(&b.path))
    });
    pages.truncate(RECENT_PAGES);
    Reply::ok(json!({
        "vault": kasten.config().name.clone(),
        "inbox": { "name": "Captures" },
        "projects": projects.iter().map(|(id, name)| json!({ "id": id, "name": name })).collect::<Vec<_>>(),
        "pages": pages.iter().map(|n| json!({ "path": n.path, "title": n.title })).collect::<Vec<_>>(),
    }))
}

/// Keeps a capture: a card in the inbox or a project, or a quote added to a
/// page. One commit; a refusal writes nothing.
pub(super) fn capture(shared: &Shared, body: &[u8]) -> Reply {
    let request: CaptureBody = match strict(body) {
        Ok(request) => request,
        Err(reply) => return reply,
    };
    let target = match target_of(request.target) {
        Ok(target) => target,
        Err(reply) => return reply,
    };
    let kasten = match vault(shared) {
        Ok(kasten) => kasten,
        Err(reply) => return reply,
    };
    let capture = WebCapture {
        url: request.url,
        title: request.title,
        html: request.html,
        text: request.text,
        via: VIA.to_owned(),
        tags: request.tags,
    };
    let made = crate::crash::caught(|| {
        Ok(kasten.capture_web(
            &Actor::Human,
            &capture,
            &target,
            kasten_core::Instant::now(),
        ))
    });
    let note = match made {
        Ok(Ok(note)) => note,
        Ok(Err(kasten_core::Error::NotFound(what))) => {
            return Reply::no(StatusCode::NOT_FOUND, format!("There is no {what}"));
        }
        Ok(Err(kasten_core::Error::Invalid(why))) => {
            return Reply::no(StatusCode::UNPROCESSABLE_ENTITY, why);
        }
        Ok(Err(other)) => {
            return Reply::no(StatusCode::INTERNAL_SERVER_ERROR, other.to_string());
        }
        Err(why) => return Reply::no(StatusCode::INTERNAL_SERVER_ERROR, why),
    };
    // A new card may also have made the tag's database.
    let mut paths = vec![note.meta.path.clone()];
    if !matches!(target, Target::Page { .. }) {
        paths.push("tags/capture.yaml".to_owned());
    }
    (shared.changed)(paths);
    let place = match &target {
        Target::Inbox => "Captures".to_owned(),
        Target::Project(name) => name.clone(),
        Target::Page { .. } => note.meta.title.clone(),
    };
    Reply::ok(
        json!({ "ok": true, "path": note.meta.path, "title": note.meta.title, "place": place }),
    )
}
