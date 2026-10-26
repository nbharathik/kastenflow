//! A tag database's views and properties, saved into the tag's YAML by
//! rewriting only that list (tag_yaml.rs). A person's view changes are batched
//! like typing; a property change commits at once, since values are checked
//! against it.

use std::fs;
use std::io::ErrorKind;

use serde_json::Value;

use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::frontmatter::yaml_scalar;
use crate::history::Actor;
use crate::slug::slugify;
use crate::tag_yaml::set_list;
use crate::tags::{KINDS, TagSchema, VIEW_KINDS, parse_schema};
use crate::time::Instant;

fn text_of<'a>(item: &'a Value, key: &str) -> Option<&'a str> {
    item.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Whether a tag database shows a view: a mapping with a name and a type
/// it knows. Others, written by another tool, are kept as they are.
pub(super) fn shown(view: &Value) -> bool {
    view.is_object()
        && text_of(view, "name").is_some()
        && view
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|kind| VIEW_KINDS.contains(&kind))
}

pub(super) fn check_views(tag: &str, views: &[Value]) -> Result<()> {
    let bad = |why: String| Error::Invalid(format!("Views of “{tag}”: {why}"));
    let mut names: Vec<String> = Vec::new();
    for view in views {
        if !view.is_object() {
            return Err(bad("each view must be a mapping".into()));
        }
        let name = text_of(view, "name").ok_or_else(|| bad("each view needs a name".into()))?;
        let kind = view.get("type").and_then(Value::as_str).unwrap_or("");
        if !VIEW_KINDS.contains(&kind) {
            return Err(bad(format!(
                "“{name}” has an unknown type “{kind}”; the view types are {}",
                VIEW_KINDS.join(", ")
            )));
        }
        crate::tags::sub_items::check_view(view).map_err(bad)?;
        crate::tags::view_order::check_view(view).map_err(bad)?;
        let lower = name.to_lowercase();
        if names.contains(&lower) {
            return Err(bad(format!("two views are called “{name}”")));
        }
        names.push(lower);
    }
    Ok(())
}

fn check_properties(tag: &str, properties: &[Value]) -> Result<()> {
    let bad = |why: String| Error::Invalid(format!("Properties of “{tag}”: {why}"));
    let mut keys: Vec<&str> = Vec::new();
    for prop in properties {
        if !prop.is_object() {
            return Err(bad("each property must be a mapping".into()));
        }
        let key = text_of(prop, "key").ok_or_else(|| bad("each property needs a key".into()))?;
        let kind = prop.get("type").and_then(Value::as_str).unwrap_or("text");
        if !KINDS.contains(&kind) {
            return Err(bad(format!("“{key}” has an unknown type “{kind}”")));
        }
        if let Some(options) = prop.get("options") {
            let names = options
                .as_array()
                .is_some_and(|o| o.iter().all(|v| v.is_string() || v.is_number()));
            if !names {
                return Err(bad(format!(
                    "the options of “{key}” must be a list of names"
                )));
            }
        }
        if keys.contains(&key) {
            return Err(bad(format!("two properties are called “{key}”")));
        }
        keys.push(key);
    }
    crate::tags::formula::check_list(properties).map_err(bad)?;
    Ok(())
}

