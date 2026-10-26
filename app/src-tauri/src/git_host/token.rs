//! Signing in with a pasted token (a fine-grained personal access token
//! limited to the backup repository) or with the token the GitHub command
//! line already holds. The token is checked against GitHub, and against the
//! repository chosen with it, before anything is kept; it goes to the
//! keychain only, and into no message.

use kasten_core::history::GitToken;

use super::endpoints::Endpoints;
use super::github::{ORIGIN, TOKEN_USER, whoami};
use super::repos::get_row;
use crate::backup::contract::{BackupError, SignedIn};
use crate::secrets::{self, KeyStore};

/// A token is a short run of printable characters with no spaces; anything
/// else is not sent anywhere (a line end would end a header).
pub fn plausible(token: &str) -> bool {
    !token.is_empty() && token.len() <= 255 && token.bytes().all(|b| b.is_ascii_graphic())
}

/// Checks `raw` signs in, and can see and write to `repo` (`owner/name`)
/// when one is given; only then keeps it. Answers who it signed in as, and
/// the token for the caller to hand to the backup.
pub async fn sign_in(
    http: &reqwest::Client,
    ep: &Endpoints,
    keys: &dyn KeyStore,
    raw: &str,
    repo: Option<&str>,
) -> Result<(SignedIn, GitToken), BackupError> {
    let token = raw.trim();
    if !plausible(token) {
        return Err(BackupError::other(
            "That does not look like a token. Paste it exactly as GitHub shows it",
        ));
    }
    let login = match whoami(http, ep, token).await {
        Err(BackupError::SignedOut { .. }) => {
            return Err(BackupError::SignedOut {
                message: "GitHub does not accept this token. Check that it was copied whole and has not run out".into(),
            });
        }
        other => other?,
    };
    let repo = repo.map(str::trim).filter(|r| !r.is_empty());
    let chosen = match repo {
        Some(full) => Some(chosen_repo(http, ep, token, full).await?),
        None => None,
    };
    let kept = GitToken {
        origin: ORIGIN.to_owned(),
        username: TOKEN_USER.to_owned(),
        secret: token.to_owned(),
    };
    let remembered = secrets::save_git_token(keys, &kept).is_ok();
    Ok((
        SignedIn {
            login,
            repo: chosen,
            remembered,
        },
        kept,
    ))
}

async fn chosen_repo(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    full: &str,
) -> Result<crate::backup::contract::RepoRow, BackupError> {
    match get_row(http, ep, Some(token), full).await? {
        None => Err(BackupError::NotFound {
            message: format!(
                "This token cannot see {full}. When you make the token, choose that repository under Only select repositories"
            ),
        }),
        Some((_, false)) => Err(BackupError::CannotWrite {
            message: format!(
                "This token can see {full} but cannot write to it. Set its Contents permission to Read and write"
            ),
        }),
        Some((row, true)) => Ok(row),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_one_run_of_printable_characters() {
        assert!(plausible("github_pat_11AAAA_bbb"));
        for bad in ["", "two words", "line\nbreak", "tab\t", "ünï"] {
            assert!(!plausible(bad), "{bad:?}");
        }
        assert!(!plausible(&"x".repeat(256)));
    }
}
