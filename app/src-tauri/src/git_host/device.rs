//! "Sign in with GitHub" by device code: waiting for the code to be typed,
//! and keeping the account that comes of it (this and the other ways of
//! signing in end in `keep_signed_in`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant as Clock};

use kasten_core::history::{GitToken, https_origin};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::endpoints::Endpoints;
use super::{github, session};
use crate::app_settings::AppSettings;
use crate::commands::notes::OpenVault;
use crate::secrets;

/// The sign-in under way, which a new one or Cancel stops.
#[derive(Default)]
pub struct SignIn(Mutex<Option<Arc<AtomicBool>>>);

impl SignIn {
    pub(super) fn replace(&self, next: Option<Arc<AtomicBool>>) {
        let mut slot = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(old) = slot.take() {
            old.store(true, Ordering::SeqCst);
        }
        *slot = next;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

/// How a sign-in ended, sent to the window.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SignInEnd {
    /// `remembered` is false when the keychain cannot keep the sign-in, so
    /// it lasts until KastenFlow closes.
    Signed {
        login: String,
        remembered: bool,
    },
    Expired,
    Denied,
    Disabled,
    Failed {
        message: String,
    },
}

fn settings_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Asks GitHub, at the pace it sets, until the code is typed, refused or
/// runs out; None when the sign-in was stopped.
pub(super) async fn wait_for_token(
    app: &AppHandle,
    http: &reqwest::Client,
    id: &str,
    code: &github::DeviceCode,
    stop: &AtomicBool,
    keys: &dyn secrets::KeyStore,
) -> Option<SignInEnd> {
    let ep = Endpoints::github();
    let deadline = Clock::now() + Duration::from_secs(code.expires_in);
    let mut interval = code.interval.max(5);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if stop.load(Ordering::SeqCst) {
            return None;
        }
        if Clock::now() >= deadline {
            return Some(SignInEnd::Expired);
        }
        match github::poll(http, &ep, id, &code.device_code).await {
            github::Poll::Pending => {}
            github::Poll::SlowDown => interval += 5,
            github::Poll::Expired => return Some(SignInEnd::Expired),
            github::Poll::Denied => return Some(SignInEnd::Denied),
            github::Poll::Disabled => return Some(SignInEnd::Disabled),
            github::Poll::Failed(message) => return Some(SignInEnd::Failed { message }),
            github::Poll::Token(secret) => {
                return Some(match signed_in(app, http, &ep, keys, secret).await {
                    Ok((login, remembered)) => SignInEnd::Signed { login, remembered },
                    Err(message) => SignInEnd::Failed { message },
                });
            }
        }
    }
}

/// Keeps a new GitHub token and the account it is for.
async fn signed_in(
    app: &AppHandle,
    http: &reqwest::Client,
    ep: &Endpoints,
    keys: &dyn secrets::KeyStore,
    secret: String,
) -> Result<(String, bool), String> {
    let login = github::whoami(http, ep, &secret).await?;
    let token = GitToken {
        origin: github::ORIGIN.to_owned(),
        username: github::TOKEN_USER.to_owned(),
        secret,
    };
    let remembered = secrets::save_git_token(keys, &token).is_ok();
    keep_signed_in(app, &token, &login, remembered)?;
    Ok((login, remembered))
}

/// After any way of signing in: when the keychain could not keep the token it
/// is kept in memory until KastenFlow closes; the account is remembered for
/// display; and the open vault's backup gets the token.
pub fn keep_signed_in(
    app: &AppHandle,
    token: &GitToken,
    login: &str,
    remembered: bool,
) -> Result<(), String> {
    if remembered {
        session::forget();
    } else {
        session::keep(token);
    }
    AppSettings::update(&settings_dir(app)?, |s| {
        s.github_login = Some(login.to_owned())
    })
    .map_err(|e| e.to_string())?;
    if let Some(kasten) = app.state::<OpenVault>().kasten()
        && kasten
            .config()
            .git
            .remote
            .as_deref()
            .and_then(https_origin)
            .as_deref()
            == Some(github::ORIGIN)
    {
        kasten.set_git_token(Some(token.clone()));
    }
    Ok(())
}