impl Kasten {
    /// Timeline views read the tag's date and choice properties, and table
    /// views group and calculate by them; they are checked against the tag's
    /// schema as it is saved.
    fn check_timelines(&self, tag: &str, views: &[Value]) -> Result<()> {
        let timelines = || {
            views
                .iter()
                .filter(|v| v.get("type").and_then(Value::as_str) == Some("timeline"))
        };
        let tables = || {
            views
                .iter()
                .filter(|v| v.get("type").and_then(Value::as_str) == Some("table"))
        };
        if timelines().next().is_none() && tables().next().is_none() {
            return Ok(());
        }
        let schemas = self.tag_schemas()?;
        let known = schemas.iter().find(|s| s.name.eq_ignore_ascii_case(tag));
        let props: &[crate::tags::PropDef] = known.map_or(&[], |s| s.properties.as_slice());
        // A view saved as it already is stays saved even when a property it
        // names has gone since (the properties are changed on their own and
        // do not look at views): only what is new or changed is checked, so a
        // stale setting never blocks saving another view.
        let stored: &[Value] = known.map_or(&[], |s| s.views.as_slice());
        let changed = |view: &&Value| !stored.contains(view);
        let kind_of = |key: &str| props.iter().find(|p| p.key == key).map(|p| p.kind.as_str());
        for view in timelines().filter(changed) {
            crate::tags::timeline::check_view(view, &kind_of)
                .map_err(|why| Error::Invalid(format!("Views of “{tag}”: {why}")))?;
        }
        for view in tables().filter(changed) {
            crate::tags::table_options::check_view(view, &kind_of)
                .map_err(|why| Error::Invalid(format!("Views of “{tag}”: {why}")))?;
        }
        Ok(())
    }

    /// Replaces the views a tag database shows in the tag's YAML, keeping
    /// after them the views it does not show (another tool's), and the rest
    /// of the file as written; makes the file for a tag that has none.
    pub fn set_tag_views(
        &self,
        actor: &Actor,
        tag: &str,
        views: &[Value],
        now: Instant,
    ) -> Result<TagSchema> {
        let name = tag.trim().trim_start_matches('#').trim();
        check_views(name, views)?;
        self.check_timelines(name, views)?;
        // An agent changes the views of a tag that has a schema; making the
        // schema is `update_tag_schema`, which waits for review.
        if actor.is_agent() {
            self.tag_views_refusals(name, views)?;
        }
        self.set_tag_list(actor, name, "views", views, true, now)
    }

    /// Replaces a tag's properties the same way.
    pub fn set_tag_properties(
        &self,
        actor: &Actor,
        tag: &str,
        properties: &[Value],
        now: Instant,
    ) -> Result<TagSchema> {
        let name = tag.trim().trim_start_matches('#').trim();
        check_properties(name, properties)?;
        self.set_tag_list(actor, name, "properties", properties, false, now)
    }

    fn set_tag_list(
        &self,
        actor: &Actor,
        name: &str,
        key: &str,
        items: &[Value],
        batch: bool,
        now: Instant,
    ) -> Result<TagSchema> {
        if !name.chars().any(char::is_alphanumeric) {
            return Err(Error::Invalid(format!("Not a tag name: “{name}”")));
        }
        let slug = slugify(name);
        // The file whose name is this tag, whatever it is called.
        let known = self
            .tag_schemas()?
            .into_iter()
            .find(|s| s.name.eq_ignore_ascii_case(name));
        let path = known.map_or_else(|| format!("tags/{slug}.yaml"), |s| s.path);
        self.apply(actor, "update_tag_schema", batch, now.millis, |vault| {
            let file = vault.file_of(&path, &[".yaml"])?;
            let before = match fs::read_to_string(&file) {
                Ok(text) => text,
                Err(err) if err.kind() == ErrorKind::NotFound => {
                    format!("name: {}\n", yaml_scalar(name))
                }
                Err(err) => return Err(err.into()),
            };
            let mut items = items.to_vec();
            // Views a tag database does not show stay after the new ones.
            if key == "views"
                && let Ok(old) = parse_schema(&path, &before)
            {
                items.extend(old.views.into_iter().filter(|view| !shown(view)));
            }
            let yaml = set_list(&before, key, &items);
            // A file that no longer parses is left alone.
            let schema = parse_schema(&path, &yaml)?;
            if let Some(dir) = file.parent() {
                fs::create_dir_all(dir)?;
            }
            write_atomic(&file, yaml.as_bytes())?;
            Ok(Change {
                message: format!("{key}: #{}", schema.name),
                paths: vec![path.clone()],
                value: schema,
            })
        })
    }
}
