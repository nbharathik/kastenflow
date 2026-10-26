//! Working out what a project setup would do: where its files go, which of
//! them the vault has already, which properties the project page lacks; and
//! the two writes the apply makes with that plan, filling a file's placeholders
//! and adding properties to a page. Nothing here writes a file the plan says
//! exists.

use std::collections::HashMap;
use std::fs;

use serde_json::{Map, Value};

use super::kits::with_ids;
use super::setup_saved::{Loaded, load};
use super::setups::{Manifest, SetupPlan, SetupTarget, VAULT};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::frontmatter::{join, read_map, set_key, split, still_readable};
use crate::ops::eol_of;
use crate::props::{props_of, set_props};
use crate::slug::slugify;
use crate::time::Instant;
use crate::vault::Vault;

/// What a plan works out: where things go and what is already there.
pub(super) struct Planned {
    pub manifest: Manifest,
    pub title: String,
    pub folder: String,
    pub new_project: bool,
    /// Every file of the setup: its path in the vault and its raw text.
    pub files: Vec<(String, String)>,
    pub exists: Vec<bool>,
    /// Properties the project page gains.
    pub add: Map<String, Value>,
}

impl Planned {
    pub fn page_written(&self) -> bool {
        self.new_project || !self.add.is_empty()
    }

    fn project_path(&self) -> String {
        format!("projects/{}/_project.md", self.folder)
    }

    pub fn plan(&self) -> SetupPlan {
        let mut create = Vec::new();
        if self.page_written() {
            create.push(self.project_path());
        }
        let mut keep = Vec::new();
        for ((path, _), exists) in self.files.iter().zip(&self.exists) {
            if *exists {
                keep.push(path.clone());
            } else {
                create.push(path.clone());
            }
        }
        keep.sort();
        SetupPlan {
            project_path: self.project_path(),
            home: format!("projects/{}/{}", self.folder, self.manifest.home),
            create,
            keep,
            props: self.add.keys().cloned().collect(),
        }
    }
}

/// `value` with the things a text file would not take as it is escaped: for a
/// JSON file (a deck or a board), quotes, backslashes and control characters.
fn for_json(value: &str) -> String {
    let quoted = serde_json::to_string(value).unwrap_or_default();
    quoted
        .get(1..quoted.len().saturating_sub(1))
        .unwrap_or_default()
        .to_owned()
}

