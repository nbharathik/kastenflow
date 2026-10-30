//! The queries of a smart page's manifest, tried against the tag schemas: is
//! the tag there, do the keys it filters and sorts by exist, does a value fit
//! the property. Written for a model to fix the manifest from.

use kasten_core::Kasten;
use kasten_core::smart::{FilterOp, MANIFEST_FILE, SmartManifest};
use kasten_core::tags::TagSchema;

use super::Finding;
use crate::tools::smart_data;

/// Fields every note has, whatever its tag's schema says.
const BUILT_IN: [&str; 4] = ["title", "created", "updated", "modified"];

fn error(message: String) -> Finding {
    Finding::new("error", MANIFEST_FILE, None, message)
}

fn warning(message: String) -> Finding {
    Finding::new("warning", MANIFEST_FILE, None, message)
}

fn known_keys(schema: &TagSchema) -> String {
    let mut keys: Vec<&str> = schema.properties.iter().map(|p| p.key.as_str()).collect();
    keys.extend(BUILT_IN);
    keys.join(", ")
}

/// What is wrong with each query of the manifest.
pub(super) fn findings(k: &Kasten, manifest: &SmartManifest) -> Vec<Finding> {
    let mut out: Vec<Finding> = manifest.validate().into_iter().map(error).collect();
    for (name, spec) in &manifest.queries {
        if spec.tag.trim().is_empty() {
            continue;
        }
        let tag = spec.tag.trim().trim_start_matches('#');
        let (schema, found) = match smart_data::rows(
            k,
            &kasten_core::smart::QuerySpec {
                filter: Vec::new(),
                sort: Vec::new(),
                ..spec.clone()
            },
        ) {
            Ok(rows) => rows,
            Err(err) => {
                out.push(error(format!("Query “{name}” could not be tried: {err}")));
                continue;
            }
        };
        let keys: Vec<&str> = spec
            .filter
            .iter()
            .map(|f| f.key.as_str())
            .chain(spec.sort.iter().map(|s| s.key.as_str()))
            .collect();
        match &schema {
            None if !keys.is_empty() && !found.is_empty() => {
                // Without a schema a key can only be a property the notes happen to have.
                for key in keys {
                    let anywhere = BUILT_IN.contains(&key) || found.iter().any(|n| n.props.get(key).is_some());
                    if !anywhere {
                        out.push(warning(format!(
                            "Query “{name}” uses “{key}”, but no note tagged #{tag} has that property and the tag has no schema"
                        )));
                    }
                }
            }
            None if found.is_empty() => out.push(warning(format!(
                "Query “{name}” asks for #{tag}, which no note has yet, so it returns nothing. Check the spelling of the tag"
            ))),
            Some(schema) => {
                for key in keys {
                    if !BUILT_IN.contains(&key) && !schema.properties.iter().any(|p| p.key == key) {
                        out.push(error(format!(
                            "Query “{name}” uses “{key}”, which #{tag} does not have. It has: {}",
                            known_keys(schema)
                        )));
                    }
                }
                for filter in &spec.filter {
                    let Some(prop) = schema.properties.iter().find(|p| p.key == filter.key) else {
                        continue;
                    };
                    if matches!(filter.op, FilterOp::Before | FilterOp::After) && prop.kind != "date" {
                        out.push(warning(format!(
                            "Query “{name}” compares “{}” with before or after, but it is a {} property, not a date",
                            filter.key, prop.kind
                        )));
                    }
                    if prop.kind == "select"
                        && matches!(filter.op, FilterOp::Is | FilterOp::IsNot)
                        && let Some(value) = filter.value.as_ref().and_then(|v| v.as_str())
                        && !prop.options.iter().any(|o| o == value)
                    {
                        out.push(warning(format!(
                            "Query “{name}” looks for “{value}” in “{}”, which is one of: {}",
                            filter.key,
                            prop.options.join(", ")
                        )));
                    }
                }
            }
            None => {}
        }
    }
    out
}
