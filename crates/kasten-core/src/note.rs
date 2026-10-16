//! What a note file tells the rest of Kasten: its metadata from frontmatter
//! and path, its content hash, and the pages it links to.

use serde::Serialize;

use crate::frontmatter::{Front, split};

/// A note's metadata, as lists, trees and search show it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    /// Vault-relative path with forward slashes; the note's handle in every op.
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    /// `page`, `card`, `journal`, `project`, `chat`, `highlight` or
    /// `template`, or whatever other `type:` the note's frontmatter gives.
    pub kind: String,
    pub icon: Option<String>,
    pub cover: Option<String>,
    /// Id of the parent page, for sub-pages.
    pub parent: Option<String>,
    /// Folder name under `projects/`, if the note lives in one.
    pub project: Option<String>,
    pub tags: Vec<String>,
    /// Last modification, in milliseconds since the Unix epoch.
    pub modified: u64,
    /// `created` and `updated` from the frontmatter, as written.
    pub created: Option<String>,
    pub updated: Option<String>,
    /// The first readable text, for cards and previews.
    pub excerpt: String,
    pub words: u32,
    /// Tag property values, as JSON.
    pub props: serde_json::Value,
    /// Read-only for agents.
    pub locked: bool,
}

/// A note's full text with its metadata and content hash.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub meta: NoteMeta,
    pub text: String,
    /// Hash of `text`; saves pass it back to detect changes made meanwhile.
    pub hash: String,
}

/// FNV-1a over the bytes, as 16 hex digits. Only compares versions of one
/// file; it is not a security boundary.
pub fn content_hash(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The kind of an AI action: a Markdown file in `templates/ai/` that the app
/// runs on a page. It is not a template for new pages, and it is left out of
/// the lists of notes (`Kasten::list`), search and to-dos.
pub const AI_ACTION: &str = "ai-action";

/// The kind a note's folder implies when its frontmatter names none.
fn kind_from_path(path: &str) -> &'static str {
    let parts: Vec<&str> = path.split('/').collect();
    match parts.as_slice() {
        ["journal", ..] => "journal",
        ["templates", "ai", _, ..] => AI_ACTION,
        ["templates", ..] => "template",
        ["inbox", ..] => "card",
        ["chats", ..] => "chat",
        ["projects", _, "_project.md"] => "project",
        ["projects", _, "cards", ..] => "card",
        _ => "page",
    }
}

fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name)
}

pub fn meta_for(path: &str, text: &str, modified: u64) -> NoteMeta {
    meta_with_extract(path, text, modified).0
}

/// The note's metadata and everything the index keeps from its body.
pub fn meta_with_extract(
    path: &str,
    text: &str,
    modified: u64,
) -> (NoteMeta, crate::extract::Extract) {
    let parts = split(text);
    let front = Front::read(parts.prefix);
    let mut body = crate::extract::extract_titled(parts.body, Front::text(&front.title).as_deref());
    let from_path = kind_from_path(path);
    // A template or an AI action is so by its folder; no other note can
    // claim the kind of an action by what its frontmatter says.
    let kind = if from_path == "template" || from_path == AI_ACTION {
        from_path.to_owned()
    } else {
        Front::text(&front.kind)
            .filter(|kind| kind != AI_ACTION)
            .unwrap_or_else(|| from_path.to_owned())
    };
    let project = match path.split('/').collect::<Vec<_>>().as_slice() {
        ["projects", name, _, ..] => Some((*name).to_owned()),
        _ => None,
    };
    let fallback = match stem(path) {
        "_project" => project.clone().unwrap_or_default(),
        s => s.to_owned(),
    };
    let meta = NoteMeta {
        path: path.to_owned(),
        id: Front::text(&front.id),
        title: Front::text(&front.title).unwrap_or(fallback),
        kind,
        icon: Front::text(&front.icon),
        cover: Front::text(&front.cover),
        parent: Front::text(&front.parent),
        project,
        tags: front.tags.map(|t| t.0).unwrap_or_default(),
        modified,
        created: Front::text(&front.created),
        updated: Front::text(&front.updated),
        excerpt: std::mem::take(&mut body.excerpt),
        words: body.words,
        props: match front.props {
            Some(crate::loose::Loose(value @ serde_json::Value::Object(_))) => value,
            _ => serde_json::Value::Object(serde_json::Map::new()),
        },
        locked: Front::text(&front.locked).is_some_and(|v| v == "true" || v == "yes"),
    };
    (meta, body)
}

/// Titles this text links to with `[[Title]]`, `[[Title#Heading]]`,
/// `[[Title|alias]]` or `![[Title]]`, in order; escaped `\[[` is not a link.
pub fn wiki_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut rest = line;
        let mut offset = 0;
        while let Some(start) = rest.find("[[") {
            let absolute = offset + start;
            let escaped = absolute > 0 && line.as_bytes()[absolute - 1] == b'\\';
            let after = &rest[start + 2..];
            let Some(end) = after.find("]]") else { break };
            let inner = &after[..end];
            if !escaped && !inner.is_empty() && !inner.contains('[') {
                let target = inner.split('|').next().unwrap_or(inner);
                let title = target.split('#').next().unwrap_or(target).trim();
                if !title.is_empty() {
                    out.push(title.to_owned());
                }
            }
            let consumed = start + 2 + end + 2;
            offset += consumed;
            rest = &rest[consumed..];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_metadata_from_frontmatter_and_path() {
        let meta = meta_for(
            "projects/photo-organiser/pages/roadmap.md",
            "---\nid: X\ntitle: Road map\nicon: 🗺️\n---\nBody",
            5,
        );
        assert_eq!(meta.title, "Road map");
        assert_eq!(meta.kind, "page");
        assert_eq!(meta.project.as_deref(), Some("photo-organiser"));
        assert_eq!(meta.icon.as_deref(), Some("🗺️"));

        let bare = meta_for("inbox/quick-idea.md", "Just text", 0);
        assert_eq!(
            (bare.title.as_str(), bare.kind.as_str()),
            ("quick-idea", "card")
        );
        assert_eq!(meta_for("projects/p/_project.md", "", 0).title, "p");
        assert_eq!(
            meta_for("templates/paper.md", "---\ntype: page\n---\n", 0).kind,
            "template"
        );
        assert_eq!(
            meta_for("journal/2026/2026-09-24.md", "", 0).kind,
            "journal"
        );
        assert_eq!(meta_for("chats/2026-09-24-plans.md", "", 0).kind, "chat");
    }

    #[test]
    fn an_ai_action_is_so_by_its_folder_alone() {
        assert_eq!(meta_for("templates/ai/outline.md", "", 0).kind, AI_ACTION);
        assert_eq!(
            meta_for("templates/ai/outline.md", "---\ntype: page\n---\n", 0).kind,
            AI_ACTION
        );
        // Not a template named `ai`, and not a page that says so.
        assert_eq!(meta_for("templates/ai.md", "", 0).kind, "template");
        assert_eq!(
            meta_for("library/x.md", "---\ntype: ai-action\n---\n", 0).kind,
            "page"
        );
    }

    #[test]
    fn finds_wiki_links() {
        let text = "See [[A]] and [[B#Part|alias]], ![[C]].\nNot \\[[escaped]] or [[]] or [[x";
        assert_eq!(wiki_links(text), vec!["A", "B", "C"]);
    }

    #[test]
    fn hashes_differ_when_text_does() {
        assert_eq!(content_hash("a").len(), 16);
        assert_ne!(content_hash("a"), content_hash("b"));
        assert_eq!(content_hash("same"), content_hash("same"));
    }
}
