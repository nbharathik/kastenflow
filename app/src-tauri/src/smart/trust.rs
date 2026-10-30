//! Who may run a smart page. There is no approval of each version: a page
//! runs in a sandbox that reaches the vault only through the agent rules. The
//! one exception is a page an agent made while agents were held to Review (or
//! one whose making a person accepted as a held change): it waits once for a
//! person's "Allow to run". The answer to "who made it" is the author of the
//! commit that first brought the page into the vault, which an agent cannot
//! write as a person; a copy or a page made from a template follows the
//! commit's `Kasten-Copy-Of` back to the page it came from. The gate follows
//! who MADE the page, not who last wrote its code: an agent that later adds
//! code to a person's page, in a mode that lets it write, runs without the
//! click (in Review the person accepted that change anyway). With History off
//! nothing says who made a page: in Review every page then waits for a click.
//! The permission is kept in the app's data folder by the page's id
//! (`settings`); and a switch turns all of it off.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use kasten_core::config_keys::AgentMode;
use kasten_core::policy::AUTONOMOUS_APPROVER;
use kasten_core::{Instant, Kasten, NoteFile};
use serde::Serialize;

use super::settings;

/// What the window needs to decide whether to show a smart page or ask first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trust {
    /// The agent's client name, when an agent made the page.
    pub made_by: Option<String>,
    /// History is off, so nothing says who made the page, and agents are held
    /// to Review: the page waits for a person's choice all the same.
    #[serde(default)]
    pub unknown_maker: bool,
    /// A person has to allow it to run before it does.
    pub needs_allow: bool,
    /// A person allowed it.
    pub allowed: bool,
}

/// The client in a commit's author (`agent:claude-code`), or the author.
pub fn client_name(author: &str) -> String {
    author.strip_prefix("agent:").unwrap_or(author).to_owned()
}

/// Who made a page, from the commit that first brought it in: an agent's client
/// and who accepted its change, or nothing for a person's page.
#[derive(Debug, Clone)]
struct Origin {
    client: String,
    approved_by: Option<String>,
}

type Key = (PathBuf, String, String);

/// Origins already read. The first commit of a page never changes, but finding
/// it walks the vault's history, so it is done once per page and run.
fn known() -> &'static Mutex<HashMap<Key, Option<Origin>>> {
    static KNOWN: OnceLock<Mutex<HashMap<Key, Option<Origin>>>> = OnceLock::new();
    KNOWN.get_or_init(Mutex::default)
}

/// The agent that made `note`, if one did. Without history, or before the page
/// is in it, nothing says (and nothing is kept), so the page is not held back:
/// the sandbox and the agent rules still hold.
fn origin(kasten: &Kasten, note: &NoteFile) -> Option<Origin> {
    let id = note.meta.id.as_deref().unwrap_or_default();
    let key = (
        kasten.root().to_path_buf(),
        id.to_owned(),
        note.meta.path.clone(),
    );
    if let Some(found) = known().lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return found.clone();
    }
    let first = kasten.first_commit(&note.meta.path).ok().flatten()?;
    let origin = first.agent.then(|| Origin {
        client: client_name(&first.author),
        approved_by: first.approved_by,
    });
    known()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(key, origin.clone());
    origin
}

/// Who made `note` and whether it waits for a person.
pub fn trust(kasten: &Kasten, note: &NoteFile, data_dir: Option<&Path>, now: Instant) -> Trust {
    let id = note.meta.id.as_deref().unwrap_or_default();
    let allowed = !id.is_empty() && settings::allowed(data_dir, id);
    let first = origin(kasten, note);
    let held_change = first.as_ref().is_some_and(|origin| {
        origin
            .approved_by
            .as_deref()
            .is_some_and(|by| by != AUTONOMOUS_APPROVER)
    });
    let made_by = first.map(|origin| origin.client);
    let review = kasten.agent_mode(note.meta.project.as_deref(), now) == AgentMode::Review;
    // With History off nothing says who made a page, so where agents are held
    // to Review no page runs before a person has allowed it.
    let unknown_maker = !kasten.has_history() && review;
    Trust {
        needs_allow: (made_by.is_some() && (held_change || review) || unknown_maker) && !allowed,
        made_by,
        unknown_maker: unknown_maker && !allowed,
        allowed,
    }
}

/// Why smart pages are off for `note`, in plain words.
pub(super) fn off_words(kasten: &Kasten) -> String {
    if kasten.config().plugin_enabled(kasten_core::SMART_PLUGIN) {
        "Smart pages are turned off for this project. Change it in the project's settings."
            .to_owned()
    } else {
        "Smart pages are off. Turn them on in Settings → Plugins.".to_owned()
    }
}

/// Whether a frame may begin for `note`; the words say why not.
pub fn may_open(
    kasten: &Kasten,
    note: &NoteFile,
    data_dir: Option<&Path>,
    now: Instant,
) -> Result<(), String> {
    // The page's project says, else the vault's plugin: off until a person turns it on.
    if !kasten.smart_enabled_for_page(&note.meta.path) {
        return Err(off_words(kasten));
    }
    let trust = trust(kasten, note, data_dir, now);
    if trust.needs_allow {
        return Err(format!(
            "“{}” was made by {}. Allow it to run first.",
            note.meta.title,
            trust.made_by.unwrap_or_else(|| "an agent".to_owned())
        ));
    }
    Ok(())
}
