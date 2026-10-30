//! The account's repositories: a searchable, paged list with KastenFlow's
//! own backups first, a look at one (is it there, who can see it, is it
//! empty, is it this vault's), a name check, making a private repository,
//! making one private, and the lock on its branch. Every function takes the
//! addresses as a value and the token as an argument.

use reqwest::Method;
use serde_json::{Value, json};

use super::api::{self, enc, send, valid_full_name, valid_name};
use super::endpoints::Endpoints;
use super::lock::{protect, protection_of};
use crate::backup::contract::{
    BackupError, Protection, RepoCheck, RepoContent, RepoPage, RepoRow, Visibility,
};

/// The topic on every repository KastenFlow makes for a backup.
pub const TOPIC: &str = "kastenflow-vault";
/// The description on every repository KastenFlow makes for a backup.
pub const DESCRIPTION: &str = "KastenFlow vault backup";
/// Repositories to a page.
pub const PER_PAGE: usize = 30;
/// Local commits looked for on GitHub, newest first, to tell whether a
/// repository holds this vault's history.
pub const SAMPLE: usize = 6;

pub fn visibility_of(value: &Value) -> Visibility {
    match value["private"].as_bool() {
        Some(true) => Visibility::Private,
        Some(false) => Visibility::Public,
        None => Visibility::Unknown,
    }
}

/// One repository from GitHub's JSON; only ones on github.com count.
pub fn read_row(value: &Value) -> Option<RepoRow> {
    let backup = value["topics"]
        .as_array()
        .is_some_and(|t| t.iter().any(|t| t.as_str() == Some(TOPIC)))
        || value["description"].as_str() == Some(DESCRIPTION);
    Some(RepoRow {
        name: value["name"].as_str()?.to_owned(),
        full_name: value["full_name"].as_str()?.to_owned(),
        clone_url: value["clone_url"]
            .as_str()
            .filter(|u| u.starts_with("https://github.com/"))?
            .to_owned(),
        html_url: value["html_url"].as_str()?.to_owned(),
        updated_at: value["updated_at"].as_str().map(str::to_owned),
        visibility: visibility_of(value),
        is_backup: backup,
    })
}

/// One page of the account's private repositories, most recently changed
/// first with KastenFlow's backups ahead of the rest on the page. A `query`
/// searches names (GitHub's search, within the account); `page` counts
/// from 1.
pub async fn list(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    login: &str,
    query: &str,
    page: u32,
) -> Result<RepoPage, BackupError> {
    let page = page.max(1);
    let query = query.trim();
    let searching = !query.is_empty();
    let path = if searching {
        let q = format!("{query} in:name user:{login} fork:true");
        format!(
            "/search/repositories?q={}&per_page={PER_PAGE}&page={page}",
            enc(&q)
        )
    } else {
        format!(
            "/user/repos?visibility=private&affiliation=owner&sort=updated&per_page={PER_PAGE}&page={page}"
        )
    };
    let reply = api::get(http, ep, &path, Some(token), "list your repositories").await?;
    let items = if searching {
        &reply.body["items"]
    } else {
        &reply.body
    };
    let mut repos: Vec<RepoRow> = items
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(read_row)
                .filter(|r| r.visibility == Visibility::Private)
                .collect()
        })
        .unwrap_or_default();
    let counted = u64::from(page) * PER_PAGE as u64;
    let has_more =
        reply.next || (searching && counted < reply.body["total_count"].as_u64().unwrap_or(0));
    // Stable: the order GitHub gave is kept inside each group.
    repos.sort_by_key(|r| !r.is_backup);
    Ok(RepoPage { repos, has_more })
}

/// Every private repository the account owns, up to ten pages.
pub async fn all(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    login: &str,
) -> Result<Vec<RepoRow>, BackupError> {
    let mut out = Vec::new();
    for page in 1..=10 {
        let got = list(http, ep, token, login, "", page).await?;
        out.extend(got.repos);
        if !got.has_more {
            break;
        }
    }
    out.sort_by_key(|r| !r.is_backup);
    Ok(out)
}

fn checked(full: &str) -> Result<(), BackupError> {
    if valid_full_name(full) {
        Ok(())
    } else {
        Err(BackupError::other(
            "That is not a repository name; write it as owner/name",
        ))
    }
}

/// One repository, if this sign-in can see it.
pub async fn get_row(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: Option<&str>,
    full: &str,
) -> Result<Option<(RepoRow, bool)>, BackupError> {
    checked(full)?;
    let reply = send(
        http,
        ep,
        Method::GET,
        &format!("/repos/{full}"),
        token,
        None,
        "look at the repository",
    )
    .await?;
    if reply.status == 404 {
        return Ok(None);
    }
    let reply = reply.or_fail("look at the repository")?;
    let writable = reply.body["permissions"]["push"].as_bool().unwrap_or(true);
    Ok(read_row(&reply.body).map(|row| (row, writable)))
}

/// Who can see the repository now.
pub async fn visibility(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: Option<&str>,
    full: &str,
) -> Result<Visibility, BackupError> {
    checked(full)?;
    let reply = api::get(
        http,
        ep,
        &format!("/repos/{full}"),
        token,
        "look at the repository",
    )
    .await?;
    Ok(visibility_of(&reply.body))
}

