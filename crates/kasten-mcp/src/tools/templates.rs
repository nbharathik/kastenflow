//! Templates for agents: what templates the vault has, and
//! proposals to make or change one. A template an agent sends always waits
//! for a person's review; pages start from one with `create_note`.

use kasten_core::agent::AgentOp;
use kasten_core::frontmatter::{set_key, set_key_raw, split, yaml_list};
use kasten_core::props::set_props;
use kasten_core::{Error, Kasten, Result, slugify};
use serde_json::{Value, json};

use crate::params::*;

/// "Road trip" for `road-trip`.
fn label(slug: &str) -> String {
    let words = slug.replace(['-', '_'], " ");
    let mut chars = words.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// The value of a plain `key: value` line in a frontmatter block.
fn frontmatter_value(prefix: &str, key: &str) -> Option<String> {
    prefix.lines().find_map(|line| {
        let rest = line.strip_prefix(key)?.strip_prefix(':')?;
        Some(rest.trim().trim_matches('"').to_owned()).filter(|v| !v.is_empty())
    })
}

pub(crate) fn list_templates(k: &Kasten) -> Result<Value> {
    let mut out = Vec::new();
    // The pages inside a saved project setup are parts of it, not templates to start a page from.
    for meta in k
        .list()?
        .into_iter()
        .filter(|n| n.kind == "template" && !n.path.starts_with("templates/setups/"))
    {
        let slug = meta
            .path
            .trim_start_matches("templates/")
            .trim_end_matches(".md")
            .to_owned();
        let text = k.read(&meta.path)?.text;
        let prefix = split(&text).prefix;
        out.push(json!({
            "name": slug,
            "label": label(&slug),
            "path": meta.path,
            "type": frontmatter_value(prefix, "type").unwrap_or_else(|| "page".to_owned()),
            "icon": meta.icon,
            "tags": meta.tags,
            "props": meta.props,
            "excerpt": meta.excerpt,
        }));
    }
    Ok(json!({ "templates": out }))
}

/// A body that ends its last line.
fn ended(body: &str) -> String {
    if body.is_empty() || body.ends_with('\n') {
        body.to_owned()
    } else {
        format!("{body}\n")
    }
}

pub(crate) fn create_template(_: &Kasten, a: CreateTemplateArgs) -> Result<AgentOp> {
    let note_type = a.note_type.unwrap_or_else(|| "page".to_owned());
    if !matches!(note_type.as_str(), "page" | "card") {
        return Err(Error::Invalid(format!(
            "Templates make pages or cards, not “{note_type}”"
        )));
    }
    let eol = "\n";
    let mut prefix = format!("---{eol}title: \"{{{{title}}}}\"{eol}type: {note_type}{eol}---{eol}");
    if let Some(icon) = a.icon.as_deref().map(str::trim).filter(|i| !i.is_empty()) {
        prefix = set_key(&prefix, "icon", Some(icon), eol);
    }
    if let Some(cover) = a.cover.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        prefix = set_key(&prefix, "cover", Some(cover), eol);
    }
    let tags: Vec<String> = a
        .tags
        .iter()
        .map(|t| t.trim().trim_start_matches('#').to_owned())
        .filter(|t| !t.is_empty())
        .collect();
    if !tags.is_empty() {
        prefix = set_key_raw(&prefix, "tags", Some(&yaml_list(&tags)), eol);
    }
    if !a.props.is_empty() {
        prefix = set_props(&prefix, &a.props, eol)?;
    }
    Ok(AgentOp::Template {
        name: a.name,
        text: format!("{prefix}{}", ended(&a.body)),
        base: None,
        reason: a.reason,
    })
}

pub(crate) fn update_template(k: &Kasten, a: UpdateTemplateArgs) -> Result<AgentOp> {
    let path = format!("templates/{}.md", slugify(&a.name));
    let current = k
        .read(&path)
        .map_err(|_| {
            Error::Invalid(format!(
                "No template called “{}”; list_templates names them",
                a.name
            ))
        })?
        .text;
    let prefix = split(&current).prefix.to_owned();
    Ok(AgentOp::Template {
        name: a.name,
        text: format!("{prefix}{}", ended(&a.body)),
        base: Some(current),
        reason: a.reason,
    })
}
