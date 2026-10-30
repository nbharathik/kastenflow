//! Who can see the backup repository. A public one pauses pushing until the
//! person makes it private (one call) or says they want a public backup
//! (remembered for that repository on this computer). Checked when a backup
//! is set up, at each start and daily. Pausing is the engine's own switch:
//! the remote is taken out of "confirmed" in memory, so nothing is pushed
//! anywhere until the check clears it; the answer is in the backup status.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kasten_core::Kasten;
use tauri::{AppHandle, Manager};

use super::endpoints::Endpoints;
use super::repos;
use crate::app_settings::AppSettings;
use crate::backup::contract::{Protection, Visibility};
use crate::chat::commands::ChatState;

/// How long between the daily looks.
const DAY: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Default)]
struct Seen {
    visibility: BTreeMap<String, Visibility>,
    protection: BTreeMap<String, Protection>,
}

static SEEN: Mutex<Option<Seen>> = Mutex::new(None);

fn seen<T>(read: impl FnOnce(&mut Seen) -> T) -> T {
    let mut slot = SEEN.lock().unwrap_or_else(|p| p.into_inner());
    read(slot.get_or_insert_with(Seen::default))
}

/// `owner/name` of a GitHub address (https or ssh), lower-cased; None for
/// any other host.
pub fn repo_of(url: &str) -> Option<String> {
    let url = url.trim();
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    super::api::valid_full_name(path).then(|| path.to_lowercase())
}

/// Whether pushing waits: the repository is public and nobody said they want
/// that.
pub fn should_pause(visibility: Visibility, allowed: bool) -> bool {
    visibility == Visibility::Public && !allowed
}

/// What was last seen of a repository.
pub fn remember(full: &str, visibility: Visibility, protection: Option<Protection>) {
    let key = full.to_lowercase();
    seen(|s| {
        s.visibility.insert(key.clone(), visibility);
        if let Some(protection) = protection {
            s.protection.insert(key, protection);
        }
    });
}

pub fn last_visibility(full: &str) -> Visibility {
    seen(|s| {
        s.visibility
            .get(&full.to_lowercase())
            .copied()
            .unwrap_or_default()
    })
}

pub fn last_protection(full: &str) -> Protection {
    seen(|s| {
        s.protection
            .get(&full.to_lowercase())
            .cloned()
            .unwrap_or_default()
    })
}

/// Whether the person said they want `full` to be a public backup.
pub fn allowed(settings: &AppSettings, full: &str) -> bool {
    settings.public_ok.contains(&full.to_lowercase())
}

/// Pauses pushing for a public repository nobody said they want public, or
/// lets it go on (when the person confirmed the remote on this computer).
pub fn apply(app: &AppHandle, kasten: &Kasten, remote: &str, visibility: Visibility) {
    let Some(full) = repo_of(remote) else { return };
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let settings = AppSettings::load(&dir);
    if should_pause(visibility, allowed(&settings, &full)) {
        kasten.confirm_remote(None);
    } else if settings.confirmed_remote(&kasten.root().display().to_string()) == Some(remote) {
        kasten.confirm_remote(Some(remote));
    }
}

/// Looks at the open vault's backup repository (when it is on GitHub) and
/// pauses or resumes pushing. None when there is nothing to look at or GitHub
/// could not be asked; then nothing changes.
pub async fn check_open_vault(app: &AppHandle, kasten: &Kasten) -> Option<Visibility> {
    let remote = kasten.config().git.remote?;
    let full = repo_of(&remote)?;
    let chat = app.state::<ChatState>();
    let http = chat.http().ok()?;
    let token = super::github_token(&chat).ok();
    let found = repos::visibility(
        &http,
        &Endpoints::github(),
        token.as_ref().map(|t| t.secret.as_str()),
        &full,
    )
    .await
    .ok()?;
    remember(&full, found, None);
    apply(app, kasten, &remote, found);
    Some(found)
}

/// How many ticks the first look is tried before the backup goes on without
/// an answer (GitHub could not be reached, or the sign-in cannot see the
/// repository): the person confirmed the address, and a push to an address
/// that cannot be reached fails by itself.
const FIRST_TRIES: u64 = 3;

static ANSWERED: AtomicBool = AtomicBool::new(false);

/// Whether pushing to `remote` waits at open for the first look at who can
/// see the repository: a GitHub address the person did not say may be public.
pub fn hold_at_open(settings: &AppSettings, remote: Option<&str>) -> bool {
    remote
        .and_then(repo_of)
        .is_some_and(|full| !allowed(settings, &full))
}

/// Ends the wait of `hold_at_open` without an answer: the address confirmed
/// on this computer is used as it is.
fn release(app: &AppHandle, kasten: &Kasten) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let settings = AppSettings::load(&dir);
    kasten.confirm_remote(settings.confirmed_remote(&kasten.root().display().to_string()));
}