/// Makes the repository private (one call); answers what it is after.
pub async fn make_private(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    full: &str,
) -> Result<Visibility, BackupError> {
    checked(full)?;
    let body = json!({ "private": true });
    let reply = send(
        http,
        ep,
        Method::PATCH,
        &format!("/repos/{full}"),
        Some(token),
        Some(&body),
        "make the repository private",
    )
    .await?;
    let reply = match reply.or_fail("make the repository private") {
        Err(BackupError::NoAccess { .. } | BackupError::NotFound { .. }) => {
            return Err(BackupError::NoAccess {
                message: "This sign-in cannot change who sees the repository. Make it private in the repository's settings on GitHub, or sign in with GitHub instead of a token".into(),
            });
        }
        other => other?,
    };
    match visibility_of(&reply.body) {
        Visibility::Private => Ok(Visibility::Private),
        _ => Err(BackupError::other(
            "GitHub did not make the repository private; try again or change it in its settings",
        )),
    }
}

/// Whether a repository called `name` can be made in the account.
pub async fn name_available(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    login: &str,
    name: &str,
) -> Result<bool, BackupError> {
    if !valid_name(name) || name.to_lowercase().ends_with(".git") || !valid_name(login) {
        return Ok(false);
    }
    let what = "check the name";
    let reply = send(
        http,
        ep,
        Method::GET,
        &format!("/repos/{login}/{name}"),
        Some(token),
        None,
        what,
    )
    .await?;
    if reply.status == 404 {
        return Ok(true);
    }
    reply.or_fail(what)?;
    Ok(false)
}

/// Looks at `full`: is it there, who can see it, is it empty, does it hold
/// this vault's history (`ids` are local commits, newest first).
pub async fn check(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: Option<&str>,
    full: &str,
    ids: &[String],
) -> Result<RepoCheck, BackupError> {
    let Some((row, _)) = get_row(http, ep, token, full).await? else {
        return Ok(RepoCheck::default());
    };
    let commits = send(
        http,
        ep,
        Method::GET,
        &format!("/repos/{full}/commits?per_page=1"),
        token,
        None,
        "look inside the repository",
    )
    .await?;
    let empty = commits.status == 409
        || (commits.ok() && commits.body.as_array().is_some_and(Vec::is_empty));
    if !empty {
        commits.or_fail("look inside the repository")?;
    }
    let content = if empty {
        RepoContent::Empty
    } else if ids.is_empty() {
        RepoContent::Unknown
    } else if holds_any(http, ep, token, full, ids).await? {
        RepoContent::ThisVault
    } else {
        RepoContent::Unrelated
    };
    Ok(RepoCheck {
        exists: true,
        visibility: row.visibility,
        protection: protection_of(http, ep, token, full).await,
        empty,
        content,
    })
}

async fn holds_any(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: Option<&str>,
    full: &str,
    ids: &[String],
) -> Result<bool, BackupError> {
    for id in ids
        .iter()
        .filter(|id| id.len() >= 7 && id.chars().all(|c| c.is_ascii_hexdigit()))
        .take(SAMPLE)
    {
        let reply = send(
            http,
            ep,
            Method::GET,
            &format!("/repos/{full}/commits/{id}"),
            token,
            None,
            "look inside the repository",
        )
        .await?;
        match reply.status {
            200 => return Ok(true),
            404 | 422 => {}
            _ => {
                reply.or_fail("look inside the repository")?;
            }
        }
    }
    Ok(false)
}

/// Makes a private repository for a backup, marks it as one, and tries to
/// lock its branch. A name in use is `NameTaken`, with that repository to use
/// instead.
pub async fn create_backup(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    login: &str,
    name: &str,
) -> Result<(RepoRow, Protection), BackupError> {
    if !valid_name(name) || name.to_lowercase().ends_with(".git") {
        return Err(BackupError::other(
            "A repository name can have letters, numbers, dashes, dots and underscores",
        ));
    }
    let what = "make the repository";
    let body = json!({
        "name": name,
        "private": true,
        "description": DESCRIPTION,
        "has_issues": false,
        "has_projects": false,
        "has_wiki": false,
        "auto_init": false,
    });
    let reply = send(
        http,
        ep,
        Method::POST,
        "/user/repos",
        Some(token),
        Some(&body),
        what,
    )
    .await?;
    if reply.status == 422
        && reply
            .body
            .to_string()
            .to_lowercase()
            .contains("already exists")
    {
        let existing = get_row(http, ep, Some(token), &format!("{login}/{name}"))
            .await
            .ok()
            .flatten()
            .map(|(row, _)| Box::new(row));
        return Err(BackupError::NameTaken {
            message: format!(
                "You already have a repository named {name}. Use it for this vault, or pick another name"
            ),
            existing,
        });
    }
    let reply = reply.or_fail(what)?;
    let row = read_row(&reply.body)
        .filter(|row| valid_full_name(&row.full_name))
        .ok_or_else(|| BackupError::other("GitHub's answer named no repository"))?;
    // Marking it is a convenience: the backup works without it.
    let names = json!({ "names": [TOPIC] });
    let _ = send(
        http,
        ep,
        Method::PUT,
        &format!("/repos/{}/topics", row.full_name),
        Some(token),
        Some(&names),
        "mark the repository",
    )
    .await;
    let protection = protect(http, ep, token, &row.full_name).await;
    let row = RepoRow {
        is_backup: true,
        ..row
    };
    Ok((row, protection))
}
