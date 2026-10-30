//! Evaluates a checked formula for one note. Nothing here reads the clock,
//! a file or the network: the day is given, the other notes are given, and
//! the result is the same every time for the same input.

use std::collections::HashMap;

use serde_json::{Number, Value};

use super::day::Day;
use super::parser::Expr;
use crate::note::NoteMeta;
use crate::tag_query::value_of;

/// Most related notes one sum, min or max looks at.
const MAX_RELATED: usize = 10_000;

/// What a formula can see besides its own note.
pub struct Env<'a> {
    pub today: Day,
    /// Notes by id, to follow relations.
    pub notes: HashMap<&'a str, &'a NoteMeta>,
    /// How many notes link each path; `None` when the caller did not look.
    pub backlinks: Option<HashMap<String, usize>>,
}

impl<'a> Env<'a> {
    pub fn new(today: Day, all: &'a [NoteMeta]) -> Env<'a> {
        let notes = all
            .iter()
            .filter_map(|n| Some((n.id.as_deref()?, n)))
            .collect();
        Env {
            today,
            notes,
            backlinks: None,
        }
    }
}

fn number(x: f64) -> Result<Value, String> {
    if !x.is_finite() {
        return Err("the result is not a number".to_owned());
    }
    if x.fract() == 0.0 && x.abs() < 9e15 {
        return Ok(Value::from(x as i64));
    }
    Number::from_f64(x)
        .map(Value::Number)
        .ok_or_else(|| "the result is not a number".to_owned())
}

pub fn is_blank(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        _ => false,
    }
}

fn as_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok().filter(|v| v.is_finite()),
        _ => None,
    }
}

/// The day a value names; `None` inside `Ok` when it is empty.
fn day_of(name: &str, value: &Value) -> Result<Option<Day>, String> {
    match value {
        v if is_blank(v) => Ok(None),
        Value::String(s) => Day::parse(s).map(Some).ok_or_else(|| {
            format!(
                "{name}: “{}” is not a date; dates are written YYYY-MM-DD",
                s.trim()
            )
        }),
        _ => Err(format!("{name} needs a date")),
    }
}

/// The numbers a property holds: its own list of numbers, or, for
/// `relation.key`, the `key` of each related note.
fn numbers(note: &NoteMeta, path: &str, env: &Env) -> Vec<f64> {
    let flat = |v: Value| -> Vec<Value> {
        match v {
            Value::Array(items) => items,
            Value::Null => Vec::new(),
            other => vec![other],
        }
    };
    let values: Vec<Value> = match path.split_once('.') {
        Some((relation, inner)) => flat(value_of(note, relation))
            .iter()
            .take(MAX_RELATED)
            .filter_map(|id| env.notes.get(id.as_str()?))
            .map(|related| value_of(related, inner))
            .collect(),
        None => flat(value_of(note, path)),
    };
    values.iter().filter_map(as_number).collect()
}

pub fn eval(expr: &Expr, note: &NoteMeta, env: &Env) -> Result<Value, String> {
    match expr {
        Expr::Number(n, _) => number(*n),
        Expr::Text(t, _) => Ok(Value::String(t.clone())),
        Expr::Prop(name, _) => Ok(value_of(note, name)),
        Expr::Call { name, args, .. } => call(name, args, note, env),
    }
}

fn call(name: &str, args: &[Expr], note: &NoteMeta, env: &Env) -> Result<Value, String> {
    let prop = |i: usize| match &args[i] {
        Expr::Prop(p, _) => p.as_str(),
        _ => "",
    };
    match name {
        "days_until" | "days_since" => {
            let value = eval(&args[0], note, env)?;
            let Some(day) = day_of(name, &value)? else {
                return Ok(Value::Null);
            };
            let days = if name == "days_until" {
                day.0 - env.today.0
            } else {
                env.today.0 - day.0
            };
            Ok(Value::from(days))
        }
        "count" => match value_of(note, prop(0)) {
            Value::Array(items) => Ok(Value::from(items.len())),
            v if is_blank(&v) => Ok(Value::from(0)),
            Value::Object(_) => Err("count needs a list".to_owned()),
            _ => Ok(Value::from(1)),
        },
        "count_backlinks" => {
            let counts = env
                .backlinks
                .as_ref()
                .ok_or_else(|| "backlinks are not available here".to_owned())?;
            Ok(Value::from(counts.get(&note.path).copied().unwrap_or(0)))
        }
        "sum" => number(numbers(note, prop(0), env).iter().sum()),
        "min" | "max" => {
            let all = numbers(note, prop(0), env);
            let pick = if name == "min" {
                all.into_iter().reduce(f64::min)
            } else {
                all.into_iter().reduce(f64::max)
            };
            pick.map_or(Ok(Value::Null), number)
        }
        "if_empty" => {
            let first = eval(&args[0], note, env)?;
            if is_blank(&first) {
                eval(&args[1], note, env)
            } else {
                Ok(first)
            }
        }
        other => Err(format!("unknown function “{other}”")),
    }
}
