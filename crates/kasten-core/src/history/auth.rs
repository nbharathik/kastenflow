//! How Kasten signs in to a backup remote: an SSH key from the agent, a
//! token saved for that exact server (from "Sign in with GitHub", or one
//! pasted in Settings), or git's credential helper. Never the operating
//! system's own sign-in, which Windows would give any server that asks,
//! and never a token for one server sent to another.

use std::fmt;

use git2::{Cred, CredentialType};

/// Network configuration is loaded independently of a vault. Included
/// files are refused because an include can lead back into shared content.
pub(super) fn machine_config() -> Result<git2::Config, git2::Error> {
    let config = git2::Config::open_default()?;
    trusted_config(&config)?;
    Ok(config)
}

fn trusted_config(config: &git2::Config) -> Result<(), git2::Error> {
    let mut entries = config.entries(None)?;
    while let Some(entry) = entries.next() {
        let entry = entry?;
        let name = entry.name().unwrap_or("");
        if name == "include.path"
            || name.starts_with("includeif.")
            || entry.include_depth() != 0
            || !matches!(
                entry.level(),
                git2::ConfigLevel::System
                    | git2::ConfigLevel::XDG
                    | git2::ConfigLevel::Global
                    | git2::ConfigLevel::ProgramData
            )
        {
            return Err(git2::Error::from_str(
                "Use direct machine configuration for backup authentication; repository and included configuration are not trusted",
            ));
        }
    }
    Ok(())
}

/// A token for one server, over HTTPS. The app keeps it in the system's
/// keychain and hands it to the engine; nothing here writes it anywhere.
#[derive(Clone, PartialEq, Eq)]
pub struct GitToken {
    /// The scheme, host and port it is for, as `https_origin` gives them:
    /// `https://github.com`.
    pub origin: String,
    /// The user name sent with it: `x-access-token` for GitHub, the
    /// account for hosts that need one.
    pub username: String,
    pub secret: String,
}

impl fmt::Debug for GitToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GitToken")
            .field("origin", &self.origin)
            .field("username", &self.username)
            .field("secret", &"(hidden)")
            .finish()
    }
}

/// What to sign in with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignIn {
    SshAgent,
    Token,
    CredentialHelper,
    Refuse,
}

/// `https://host[:port]` for an HTTPS address, with the host in lower
/// case; None for any other kind.
pub fn https_origin(url: &str) -> Option<String> {
    let rest = url
        .get(..8)
        .filter(|scheme| scheme.eq_ignore_ascii_case("https://"))
        .map(|_| &url[8..])?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let authority = authority.to_ascii_lowercase();
    let authority = authority.strip_suffix(":443").unwrap_or(&authority);
    Some(format!("https://{authority}"))
}

/// How to sign in to `url`, given the kinds the server takes and the token
/// saved for it, if any: an SSH key where SSH is asked for; the token only
/// for its own server; else git's credential helper.
pub fn choose(url: &str, allowed: CredentialType, token: Option<&GitToken>) -> SignIn {
    if allowed.contains(CredentialType::SSH_KEY) {
        return SignIn::SshAgent;
    }
    if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
        let for_here =
            token.is_some_and(|t| https_origin(url).as_deref() == Some(t.origin.as_str()));
        return if for_here {
            SignIn::Token
        } else {
            SignIn::CredentialHelper
        };
    }
    SignIn::Refuse
}

