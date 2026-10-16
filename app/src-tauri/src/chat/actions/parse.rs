//! Reading an AI action: Markdown whose frontmatter says what it is
//! (`type: ai-action`, a `title`, an `icon`), what it needs and may use
//! (`needs`, `optional`), whether its answer is only read or goes into the
//! page (`writes`), where it is offered (`where`) and which format it is in
//! (`version`). Its body is the instruction, in words: the page, the
//! selection and the rest go in next to it as data, never into it.
//!
//! A file with a mistake is described in words, and keys this version does
//! not know are left alone, so a later version's file still reads.

use kasten_core::frontmatter::{read_map, split};
use serde::Serialize;
use serde_json::{Map, Value};

/// The longest an action's file may be.
pub const MAX_BYTES: usize = 16 * 1024;
/// The format this version reads.
pub const VERSION: u64 = 1;
const DEFAULT_ICON: &str = "sparkle";

/// What an action works from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Need {
    /// The text selected in a page or a PDF.
    Selection,
    /// The whole page.
    Page,
    /// The text around the selection or the cursor.
    Nearby,
    /// Pages, cards, boards and the like the person attached.
    Sources,
    /// Pages of a PDF.
    Pdf,
    /// Highlights of a PDF.
    Highlights,
    /// The project the page belongs to.
    Project,
    /// The journal page of the day.
    Journal,
}

impl Need {
    pub const ALL: [Need; 8] = [
        Need::Selection,
        Need::Page,
        Need::Nearby,
        Need::Sources,
        Need::Pdf,
        Need::Highlights,
        Need::Project,
        Need::Journal,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Need::Selection => "selection",
            Need::Page => "page",
            Need::Nearby => "nearby",
            Need::Sources => "sources",
            Need::Pdf => "pdf",
            Need::Highlights => "highlights",
            Need::Project => "project",
            Need::Journal => "journal",
        }
    }
}

/// What an action does with its answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Writes {
    /// The answer is read, nothing more.
    None,
    /// The answer can go into the page, as the person's own edit.
    Insert,
    /// The answer is a change to review first.
    Propose,
}

/// Where an action is offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    Editor,
    Chat,
    Pdf,
}

/// One AI action, built in or from the vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    /// What it is called in files and by overrides: the file's name, lower case.
    pub slug: String,
    pub title: String,
    pub icon: String,
    pub needs: Vec<Need>,
    pub optional: Vec<Need>,
    pub writes: Writes,
    #[serde(rename = "where")]
    pub places: Vec<Place>,
    pub version: u64,
    /// The body of the file: what to do.
    pub instruction: String,
    /// Shipped with the app, not read from the vault.
    pub built_in: bool,
    /// The vault file it comes from, if it does.
    pub path: Option<String>,
}

/// The values of `key` as words: a list, or one word.
fn words(map: &Map<String, Value>, key: &str) -> Result<Vec<String>, String> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::String(one)) => Ok(vec![one.trim().to_owned()]),
        Some(Value::Array(list)) => list
            .iter()
            .map(|item| match item {
                Value::String(word) => Ok(word.trim().to_owned()),
                _ => Err(format!("“{key}” should be a list of words")),
            })
            .collect(),
        Some(_) => Err(format!("“{key}” should be a list of words")),
    }
}

fn needs(map: &Map<String, Value>, key: &str) -> Result<Vec<Need>, String> {
    let mut out = Vec::new();
    for word in words(map, key)? {
        let Some(need) = Need::ALL
            .iter()
            .find(|need| need.name().eq_ignore_ascii_case(&word))
        else {
            let known: Vec<&str> = Need::ALL.iter().map(|n| n.name()).collect();
            return Err(format!(
                "“{key}” has an unknown need “{word}”; the needs are {}",
                known.join(", ")
            ));
        };
        if !out.contains(need) {
            out.push(*need);
        }
    }
    Ok(out)
}

/// `text` as the action called `slug`, or why it is not one.
pub fn parse(slug: &str, text: &str) -> Result<Action, String> {
    if text.len() > MAX_BYTES {
        return Err(format!(
            "The file is longer than {} KB, which is too long for an instruction",
            MAX_BYTES / 1024
        ));
    }
    let parts = split(text);
    if parts.prefix.trim().is_empty() {
        return Err(
            "The file has no frontmatter; it should start with --- and say type: ai-action"
                .to_owned(),
        );
    }
    let map = read_map(parts.prefix)
        .map_err(|why| format!("The frontmatter could not be read: {why}"))?;
    let kind = words(&map, "type")?;
    if kind.first().map(String::as_str) != Some("ai-action") {
        return Err("The frontmatter should say type: ai-action".to_owned());
    }
    let title = match map.get("title") {
        Some(Value::String(title)) if !title.trim().is_empty() => title.trim().to_owned(),
        _ => return Err("The file needs a title".to_owned()),
    };
    let icon = match map.get("icon") {
        Some(Value::String(icon)) if !icon.trim().is_empty() => icon.trim().to_owned(),
        _ => DEFAULT_ICON.to_owned(),
    };
    let writes = match words(&map, "writes")?.first().map(|w| w.to_lowercase()) {
        None => Writes::None,
        Some(word) => match word.as_str() {
            "none" => Writes::None,
            "insert" => Writes::Insert,
            "propose" => Writes::Propose,
            other => {
                return Err(format!(
                    "“writes” should be none, insert or propose, not “{other}”"
                ));
            }
        },
    };
    let mut places = Vec::new();
    let asked = words(&map, "where")?;
    for word in &asked {
        let place = match word.to_lowercase().as_str() {
            "editor" => Place::Editor,
            "chat" => Place::Chat,
            "pdf" => Place::Pdf,
            other => {
                return Err(format!(
                    "“where” has an unknown place “{other}”; the places are editor, chat, pdf"
                ));
            }
        };
        if !places.contains(&place) {
            places.push(place);
        }
    }
    if asked.is_empty() {
        places = vec![Place::Editor, Place::Chat];
    }
    let version = match map.get("version") {
        None | Some(Value::Null) => VERSION,
        Some(Value::Number(n)) => n
            .as_u64()
            .filter(|v| *v >= 1)
            .ok_or("“version” should be a whole number from 1")?,
        Some(_) => return Err("“version” should be a whole number from 1".to_owned()),
    };
    if version > VERSION {
        return Err(format!(
            "The file is in format {version}, which this version of KastenFlow cannot read (it reads format {VERSION})"
        ));
    }
    let instruction = parts.body.trim().to_owned();
    if instruction.is_empty() {
        return Err(
            "The file has no instruction: write what to do below the frontmatter".to_owned(),
        );
    }
    Ok(Action {
        slug: slug.to_owned(),
        title,
        icon,
        needs: needs(&map, "needs")?,
        optional: needs(&map, "optional")?,
        writes,
        places,
        version,
        instruction,
        built_in: false,
        path: None,
    })
}
