//! A sidecar read as JSON and kept as it is: an object with one array of
//! entries, one per line when written, in the boards' house style. Keys
//! KastenFlow does not know (in the document and in each entry) survive in
//! their order, so another tool's additions are not lost on the next save.

use serde_json::{Map, Value};

use crate::error::{Error, Result};

/// Whether an id can sit in a file name, a link and a frontmatter value as it
/// is: letters, digits, `-` and `_`. Other tools write sidecars too.
pub(crate) fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A sidecar document: the object as read, with its array of entries.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ListDoc {
    doc: Map<String, Value>,
    /// The key of the array of entries: `comments` or `highlights`.
    key: &'static str,
}

impl ListDoc {
    /// An empty document that names its `format`.
    pub(crate) fn new(key: &'static str, format: &str) -> ListDoc {
        let mut doc = Map::new();
        doc.insert("format".to_owned(), format.into());
        doc.insert(key.to_owned(), Value::Array(Vec::new()));
        ListDoc { doc, key }
    }

    /// A document in any JSON formatting. It needs to be an object; the array
    /// of entries is added when it has none. `what` names the file in the
    /// message when it is not one ("a comments file").
    pub(crate) fn parse(text: &str, key: &'static str, what: &str) -> Result<ListDoc> {
        let bad = |why: String| Error::Invalid(format!("Not {what}: {why}"));
        let value: Value = serde_json::from_str(text).map_err(|err| bad(err.to_string()))?;
        let Value::Object(mut doc) = value else {
            return Err(bad("the top level is not an object".into()));
        };
        match doc.get(key) {
            Some(Value::Array(_)) => {}
            Some(_) => return Err(bad(format!("`{key}` is not an array"))),
            None => {
                doc.insert(key.to_owned(), Value::Array(Vec::new()));
            }
        }
        Ok(ListDoc { doc, key })
    }

    /// The document in house style: an entry on each line.
    pub(crate) fn to_text(&self) -> String {
        crate::board::json_document(&self.doc, &[self.key])
    }

    pub(crate) fn items(&self) -> &[Value] {
        match self.doc.get(self.key) {
            Some(Value::Array(items)) => items,
            _ => &[],
        }
    }

    pub(crate) fn items_mut(&mut self) -> &mut Vec<Value> {
        match self
            .doc
            .entry(self.key)
            .or_insert_with(|| Value::Array(Vec::new()))
        {
            Value::Array(items) => items,
            _ => unreachable!("parse and new keep an array here"),
        }
    }

    /// The entry with this id, to change in place.
    pub(crate) fn find_mut(&mut self, id: &str, what: &str) -> Result<&mut Map<String, Value>> {
        self.items_mut()
            .iter_mut()
            .filter_map(Value::as_object_mut)
            .find(|item| text_of(item, "id") == Some(id))
            .ok_or_else(|| Error::Invalid(format!("No {what} {id} on this page")))
    }
}

/// A string field of an entry.
pub(crate) fn text_of<'a>(item: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    item.get(key).and_then(Value::as_str)
}