/// The credentials git asks for on attempt number `attempt` (from 1). A
/// token refused once is not sent again, so a revoked one fails at once
/// with a reason instead of looping.
pub(super) fn credentials(
    config: &git2::Config,
    url: &str,
    username: Option<&str>,
    allowed: CredentialType,
    token: Option<&GitToken>,
    attempt: u32,
) -> Result<Cred, git2::Error> {
    if attempt > 3 {
        return Err(git2::Error::from_str("authentication failed"));
    }
    match choose(url, allowed, token) {
        SignIn::SshAgent => Cred::ssh_key_from_agent(username.unwrap_or("git")),
        SignIn::Token if attempt > 1 => Err(git2::Error::from_str(
            "the server refused the saved token; sign in again or paste a new one",
        )),
        SignIn::Token => {
            let token = token.expect("choose picks a token only when there is one");
            Cred::userpass_plaintext(&token.username, &token.secret)
        }
        SignIn::CredentialHelper => {
            trusted_config(config)?;
            Cred::credential_helper(config, url, username)
        }
        SignIn::Refuse => Err(git2::Error::from_str(
            "the remote asks for a kind of sign-in KastenFlow does not give; use an SSH key, a token or git's credential helper",
        )),
    }
}

/// `message` with any secret taken out: the token's secret wherever it
/// appears, and a user name or password written into an address, before
/// it is shown, logged or kept in the backup record.
pub fn redact(message: &str, token: Option<&GitToken>) -> String {
    let mut out = message.to_owned();
    if let Some(token) = token.filter(|t| t.secret.len() >= 4) {
        out = out.replace(&token.secret, "(token)");
    }
    // `scheme://user:secret@host`: keep the scheme and host.
    let mut cleaned = String::with_capacity(out.len());
    let mut rest = out.as_str();
    while let Some(at) = rest.find("://") {
        let (head, tail) = rest.split_at(at + 3);
        cleaned.push_str(head);
        let end = tail
            .find(|c: char| c.is_whitespace() || c == '/')
            .unwrap_or(tail.len());
        let authority = &tail[..end];
        match authority.rfind('@') {
            Some(sign) => {
                cleaned.push_str("(hidden)@");
                cleaned.push_str(&authority[sign + 1..]);
            }
            None => cleaned.push_str(authority),
        }
        rest = &tail[end..];
    }
    cleaned.push_str(rest);
    cleaned
}