/// How long after a look the first answer is tried again.
const RETRY: Duration = Duration::from_secs(5);

/// What the backup thread remembers of its looks: how many were made and
/// when the thread started or last looked.
pub struct Looks {
    made: u64,
    since: Instant,
}

impl Default for Looks {
    fn default() -> Self {
        Self::new()
    }
}

impl Looks {
    pub fn new() -> Looks {
        Looks {
            made: 0,
            since: Instant::now(),
        }
    }

    /// How long until the next look is due: at once at the start while no
    /// answer is known, soon after while the first answer is awaited, then a
    /// day after the last look.
    pub fn next_in(&self) -> Duration {
        let gap = if self.made >= FIRST_TRIES || ANSWERED.load(Ordering::Relaxed) {
            DAY
        } else if self.made == 0 {
            Duration::ZERO
        } else {
            RETRY
        };
        gap.saturating_sub(self.since.elapsed())
    }

    /// Whether a look is due now.
    pub fn due(&self) -> bool {
        self.next_in().is_zero()
    }
}

/// Called by the backup thread when `looks` says a look is due: checks at the
/// start (tried again for a few tries until GitHub answers) and then daily.
pub fn tick(app: &AppHandle, kasten: &Arc<Kasten>, looks: &mut Looks) {
    looks.made += 1;
    looks.since = Instant::now();
    let tick = looks.made;
    let waiting = tick <= FIRST_TRIES && !ANSWERED.load(Ordering::Relaxed);
    let answer = crate::crash::caught(|| {
        Ok(tauri::async_runtime::block_on(check_open_vault(
            app, kasten,
        )))
    })
    .ok()
    .flatten();
    if answer.is_some() || repo_of(&kasten.config().git.remote.unwrap_or_default()).is_none() {
        ANSWERED.store(true, Ordering::Relaxed);
    } else if waiting && tick == FIRST_TRIES {
        release(app, kasten);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_repository_from_a_github_address() {
        for url in [
            "https://github.com/Ada/Notes.git",
            "https://github.com/ada/notes",
            "git@github.com:ada/notes.git",
            "ssh://git@github.com/ada/notes.git",
            "https://github.com/ada/notes/",
        ] {
            assert_eq!(repo_of(url).as_deref(), Some("ada/notes"), "{url}");
        }
        for url in [
            "https://gitlab.com/ada/notes.git",
            "https://github.com.evil.example/ada/notes.git",
            "https://github.com/ada",
            "https://github.com/ada/notes/extra",
            "/local/path.git",
            "",
        ] {
            assert_eq!(repo_of(url), None, "{url}");
        }
    }

    #[test]
    fn a_github_backup_waits_at_open_for_the_first_look_unless_public_is_allowed() {
        let mut settings = AppSettings::default();
        let github = Some("https://github.com/ada/notes.git");
        assert!(hold_at_open(&settings, github));
        assert!(!hold_at_open(
            &settings,
            Some("https://gitlab.com/ada/notes.git")
        ));
        assert!(!hold_at_open(&settings, Some("/local/path.git")));
        assert!(!hold_at_open(&settings, None));
        settings.public_ok.insert("ada/notes".into());
        assert!(!hold_at_open(&settings, github));
    }

    #[test]
    fn after_the_first_tries_the_next_look_is_a_day_after_the_last() {
        let mut looks = Looks::new();
        looks.made = FIRST_TRIES;
        let wait = looks.next_in();
        assert!(
            wait > DAY - Duration::from_secs(60) && wait <= DAY,
            "{wait:?}"
        );
        assert!(!looks.due());
    }

    #[test]
    fn only_a_public_repository_nobody_wanted_public_pauses() {
        assert!(should_pause(Visibility::Public, false));
        assert!(!should_pause(Visibility::Public, true));
        assert!(!should_pause(Visibility::Private, false));
        assert!(!should_pause(Visibility::Unknown, false));
    }

    #[test]
    fn what_was_seen_is_remembered_by_lower_case_name() {
        let full = "Visibility-Test/Notes";
        assert_eq!(last_visibility(full), Visibility::Unknown);
        remember(full, Visibility::Public, None);
        assert_eq!(last_visibility("visibility-test/notes"), Visibility::Public);
        remember(full, Visibility::Private, Some(Protection::default()));
        assert_eq!(last_visibility(full), Visibility::Private);
    }

    #[test]
    fn a_public_backup_is_allowed_only_where_the_person_said_so() {
        let mut settings = AppSettings::default();
        assert!(!allowed(&settings, "ada/notes"));
        settings.public_ok.insert("ada/notes".into());
        assert!(allowed(&settings, "Ada/Notes"));
        assert!(!allowed(&settings, "ada/other"));
    }
}
