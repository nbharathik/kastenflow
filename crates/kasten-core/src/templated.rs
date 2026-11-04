//! Notes that start from a template: a journal day, made from
//! `templates/journal.md` the first time it is opened, and an empty page
//! a template fills.

use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::frontmatter::{append_blocks, join, key_blocks, set_key, split, still_readable};
use crate::journal_path::journal_path_in;
use crate::note::NoteFile;
use crate::ops::{Kind, NewNote, create_note, eol_of};
use crate::slug::slugify;
use crate::template_vars::{day_and_time, fill};
use crate::time::Instant;
use crate::vault::Vault;

/// The template a project's journal days start from, when the vault has it.
const PROJECT_JOURNAL_TEMPLATE: &str = "project-journal";

/// The journal note for `date` in the vault's journal (`project` None) or a
/// project's, created the first time it is opened: from
/// `templates/project-journal.md` for a project's, else from
/// `templates/journal.md` (when there is one).
pub fn journal_day(
    vault: &Vault,
    project: Option<&str>,
    date: &str,
    now: Instant,
) -> Result<NoteFile> {
    journal_day_from(vault, project, date, None, now)
}

/// `journal_day`, starting a new day from the template `chosen` when the
/// vault has it, else as usual.
pub fn journal_day_from(
    vault: &Vault,
    project: Option<&str>,
    date: &str,
    chosen: Option<&str>,
    now: Instant,
) -> Result<NoteFile> {
    let path = journal_path_in(vault, project, date)?;
    if vault.exists(&path) {
        return vault.read(&path);
    }
    let Some((day, _)) = day_and_time(date) else {
        return Err(Error::Invalid(format!("Not a day: {date}")));
    };
    let chosen = chosen
        .map(slugify)
        .filter(|name| !name.is_empty() && vault.exists(&format!("templates/{name}.md")));
    // A project's own template, written for its days, is used as written.
    let own = (project.is_some()
        && vault.exists(&format!("templates/{PROJECT_JOURNAL_TEMPLATE}.md")))
    .then(|| PROJECT_JOURNAL_TEMPLATE.to_owned());
    let template = own.or(chosen).or_else(|| {
        (vault.exists("templates/journal.md") && !old_journal_template(vault))
            .then(|| "journal".to_owned())
    });
    let new = NewNote {
        kind: Kind::Journal,
        title: day.to_owned(),
        date: date.to_owned(),
        project: project.map(str::to_owned),
        parent: None,
        template,
        icon: None,
    };
    create_note(vault, &new, now)
}

/// Whether the vault's journal template is the one vaults were given until
/// new days started blank: a title and a type, and nothing but its empty
/// `Morning` and `Notes` headings, however spaced, or the untouched daily
/// planner starter. Its
/// headings then stay out of new days. A template anyone wrote in is theirs
/// and is used as written.
fn old_journal_template(vault: &Vault) -> bool {
    vault
        .read("templates/journal.md")
        .is_ok_and(|t| is_old_journal_template(&t.text))
}

pub(crate) fn is_old_journal_template(text: &str) -> bool {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let parts = split(&text);
    let only_title_and_type = parts
        .prefix
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && *line != "---")
        .all(|line| line.starts_with("title:") || line.starts_with("type:"));
    let legacy = include_str!("../defaults/legacy/daily-journal.md").replace("\r\n", "\n");
    if !parts.prefix.is_empty()
        && only_title_and_type
        && parts.body.trim() == split(&legacy).body.trim()
    {
        return true;
    }
    let mut headings = 0;
    for line in parts
        .body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let hashes = line.bytes().take_while(|&b| b == b'#').count();
        let name = line[hashes..].trim().to_lowercase();
        if !(1..=6).contains(&hashes) || !(name == "morning" || name == "notes") {
            return false;
        }
        headings += 1;
    }
    !parts.prefix.is_empty() && only_title_and_type && headings > 0
}

/// Keys a template never copies onto a page: the page's own identity.
const OWN_KEYS: [&str; 8] = [
    "id", "title", "type", "created", "updated", "parent", "icon", "cover",
];

/// Starts an empty page from a template: its body, and the frontmatter keys
/// (such as `tags` or `props`) the page does not have yet. Pages with text
/// are refused, so a template never overwrites writing.
pub fn apply_template(
    vault: &Vault,
    rel: &str,
    template: &str,
    date: &str,
    now: Instant,
) -> Result<NoteFile> {
    let current = vault.read(rel)?;
    let parts = split(&current.text);
    if !parts.body.trim().is_empty() {
        return Err(Error::Invalid(
            "Templates only start empty pages".to_owned(),
        ));
    }
    let source = vault
        .read(&format!("templates/{}.md", slugify(template)))?
        .text;
    let meta = &current.meta;
    if day_and_time(date).is_none() {
        return Err(Error::Invalid(format!("Not a day: {date}")));
    }
    let filled = fill(
        &source,
        &meta.title,
        date,
        meta.project.as_deref().unwrap_or(""),
        now,
    );
    let template_parts = split(&filled);
    let eol = eol_of(&current.text);
    let have: Vec<String> = key_blocks(parts.prefix)
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    let blocks: Vec<String> = key_blocks(template_parts.prefix)
        .into_iter()
        .filter(|(key, _)| !OWN_KEYS.contains(&key.as_str()) && !have.contains(key))
        .map(|(_, block)| block)
        .collect();
    let mut prefix = append_blocks(parts.prefix, &blocks, eol);
    prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    still_readable(parts.prefix, &prefix)?;
    write_atomic(
        &vault.path_of(rel)?,
        join(&prefix, template_parts.body, eol).as_bytes(),
    )?;
    vault.read(rel)
}

/// Keys a template keeps from the page it is saved from: what a new page
/// should start with, not the page's own identity.
const KEPT_KEYS: [&str; 3] = ["icon", "tags", "props"];

/// The template `name` made from the page at `rel`, and where it goes: the
/// title a placeholder, the icon, tags and properties kept, the text as it
/// is. Refused when a template already has that name.
pub(crate) fn template_from(vault: &Vault, rel: &str, name: &str) -> Result<(String, String)> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name.chars().any(char::is_control) {
        return Err(Error::Invalid(
            "A template needs a name, without slashes".to_owned(),
        ));
    }
    let slug = slugify(name);
    if slug.is_empty() {
        return Err(Error::Invalid(format!("“{name}” can't name a file")));
    }
    let target = format!("templates/{slug}.md");
    if vault.exists(&target) {
        return Err(Error::Invalid(format!(
            "A template called “{name}” is already in this vault"
        )));
    }
    let page = vault.read(rel)?;
    let parts = split(&page.text);
    let eol = eol_of(&page.text);
    let mut prefix = format!("---{eol}title: \"{{{{title}}}}\"{eol}type: page{eol}");
    for (key, block) in key_blocks(parts.prefix) {
        if KEPT_KEYS.contains(&key.as_str()) {
            prefix.push_str(&block);
            if !block.ends_with('\n') {
                prefix.push_str(eol);
            }
        }
    }
    prefix.push_str(&format!("---{eol}"));
    Ok((target, join(&prefix, parts.body, eol)))
}
