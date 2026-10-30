//! The structure tools: put a page inside another, put sub-pages in order,
//! make a project, change a project's state, change a tag's views. Each builds
//! one agent op for the core to refuse, run or keep for review.

use kasten_core::agent::AgentOp;
use kasten_core::{Error, ProjectState, Result};
use serde_json::{Map, Value};

use super::lookup::Lookup;
use crate::params_structure::*;

pub(crate) fn set_parent(k: &dyn Lookup, a: SetParentArgs) -> Result<AgentOp> {
    Ok(AgentOp::SetParent {
        path: k.resolve(&a.note)?,
        parent: a.parent.map(|p| k.resolve(&p)).transpose()?,
    })
}

pub(crate) fn reorder_children(k: &dyn Lookup, a: ReorderChildrenArgs) -> Result<AgentOp> {
    let parent = k.resolve(&a.note)?;
    let mut ids = Vec::with_capacity(a.children.len());
    for (n, child) in a.children.iter().enumerate() {
        let place = format!("Sub-page {} (“{child}”)", n + 1);
        let path = k
            .resolve(child)
            .map_err(|err| Error::Invalid(format!("{place}: {err}")))?;
        let id = k.id_of(&path)?.ok_or_else(|| {
            Error::Invalid(format!(
                "{place} has no id, so it is not a sub-page of any page"
            ))
        })?;
        ids.push(id);
    }
    Ok(AgentOp::ReorderChildren { parent, ids })
}

pub(crate) fn create_project(_: &dyn Lookup, a: CreateProjectArgs) -> Result<AgentOp> {
    Ok(AgentOp::CreateProject {
        title: a.title,
        setup: a.setup,
    })
}

/// A project's page from the project's title, folder name or page path.
fn project_page(k: &dyn Lookup, reference: &str) -> Result<String> {
    k.resolve(reference).or_else(|first| {
        k.resolve(&format!("projects/{}/_project.md", reference.trim()))
            .map_err(|_| first)
    })
}

pub(crate) fn list_setups(k: &kasten_core::Kasten) -> Result<Value> {
    Ok(serde_json::json!({ "setups": k.list_setups()? }))
}

pub(crate) fn save_project_setup(k: &dyn Lookup, a: SaveProjectSetupArgs) -> Result<AgentOp> {
    let pages = a
        .pages
        .map(|list| {
            list.iter()
                .map(|page| k.resolve(page))
                .collect::<Result<Vec<_>>>()
        })
        .transpose()?;
    Ok(AgentOp::SaveProjectSetup {
        project: project_page(k, &a.project)?,
        slug: a.slug.unwrap_or_default(),
        title: a.name,
        pages,
    })
}

pub(crate) fn set_project_state(k: &dyn Lookup, a: SetProjectStateArgs) -> Result<AgentOp> {
    Ok(AgentOp::SetProjectState {
        path: project_page(k, &a.project)?,
        state: state_of(a.change)?,
    })
}

/// The change as the core takes it. A key that is not part of the state is
/// refused by name (a misspelt key would otherwise change nothing and say
/// nothing); the property names of the page are accepted too.
fn state_of(change: Value) -> Result<ProjectState> {
    let Value::Object(given) = change else {
        return Err(Error::Invalid(
            "change is an object such as {\"status\": \"Paused\"}".to_owned(),
        ));
    };
    let mut fixed = Map::new();
    for (key, value) in given {
        let name = match key.as_str() {
            "status" => "status",
            "health" => "health",
            "nextAction" | "next_action" => "nextAction",
            "reviewed" | "lastReview" | "last_review" => "reviewed",
            "reviewAfter" | "review_after" => "reviewAfter",
            other => {
                return Err(Error::Invalid(format!(
                    "“{other}” is not part of a project's state. The keys are status, health, nextAction, reviewed and reviewAfter"
                )));
            }
        };
        if !(value.is_null() || value.is_string()) {
            return Err(Error::Invalid(format!(
                "“{key}” is text, or null to take it away"
            )));
        }
        if fixed.insert(name.to_owned(), value).is_some() {
            return Err(Error::Invalid(format!("“{name}” is given twice")));
        }
    }
    if fixed.is_empty() {
        return Err(Error::Invalid(
            "Say what to change: status, health, nextAction, reviewed or reviewAfter".to_owned(),
        ));
    }
    serde_json::from_value(Value::Object(fixed)).map_err(|err| Error::Invalid(err.to_string()))
}

pub(crate) fn set_view_order(k: &dyn Lookup, a: SetViewOrderArgs) -> Result<AgentOp> {
    let mut ids = Vec::with_capacity(a.rows.len());
    for (n, row) in a.rows.iter().enumerate() {
        let place = format!("Row {} (“{row}”)", n + 1);
        let path = k
            .resolve(row)
            .map_err(|err| Error::Invalid(format!("{place}: {err}")))?;
        let id = k.id_of(&path)?.ok_or_else(|| {
            Error::Invalid(format!("{place} has no id, so it cannot be put in order"))
        })?;
        ids.push(id);
    }
    Ok(AgentOp::SetViewOrder {
        tag: a.tag,
        view: a.view,
        ids,
    })
}

pub(crate) fn set_tag_views(_: &dyn Lookup, a: SetTagViewsArgs) -> Result<AgentOp> {
    Ok(AgentOp::SetTagViews {
        tag: a.tag,
        views: a.views,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_state_names_only_keys_it_has_and_takes_the_property_spellings() {
        let state =
            state_of(json!({"status": "Paused", "review_after": "2026-12-01", "health": null}))
                .unwrap();
        assert_eq!(state.status, Some(Some("Paused".to_owned())));
        assert_eq!(state.review_after, Some(Some("2026-12-01".to_owned())));
        assert_eq!(state.health, Some(None));
        assert_eq!(state.next_action, None);
        for bad in [
            json!({}),
            json!("Paused"),
            json!({"statuss": "Paused"}),
            json!({"status": 3}),
            json!({"reviewed": "2026-01-01", "last_review": "2026-01-02"}),
        ] {
            assert!(state_of(bad.clone()).is_err(), "{bad}");
        }
    }
}