/// `text` with each `{{name:key}}` replaced by what `value` makes of `key`.
fn replace_tokens(text: &str, name: &str, mut value: impl FnMut(&str) -> String) -> String {
    let open = format!("{{{{{name}:");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(&open) {
        out.push_str(&rest[..at]);
        let after = &rest[at + open.len()..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[at..]);
            return out;
        };
        out.push_str(&value(&after[..end]));
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

/// Whether a page of a setup names no `id` or `parent` but its own
/// placeholders (`{{id:…}}`): a fixed one would repeat the id of a note that
/// is there or put the page under a note of another project. A header that
/// cannot be read has none to check.
fn ids_are_its_own(path: &str, raw: &str) -> bool {
    if !path.ends_with(".md") {
        return true;
    }
    let mut made = HashMap::new();
    let text = with_ids(raw, &mut made, Instant::now());
    let Ok(keys) = read_map(split(&text).prefix) else {
        return true;
    };
    let own = |given: &Value| matches!(given, Value::String(s) if made.values().any(|o| o == s));
    ["id", "parent"].iter().all(|key| match keys.get(*key) {
        None | Some(Value::Null) => true,
        Some(given) => own(given),
    }) && match keys.get("children_order") {
        // The order of the sub-pages names their ids: another note's would
        // list a page that is not this one's child.
        None | Some(Value::Null) => true,
        Some(Value::Array(list)) => list.iter().all(own),
        Some(_) => false,
    }
}

/// Works out where a setup goes and what is already there.
pub(super) fn plan_setup(vault: &Vault, id: &str, target: &SetupTarget) -> Result<Planned> {
    let Loaded {
        manifest,
        files: setup_files,
    } = load(vault, id)?;
    let (title, folder, new_project, page_props) = match target {
        SetupTarget::New { title } => {
            let title = title.trim().to_owned();
            if title.is_empty()
                || title.contains(['[', ']', '|'])
                || title.chars().any(char::is_control)
            {
                return Err(Error::Invalid(
                    "A title needs some text and no [ ] or | characters".to_owned(),
                ));
            }
            let base = slugify(&title);
            let mut folder = base.clone();
            let mut n = 2;
            while vault.root().join("projects").join(&folder).exists() {
                folder = format!("{base}-{n}");
                n += 1;
            }
            (title, folder, true, Map::new())
        }
        SetupTarget::Existing { folder } => {
            if folder.is_empty() || slugify(folder) != *folder {
                return Err(Error::Invalid(format!("Not a project folder: {folder}")));
            }
            let page = format!("projects/{folder}/_project.md");
            if !vault.exists(&page) {
                return Err(Error::Invalid(format!("No project called {folder}")));
            }
            let note = vault.read(&page)?;
            let props = props_of(split(&note.text).prefix);
            (note.meta.title, folder.clone(), false, props)
        }
    };
    let mut files = Vec::new();
    let mut exists = Vec::new();
    for (rel, raw) in setup_files {
        if !ids_are_its_own(&rel, &raw) {
            return Err(Error::Invalid(format!(
                "The setup “{id}” has a page ({rel}) that names a note of its own by id, which a setup may not do"
            )));
        }
        let path = match rel.strip_prefix(VAULT) {
            Some(vault_file) => vault_file.to_owned(),
            None => format!("projects/{folder}/{rel}"),
        };
        let file = vault.file_of(&path, &[".md", ".yaml", ".canvas", ".deck"])?;
        exists.push(fs::symlink_metadata(&file).is_ok());
        files.push((path, raw));
    }
    let add = manifest
        .props
        .iter()
        .filter(|(key, _)| page_props.get(*key).is_none_or(Value::is_null))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    Ok(Planned {
        manifest,
        title,
        folder,
        new_project,
        files,
        exists,
        add,
    })
}

/// A setup file's text with its placeholders filled.
pub(super) fn fill(
    raw: &str,
    path: &str,
    planned: &Planned,
    ids: &mut HashMap<String, String>,
    now: Instant,
) -> String {
    let json = path.ends_with(".deck") || path.ends_with(".canvas");
    let project = if json {
        for_json(&planned.title)
    } else {
        planned.title.clone()
    };
    let text = raw
        .replace("{{project}}", &project)
        .replace("{{slug}}", &planned.folder)
        .replace("{{date}}", &now.rfc3339()[..10]);
    // A deck's id is `d-` and eight lower-case characters: the tail of a made id.
    let text = replace_tokens(&text, "id8", |key| {
        let id = ids
            .entry(key.to_owned())
            .or_insert_with(|| crate::id::ulid_at(now.millis));
        id[id.len() - 8..].to_ascii_lowercase()
    });
    with_ids(&text, ids, now)
}

/// Adds `add` to the properties of the page at `path`, stamping `updated`.
pub(super) fn add_props(
    vault: &Vault,
    path: &str,
    add: &Map<String, Value>,
    now: Instant,
) -> Result<()> {
    if add.is_empty() {
        return Ok(());
    }
    let current = vault.read(path)?;
    let parts = split(&current.text);
    let eol = eol_of(&current.text);
    let prefix = set_props(parts.prefix, add, eol)?;
    let prefix = set_key(&prefix, "updated", Some(&now.rfc3339()), eol);
    still_readable(parts.prefix, &prefix)?;
    write_atomic(
        &vault.path_of(path)?,
        join(&prefix, parts.body, eol).as_bytes(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_replaced_one_by_one_and_an_unclosed_one_is_left() {
        let mut seen = Vec::new();
        let out = replace_tokens("a {{id8:x}} b {{id8:y}} {{id8:z", "id8", |k| {
            seen.push(k.to_owned());
            k.to_uppercase()
        });
        assert_eq!(out, "a X b Y {{id8:z");
        assert_eq!(seen, ["x", "y"]);
    }

    #[test]
    fn a_title_goes_into_json_without_breaking_it() {
        assert_eq!(for_json("plain"), "plain");
        assert_eq!(for_json("say \"hi\" \\ now"), "say \\\"hi\\\" \\\\ now");
        let doc = format!("{{\"t\": \"{}\"}}", for_json("a\"b\nc"));
        assert!(serde_json::from_str::<Value>(&doc).is_ok());
    }
}
