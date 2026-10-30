//! The GitHub backend against a mock GitHub on this computer.

mod device;
mod lists;
mod mock;
mod repo_calls;
mod token_in;

use serde_json::{Value, json};

/// A repository as GitHub's API shows it.
pub fn repo(owner: &str, name: &str, private: bool) -> Value {
    json!({
        "name": name,
        "full_name": format!("{owner}/{name}"),
        "private": private,
        "clone_url": format!("https://github.com/{owner}/{name}.git"),
        "html_url": format!("https://github.com/{owner}/{name}"),
        "updated_at": "2026-10-20T10:00:00Z",
        "description": null,
        "topics": [],
        "permissions": { "admin": true, "push": true, "pull": true },
    })
}
