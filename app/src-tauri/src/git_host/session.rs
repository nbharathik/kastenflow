//! A GitHub token kept in memory only, for a computer whose keychain cannot
//! keep it: the sign-in then lasts until KastenFlow closes. Never written
//! anywhere.

use std::sync::Mutex;

use kasten_core::history::GitToken;

static TOKEN: Mutex<Option<GitToken>> = Mutex::new(None);

fn slot() -> std::sync::MutexGuard<'static, Option<GitToken>> {
    TOKEN.lock().unwrap_or_else(|p| p.into_inner())
}

/// Keeps the token until KastenFlow closes.
pub fn keep(token: &GitToken) {
    *slot() = Some(token.clone());
}

pub fn get() -> Option<GitToken> {
    slot().clone()
}

pub fn forget() {
    *slot() = None;
}
