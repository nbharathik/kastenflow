//! The page a board was made from, such as a page's mind map. The app keeps
//! one object under `x-kasten.source`: the page's id, and what it needs to
//! bring the board in step with the page again (which branch came from
//! which line, and how the page stood when it last did). The core checks its
//! shape and size, reads the page's id for lists, and otherwise treats it as
//! opaque: other tools ignore it and every unknown key inside it survives.

use serde_json::Value;

use super::{Canvas, EXTRAS};
use crate::error::{Error, Result};

const SOURCE: &str = "source";
/// The most branches a source may remember: a page's map is capped far
/// below this, so the limit only stops a runaway file.
const MAX_BRANCHES: usize = 1_000;

impl Canvas {
    /// Sets what the board says about its page, or with None forgets it.
    pub(super) fn set_source(&mut self, source: Option<&Value>) -> Result<()> {
        let Some(source) = source else {
            if let Some(Value::Object(extras)) = self.doc.get_mut(EXTRAS) {
                extras.shift_remove(SOURCE);
            }
            return Ok(());
        };
        check(source)?;
        self.extras_mut()?.insert(SOURCE.to_owned(), source.clone());
        Ok(())
    }

    /// Everything the board remembers about its page, if it has a page.
    pub fn source(&self) -> Option<&Value> {
        self.doc.get(EXTRAS)?.get(SOURCE)
    }

    /// The id of the page the board was made from, if any.
    pub fn source_page(&self) -> Option<&str> {
        self.source()?.get("page")?.as_str().map(str::trim)
    }
}

fn check(source: &Value) -> Result<()> {
    let Some(object) = source.as_object() else {
        return Err(Error::Invalid(
            "A board's source is an object naming its page".to_owned(),
        ));
    };
    let named = object
        .get("page")
        .and_then(Value::as_str)
        .is_some_and(|page| !page.trim().is_empty());
    if !named {
        return Err(Error::Invalid("A board's source names its page".to_owned()));
    }
    match object.get("branches") {
        None => Ok(()),
        Some(Value::Object(branches)) => {
            if branches.len() > MAX_BRANCHES {
                return Err(Error::Invalid(format!(
                    "A board's source remembers at most {MAX_BRANCHES} branches, not {}",
                    branches.len()
                )));
            }
            if branches.values().all(Value::is_object) {
                Ok(())
            } else {
                Err(Error::Invalid(
                    "Each of a source's branches is an object".to_owned(),
                ))
            }
        }
        Some(_) => Err(Error::Invalid(
            "A source's branches are an object, by node id".to_owned(),
        )),
    }
}
