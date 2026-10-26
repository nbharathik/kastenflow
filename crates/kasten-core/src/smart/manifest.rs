//! `smart.yaml`: what a smart page says about itself. Keys this version does
//! not know stay in the file when it is written back.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{DEFAULT_KIT, MANIFEST_VERSION, MAX_QUERY_LIMIT, is_allowed_path};
use crate::config_keys::Extra;

/// How a filter compares a note's property with its value (the operators of
/// a database view's filter).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FilterOp {
    #[default]
    Is,
    IsNot,
    Contains,
    Empty,
    NotEmpty,
    Before,
    After,
}

/// One filter of a query: `{key, op, value}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmartFilter {
    pub key: String,
    #[serde(default)]
    pub op: FilterOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    #[default]
    Asc,
    Desc,
}

impl SortDir {
    fn is_asc(&self) -> bool {
        *self == SortDir::Asc
    }
}

/// One sort of a query, `{key, dir}`; later sorts break ties of earlier ones.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmartSort {
    pub key: String,
    #[serde(default, skip_serializing_if = "SortDir::is_asc")]
    pub dir: SortDir,
}

/// The notes tagged `tag`, filtered, sorted and capped. Used by `smart.yaml`
/// (named queries) and by the bridge (`query`, `watch`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct QuerySpec {
    pub tag: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter: Vec<SmartFilter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sort: Vec<SmartSort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl QuerySpec {
    pub fn for_tag(tag: &str) -> Self {
        QuerySpec {
            tag: tag.to_string(),
            ..QuerySpec::default()
        }
    }
}

/// A named view of the page, shown alone by `![[Page#name]]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SmartView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// An HTML file inside the folder, when the view is not the main page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// The size the page asks for, in pixels. A block in a page is capped at
/// `MAX_BLOCK_HEIGHT_PX` whatever is asked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SmartSize {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<u32>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmartManifest {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub title: String,
    /// The kit version the page was written for (`smart://kit/<kit>/`).
    #[serde(default = "default_kit")]
    pub kit: String,
    /// Named queries the page reads (`kasten.query("venues")` style names).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub queries: BTreeMap<String, QuerySpec>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub views: BTreeMap<String, SmartView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<SmartSize>,
    #[serde(flatten)]
    pub extra: Extra,
}

fn default_version() -> u32 {
    MANIFEST_VERSION
}

fn default_kit() -> String {
    DEFAULT_KIT.to_string()
}

/// A name a query or view is known by: letters, digits, `_` and `-`.
fn good_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

impl SmartManifest {
    /// What is wrong with the manifest, one plain sentence each; empty when
    /// it is fine. Unknown keys are not a problem.
    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        if self.version != MANIFEST_VERSION {
            problems.push(format!(
                "Manifest version {} is not supported (use {MANIFEST_VERSION}).",
                self.version
            ));
        }
        if self.title.trim().is_empty() {
            problems.push("The manifest needs a title.".to_string());
        }
        if self.kit.trim().is_empty() {
            problems.push("The manifest needs a kit version.".to_string());
        }
        for (name, query) in &self.queries {
            if !good_name(name) {
                problems.push(format!(
                    "Query name \"{name}\" may only use letters, digits, - and _."
                ));
            }
            if query.tag.trim().is_empty() {
                problems.push(format!("Query \"{name}\" needs a tag."));
            }
            if let Some(limit) = query.limit
                && !(1..=MAX_QUERY_LIMIT).contains(&limit)
            {
                problems.push(format!(
                    "Query \"{name}\" limit must be 1 to {MAX_QUERY_LIMIT}."
                ));
            }
        }
        for (name, view) in &self.views {
            if !good_name(name) {
                problems.push(format!(
                    "View name \"{name}\" may only use letters, digits, - and _."
                ));
            }
            if let Some(entry) = &view.entry
                && !is_allowed_path(entry)
            {
                problems.push(format!(
                    "View \"{name}\" points at \"{entry}\", which is not a file the page may have."
                ));
            }
        }
        if let Some(size) = &self.size {
            let (height, max) = (size.height, size.max_height);
            if height == Some(0) || max == Some(0) {
                problems.push("Size must be more than 0.".to_string());
            }
            if let (Some(h), Some(m)) = (height, max)
                && h > m
            {
                problems.push("Size height is more than its maximum height.".to_string());
            }
        }
        problems
    }
}
