//! Formula properties: `{key: days_left, type: formula, formula: "days_until(deadline)"}`.
//!
//! A formula is computed when rows are read and is never written to a note.
//! The grammar is small on purpose:
//!
//! ```text
//! formula := value
//! value   := number | "text" | property | function "(" [value {"," value}] ")"
//! property:= key | relation.key        (the dotted form only inside sum, min, max)
//! ```
//!
//! Functions: `days_until(date)`, `days_since(date)`, `count(property)`,
//! `count_backlinks()`, `sum(relation.key)`, `min(relation.key)`,
//! `max(relation.key)` (the number `key` of each note the relation names; a
//! property holding a list of numbers works too) and `if_empty(value, other)`.
//! There are no loops, no user-defined functions and no network. Formulas
//! are at most 400 characters, 8 calls deep and 60 parts long. A date is
//! `YYYY-MM-DD`; a missing date gives an empty value. An error in one cell
//! gives an empty value and a sentence for that cell; it never hides the row.

mod day;
mod eval;
mod lexer;
mod parser;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_eval;

use std::collections::BTreeMap;
use std::fmt;

use serde_json::Value;

pub use day::Day;
pub use eval::Env;
pub use parser::{FUNCTIONS, MAX_DEPTH, MAX_NODES};

use super::{PropDef, TagSchema};
use crate::note::NoteMeta;

/// A mistake in a formula, with the 1-based character position it is at.
#[derive(Debug, Clone, PartialEq)]
pub struct FormulaError {
    pub position: usize,
    pub message: String,
}

impl FormulaError {
    pub fn at(position: usize, message: impl Into<String>) -> FormulaError {
        FormulaError {
            position,
            message: message.into(),
        }
    }
}

impl fmt::Display for FormulaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (at position {})", self.message, self.position)
    }
}

impl std::error::Error for FormulaError {}

/// A formula that parsed.
#[derive(Debug, Clone, PartialEq)]
pub struct Formula {
    expr: parser::Expr,
}

/// Fields every note has, besides its properties.
const BUILT_IN: [&str; 4] = ["title", "created", "updated", "modified"];

impl Formula {
    pub fn parse(source: &str) -> Result<Formula, FormulaError> {
        parser::parse(source).map(|expr| Formula { expr })
    }

    /// The value for one note, or the sentence that says why there is none.
    pub fn eval(&self, note: &NoteMeta, env: &Env) -> Result<Value, String> {
        eval::eval(&self.expr, note, env)
    }

    pub fn uses_backlinks(&self) -> bool {
        self.expr.calls("count_backlinks")
    }

    /// Checks the properties it names against a schema's `(key, type)` list.
    pub fn check_against(
        &self,
        own_key: &str,
        defs: &[(String, String)],
    ) -> Result<(), FormulaError> {
        let mut named = Vec::new();
        self.expr.props(&mut named);
        for (name, pos) in named {
            let (base, dotted) = match name.split_once('.') {
                Some((base, _)) => (base, true),
                None => (name, false),
            };
            let kind = defs
                .iter()
                .find(|(k, _)| k == base)
                .map(|(_, t)| t.as_str());
            match kind {
                _ if base == own_key => {
                    return Err(FormulaError::at(pos, "a formula cannot use itself"));
                }
                Some("formula") => {
                    return Err(FormulaError::at(
                        pos,
                        format!("a formula cannot use another formula (“{base}”)"),
                    ));
                }
                Some("relation") => {}
                Some(_) if dotted => {
                    return Err(FormulaError::at(
                        pos,
                        format!("“{base}” is not a relation, so “{name}” has no meaning"),
                    ));
                }
                Some(_) => {}
                None if !dotted && BUILT_IN.contains(&base) => {}
                None => {
                    return Err(FormulaError::at(
                        pos,
                        format!("“{base}” is not a property of this tag"),
                    ));
                }
            }
        }
        Ok(())
    }
}

/// Checks every formula property in a schema's property list (as written, as
/// JSON). The error is one sentence naming the property and the position.
pub fn check_list(properties: &[Value]) -> Result<(), String> {
    let defs: Vec<(String, String)> = properties
        .iter()
        .filter_map(|p| {
            let key = p.get("key")?.as_str()?.trim().to_owned();
            let kind = p.get("type").and_then(Value::as_str).unwrap_or("text");
            Some((key, kind.to_owned()))
        })
        .collect();
    for prop in properties {
        if prop.get("type").and_then(Value::as_str) != Some("formula") {
            continue;
        }
        let key = prop.get("key").and_then(Value::as_str).unwrap_or("").trim();
        let source = prop.get("formula").and_then(Value::as_str).unwrap_or("");
        let checked = Formula::parse(source).and_then(|f| f.check_against(key, &defs));
        if let Err(err) = checked {
            return Err(format!("formula of “{key}”: {err}"));
        }
    }
    Ok(())
}

/// Per note path, per formula key: why a cell has no value.
pub type Problems = BTreeMap<String, BTreeMap<String, String>>;

/// Whether any formula of the schema counts backlinks.
pub fn needs_backlinks(schema: &TagSchema) -> bool {
    schema.properties.iter().any(|p| {
        p.kind == "formula"
            && p.formula
                .as_deref()
                .and_then(|f| Formula::parse(f).ok())
                .is_some_and(|f| f.uses_backlinks())
    })
}

fn formulas(schema: &TagSchema) -> impl Iterator<Item = &PropDef> {
    schema.properties.iter().filter(|p| p.kind == "formula")
}

/// Sets each formula property of `schema` in the `props` of these copies of
/// notes (an empty value on an error) and returns the problems. The files are
/// not touched: this works on the copies a reader holds.
pub fn fill(notes: &mut [NoteMeta], schema: &TagSchema, env: &Env) -> Problems {
    let mut problems = Problems::new();
    for def in formulas(schema) {
        let parsed = Formula::parse(def.formula.as_deref().unwrap_or(""))
            .and_then(|f| f.check_against(&def.key, &defs_of(schema)).map(|()| f));
        let values: Vec<Result<Value, String>> = notes
            .iter()
            .map(|note| match &parsed {
                Ok(formula) => formula.eval(note, env),
                Err(err) => Err(format!("The formula cannot be read: {err}")),
            })
            .collect();
        for (note, value) in notes.iter_mut().zip(values) {
            let value = value.unwrap_or_else(|why| {
                problems
                    .entry(note.path.clone())
                    .or_default()
                    .insert(def.key.clone(), why);
                Value::Null
            });
            if !note.props.is_object() {
                note.props = Value::Object(Default::default());
            }
            if let Some(map) = note.props.as_object_mut() {
                map.insert(def.key.clone(), value);
            }
        }
    }
    problems
}

fn defs_of(schema: &TagSchema) -> Vec<(String, String)> {
    schema
        .properties
        .iter()
        .map(|p| (p.key.clone(), p.kind.clone()))
        .collect()
}
