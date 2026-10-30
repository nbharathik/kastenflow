//! Formula properties for the tag database: the calculated values of a tag's
//! rows as of the day the window passes in, and a check of one formula as it
//! is typed. Nothing here writes a file.

use std::collections::BTreeMap;

use kasten_core::tags::formula::{Day, Formula, Problems};
use kasten_core::{Error, Kasten, NoteMeta};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

use super::notes::OpenVault;

/// The calculated cells of a tag's rows. `values` has, per note path, the
/// formula keys and their values (null when a cell has none); `problems` says
/// why a cell has none, per path and key.
#[derive(Debug, Serialize, PartialEq)]
pub struct FormulaFill {
    pub values: BTreeMap<String, Map<String, Value>>,
    pub problems: Problems,
}

/// The formulas of the rows tagged `tag`, as of `today` (`YYYY-MM-DD`, the
/// window's own day).
pub fn fill_tag(kasten: &Kasten, tag: &str, today: &str) -> kasten_core::Result<FormulaFill> {
    let day = Day::parse(today).ok_or_else(|| Error::Invalid(format!("Not a day: “{today}”")))?;
    let wanted = tag.trim().trim_start_matches('#').to_lowercase();
    let empty = FormulaFill {
        values: BTreeMap::new(),
        problems: Problems::new(),
    };
    let Some(schema) = kasten
        .tag_schemas()?
        .into_iter()
        .find(|s| s.name.to_lowercase() == wanted)
    else {
        return Ok(empty);
    };
    let keys: Vec<&str> = schema
        .properties
        .iter()
        .filter(|p| p.kind == "formula")
        .map(|p| p.key.as_str())
        .collect();
    if keys.is_empty() {
        return Ok(empty);
    }
    let everything = kasten.list()?;
    let mut rows: Vec<NoteMeta> = everything
        .iter()
        .filter(|n| n.kind != "template" && n.tags.iter().any(|t| t.to_lowercase() == wanted))
        .cloned()
        .collect();
    let problems = kasten.fill_formulas(&schema, &mut rows, &everything, day)?;
    let values = rows
        .iter()
        .map(|row| {
            let cells = keys
                .iter()
                .map(|key| {
                    (
                        (*key).to_owned(),
                        row.props.get(*key).cloned().unwrap_or(Value::Null),
                    )
                })
                .collect();
            (row.path.clone(), cells)
        })
        .collect();
    Ok(FormulaFill { values, problems })
}

#[tauri::command(async)]
pub fn tag_formulas(
    state: State<'_, OpenVault>,
    tag: String,
    today: String,
) -> Result<FormulaFill, String> {
    state.run(|k| fill_tag(k, &tag, &today))
}

/// A property of the tag as the editor has it, for checking the names a
/// formula uses.
#[derive(Debug, Deserialize)]
pub struct FormulaProp {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// What is wrong with a formula, and where (1-based character position).
#[derive(Debug, Serialize, PartialEq)]
pub struct FormulaIssue {
    pub position: usize,
    pub message: String,
}

/// Checks one formula the way saving the schema would; None when it is fine.
pub fn check(source: &str, own_key: &str, props: &[FormulaProp]) -> Option<FormulaIssue> {
    let defs: Vec<(String, String)> = props
        .iter()
        .map(|p| (p.key.trim().to_owned(), p.kind.clone()))
        .collect();
    Formula::parse(source)
        .and_then(|f| f.check_against(own_key.trim(), &defs))
        .err()
        .map(|e| FormulaIssue {
            position: e.position,
            message: e.message,
        })
}

#[tauri::command]
pub fn check_formula(
    formula: String,
    key: String,
    properties: Vec<FormulaProp>,
) -> Option<FormulaIssue> {
    check(&formula, &key, &properties)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kasten_core::history::Actor;
    use kasten_core::{Instant, Kind, NewNote};
    use serde_json::json;

    fn prop(key: &str, kind: &str) -> FormulaProp {
        FormulaProp {
            key: key.into(),
            kind: kind.into(),
        }
    }

    #[test]
    fn a_good_formula_has_no_issue_and_a_bad_one_has_a_position() {
        let props = [prop("deadline", "date"), prop("left", "formula")];
        assert_eq!(check("days_until(deadline)", "left", &props), None);
        let issue = check("days_until(deadlin)", "left", &props).unwrap();
        assert!(issue.position > 1, "{issue:?}");
        assert!(issue.message.contains("deadlin"), "{issue:?}");
        assert!(check("days_until(", "left", &props).is_some());
    }

    #[test]
    fn rows_come_back_with_their_calculated_cells_and_the_files_stay() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-app-formulas-{}",
            kasten_core::ulid_at(Instant::now().millis)
        ));
        let kasten = Kasten::init(&dir, "Formulas").unwrap();
        let now = Instant::now();
        let schema = json!({"properties": [
            {"key": "deadline", "type": "date"},
            {"key": "left", "type": "formula", "formula": "days_until(deadline)"},
        ], "views": [{"name": "All", "type": "table"}]});
        kasten
            .write_tag_schema(&Actor::Human, "job", &schema, now)
            .unwrap();
        let new = NewNote {
            kind: Kind::Page,
            title: "Ship it".into(),
            date: "2026-10-23".into(),
            project: None,
            parent: None,
            template: None,
            icon: None,
        };
        let made = kasten.create(&Actor::Human, &new, now).unwrap();
        let path = made.meta.path;
        kasten
            .set_tags(&Actor::Human, &path, &["job".to_owned()], &[], now)
            .unwrap();
        let mut props = Map::new();
        props.insert("deadline".into(), json!("2026-11-01"));
        kasten
            .update_props(&Actor::Human, &path, &props, now)
            .unwrap();
        let before = std::fs::read_to_string(dir.join(&path)).unwrap();

        let fill = fill_tag(&kasten, "#Job", "2026-10-23").unwrap();
        assert_eq!(fill.values[&path]["left"], json!(9));
        assert!(fill.problems.is_empty());
        assert_eq!(std::fs::read_to_string(dir.join(&path)).unwrap(), before);

        assert!(fill_tag(&kasten, "job", "yesterday").is_err());
        assert!(
            fill_tag(&kasten, "nothing", "2026-10-23")
                .unwrap()
                .values
                .is_empty()
        );
        drop(kasten);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
