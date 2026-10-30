//! The lock on the backup's branch: a GitHub ruleset that refuses force
//! pushes to, and deletion of, the default branch. Plans without rulesets for
//! private repositories refuse it, which is fine: KastenFlow never forces
//! anyway, and the answer says why in one sentence.

use reqwest::Method;
use serde_json::json;

use super::api::{Reply, send, valid_full_name};
use super::endpoints::Endpoints;
use super::failure::classify;
use crate::backup::contract::{Protection, ProtectionState};

const RULESET: &str = "KastenFlow backup";

pub const FREE_PLAN: &str = "GitHub's free plan cannot lock a private branch; KastenFlow never force-pushes, and backup files are a second copy.";
const TOKEN_CANNOT: &str = "This token cannot lock the branch; KastenFlow never force-pushes, and backup files are a second copy.";
const NOT_LOCKED: &str = "Nothing locks the backup's branch; KastenFlow never force-pushes, and backup files are a second copy.";

/// The lock on the backup's branch, as it stands.
pub async fn protection_of(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: Option<&str>,
    full: &str,
) -> Protection {
    let reply = send(
        http,
        ep,
        Method::GET,
        &format!("/repos/{full}/rulesets"),
        token,
        None,
        "read the branch lock",
    )
    .await;
    let reply = match reply {
        Ok(reply) => reply,
        Err(err) => return unknown(err.message()),
    };
    if reply.ok() {
        let ours = reply.body.as_array().is_some_and(|list| {
            list.iter().any(|r| {
                r["name"].as_str() == Some(RULESET) && r["enforcement"].as_str() != Some("disabled")
            })
        });
        return if ours {
            locked()
        } else {
            not_locked(NOT_LOCKED)
        };
    }
    refused(&reply)
}

fn locked() -> Protection {
    Protection {
        state: ProtectionState::Protected,
        reason: None,
    }
}

fn not_locked(why: &str) -> Protection {
    Protection {
        state: ProtectionState::Unprotected,
        reason: Some(why.to_owned()),
    }
}

fn unknown(why: String) -> Protection {
    Protection {
        state: ProtectionState::Unknown,
        reason: Some(why),
    }
}

/// What a refused ruleset call says about the lock.
fn refused(reply: &Reply) -> Protection {
    let said = reply.body["message"].as_str().unwrap_or("").to_lowercase();
    match reply.status {
        403 | 404 | 422 if said.contains("not accessible") => not_locked(TOKEN_CANNOT),
        403 | 404 | 422 => not_locked(FREE_PLAN),
        _ => {
            let err = classify(reply.status, &reply.rate, &reply.body, "lock the branch", 0);
            unknown(err.message())
        }
    }
}

/// Asks GitHub to lock the backup's branch; the answer says whether it did.
pub async fn protect(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    full: &str,
) -> Protection {
    if !valid_full_name(full) {
        return unknown("GitHub named a repository KastenFlow cannot use".into());
    }
    let body = json!({
        "name": RULESET,
        "target": "branch",
        "enforcement": "active",
        "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
        "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }],
    });
    let sent = send(
        http,
        ep,
        Method::POST,
        &format!("/repos/{full}/rulesets"),
        Some(token),
        Some(&body),
        "lock the branch",
    )
    .await;
    match sent {
        Ok(reply) if reply.ok() => locked(),
        // The lock is there already from an earlier try.
        Ok(reply)
            if reply.status == 422
                && reply
                    .body
                    .to_string()
                    .to_lowercase()
                    .contains("already exists") =>
        {
            locked()
        }
        Ok(reply) => refused(&reply),
        Err(err) => unknown(err.message()),
    }
}