/// `err` with any secret taken out, as `redact` does, keeping what kind of
/// error it is so its message is not wrapped twice.
pub fn redacted(err: crate::Error, token: Option<&GitToken>) -> crate::Error {
    use crate::Error;
    match err {
        Error::Git(why) => Error::Git(redact(&why, token)),
        Error::Invalid(why) => Error::Invalid(redact(&why, token)),
        other => Error::Git(redact(&other.to_string(), token)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(origin: &str) -> GitToken {
        GitToken {
            origin: origin.into(),
            username: "x-access-token".into(),
            secret: "gho_s3cretValue".into(),
        }
    }

    #[test]
    fn names_the_server_an_https_address_is_on() {
        assert_eq!(
            https_origin("https://GitHub.com/someone/notes.git").as_deref(),
            Some("https://github.com")
        );
        assert_eq!(
            https_origin("https://git.example.com:8443/notes").as_deref(),
            Some("https://git.example.com:8443")
        );
        assert_eq!(
            https_origin("https://github.com:443/a/b").as_deref(),
            Some("https://github.com")
        );
        for other in [
            "git@github.com:someone/notes.git",
            "ssh://git@github.com/someone/notes.git",
            "http://github.com/a/b",
            "https://user@github.com/a/b",
            "/srv/notes.git",
            "https://",
        ] {
            assert_eq!(https_origin(other), None, "{other}");
        }
    }

    #[test]
    fn a_token_goes_only_to_its_own_server() {
        let github = token("https://github.com");
        let https = CredentialType::USER_PASS_PLAINTEXT;
        assert_eq!(
            choose("https://github.com/a/notes.git", https, Some(&github)),
            SignIn::Token
        );
        assert_eq!(
            choose("https://evil.example/a/notes.git", https, Some(&github)),
            SignIn::CredentialHelper
        );
        assert_eq!(
            choose("https://github.com.evil.example/a", https, Some(&github)),
            SignIn::CredentialHelper
        );
        assert_eq!(
            choose("https://github.com/a/notes.git", https, None),
            SignIn::CredentialHelper
        );
        assert_eq!(
            choose(
                "git@github.com:a/notes.git",
                CredentialType::SSH_KEY,
                Some(&github)
            ),
            SignIn::SshAgent
        );
        assert_eq!(
            choose(
                "https://github.com/a",
                CredentialType::DEFAULT,
                Some(&github)
            ),
            SignIn::Refuse
        );
    }

    #[test]
    fn a_refused_token_is_not_sent_again() {
        let config = git2::Config::new().unwrap();
        let github = token("https://github.com");
        let https = CredentialType::USER_PASS_PLAINTEXT;
        let url = "https://github.com/a/notes.git";
        assert!(credentials(&config, url, None, https, Some(&github), 1).is_ok());
        let Err(again) = credentials(&config, url, None, https, Some(&github), 2) else {
            panic!("a refused token was sent again");
        };
        assert!(again.message().contains("refused the saved token"));
    }

    #[test]
    fn a_repository_cannot_supply_a_credential_program() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-auth-{}",
            crate::ulid_at(crate::Instant::now().millis)
        ));
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("config");
        let sentinel = dir.join("executed");
        std::fs::write(&file, "").unwrap();
        let mut config = git2::Config::new().unwrap();
        config
            .add_file(&file, git2::ConfigLevel::Local, false)
            .unwrap();
        config
            .set_str(
                "credential.helper",
                &format!(
                    "!echo ran > '{}'; echo username=u; echo password=p",
                    sentinel.to_string_lossy().replace('\\', "/")
                ),
            )
            .unwrap();
        let result = credentials(
            &config,
            "https://example.com/vault",
            None,
            CredentialType::USER_PASS_PLAINTEXT,
            None,
            1,
        );
        assert!(result.is_err(), "a local helper was accepted");
        assert!(
            result
                .err()
                .unwrap()
                .message()
                .contains("machine configuration")
        );
        assert!(!sentinel.exists(), "the local helper ran");
        drop(config);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn direct_machine_settings_are_allowed_but_includes_are_not() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-auth-level-{}",
            crate::ulid_at(crate::Instant::now().millis)
        ));
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("config");
        std::fs::write(&file, "[credential]\nhelper = manager\n").unwrap();
        let mut config = git2::Config::new().unwrap();
        config
            .add_file(&file, git2::ConfigLevel::Global, false)
            .unwrap();
        assert!(trusted_config(&config).is_ok());
        drop(config);
        std::fs::write(dir.join("included"), "[credential]\nhelper = unexpected\n").unwrap();
        std::fs::write(&file, "[include]\npath = included\n").unwrap();
        let mut config = git2::Config::new().unwrap();
        config
            .add_file(&file, git2::ConfigLevel::Global, false)
            .unwrap();
        assert!(trusted_config(&config).is_err());
        drop(config);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn secrets_never_show() {
        let github = token("https://github.com");
        assert!(!format!("{github:?}").contains("s3cret"));
        let said = redact(
            "401 for https://x-access-token:gho_s3cretValue@github.com/a/b.git and gho_s3cretValue again",
            Some(&github),
        );
        assert!(!said.contains("s3cret"), "{said}");
        assert!(
            said.contains("https://(hidden)@github.com/a/b.git"),
            "{said}"
        );
        assert_eq!(
            redact("could not reach https://github.com/a/b.git", None),
            "could not reach https://github.com/a/b.git"
        );
        assert_eq!(
            redact("ssh://git:pw@host.example/x", None),
            "ssh://(hidden)@host.example/x"
        );
    }

    #[test]
    fn a_redacted_error_keeps_its_kind_and_is_said_once() {
        let token = token("https://github.com");
        let err = redacted(
            crate::Error::Git("refused gho_s3cretValue at https://u:pw@github.com/a".into()),
            Some(&token),
        );
        assert_eq!(
            err.to_string(),
            "History: refused (token) at https://(hidden)@github.com/a"
        );
        let invalid = redacted(crate::Error::Invalid("not https://u:pw@h/x".into()), None);
        assert_eq!(invalid.to_string(), "not https://(hidden)@h/x");
    }
}
