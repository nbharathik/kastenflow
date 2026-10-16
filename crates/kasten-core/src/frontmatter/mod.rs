//! Frontmatter: splitting a note into its YAML block and body without moving
//! a byte, reading the keys Kasten knows through `serde-saphyr`, and changing
//! one key by editing only that key's lines.

use std::borrow::Cow;

use serde::Deserialize;
use serde::de::{self, Deserializer, Visitor};

mod keys;

pub use keys::{
    append_blocks, key_blocks, rename_key, set_key, set_key_raw, yaml_flow_scalar, yaml_list,
    yaml_scalar,
};

const BOM: &str = "\u{feff}";

/// A note file cut in two: `prefix` is the byte order mark plus the YAML block
/// with both fences; `body` is everything after. `prefix + body` is the file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Split<'a> {
    pub prefix: &'a str,
    pub body: &'a str,
}

/// Frontmatter starts at the top (after an optional BOM) with a line that is
/// exactly `---` and ends at the next such line. An unterminated block is
/// body, as in Obsidian and Jekyll.
pub fn split(text: &str) -> Split<'_> {
    let bom = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let rest = &text[bom..];
    let Some(first) = line_end(rest, 0).filter(|&end| is_fence(&rest[..end])) else {
        return Split {
            prefix: &text[..bom],
            body: rest,
        };
    };
    let mut start = first;
    while start < rest.len() {
        let end = line_end(rest, start).unwrap_or(rest.len());
        if is_fence(&rest[start..end]) {
            let cut = bom + end;
            return Split {
                prefix: &text[..cut],
                body: &text[cut..],
            };
        }
        start = end;
    }
    Split {
        prefix: &text[..bom],
        body: rest,
    }
}

/// End of the line starting at `start`, including its line break; None at EOF.
fn line_end(text: &str, start: usize) -> Option<usize> {
    if start >= text.len() {
        return None;
    }
    Some(
        text[start..]
            .find('\n')
            .map_or(text.len(), |i| start + i + 1),
    )
}

fn is_fence(line: &str) -> bool {
    line.trim_end_matches(['\n', '\r'])
        .trim_end_matches([' ', '\t'])
        == "---"
}

/// The keys Kasten reads from a note's frontmatter. Everything else is kept
/// untouched in the file and ignored here.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Front {
    pub id: Option<Text>,
    pub title: Option<Text>,
    #[serde(rename = "type")]
    pub kind: Option<Text>,
    pub icon: Option<Text>,
    pub cover: Option<Text>,
    pub parent: Option<Text>,
    pub created: Option<Text>,
    pub updated: Option<Text>,
    pub tags: Option<Tags>,
    /// Tag property values.
    pub props: Option<crate::loose::Loose>,
    /// `locked: true` makes the note read-only for agents.
    pub locked: Option<Text>,
}

/// Any scalar read as text: `title: 2026` is a title, not a parse error.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Text(pub String);

impl<'de> Deserialize<'de> for Text {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ScalarVisitor;
        impl Visitor<'_> for ScalarVisitor {
            type Value = Text;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a scalar")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Text, E> {
                Ok(Text(v.to_owned()))
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Text, E> {
                Ok(Text(v.to_string()))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Text, E> {
                Ok(Text(v.to_string()))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Text, E> {
                Ok(Text(v.to_string()))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Text, E> {
                Ok(Text(v.to_string()))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Text, E> {
                Ok(Text(String::new()))
            }
            fn visit_none<E: de::Error>(self) -> Result<Text, E> {
                Ok(Text(String::new()))
            }
        }
        deserializer.deserialize_any(ScalarVisitor)
    }
}

/// `tags: [a, b]`, a block list, or a single tag.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tags(pub Vec<String>);

impl<'de> Deserialize<'de> for Tags {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Either {
            Many(Vec<Text>),
            One(Text),
        }
        Ok(match Either::deserialize(deserializer)? {
            Either::Many(list) => Tags(
                list.into_iter()
                    .map(|t| t.0)
                    .filter(|t| !t.is_empty())
                    .collect(),
            ),
            Either::One(one) => Tags(if one.0.is_empty() {
                vec![]
            } else {
                vec![one.0]
            }),
        })
    }
}

impl Front {
    /// Reads the known keys from a prefix. Malformed YAML reads as empty, so
    /// a broken note still lists under its file name.
    pub fn read(prefix: &str) -> Front {
        let yaml = yaml_of(prefix);
        if yaml.trim().is_empty() {
            return Front::default();
        }
        serde_saphyr::from_str::<Front>(yaml).unwrap_or_default()
    }

    pub fn text(field: &Option<Text>) -> Option<String> {
        field
            .as_ref()
            .map(|t| t.0.trim().to_owned())
            .filter(|t| !t.is_empty())
    }
}

/// Whether a prefix's YAML parses at all, with the parser's message if not.
pub fn check_yaml(prefix: &str) -> Result<(), String> {
    let yaml = yaml_of(prefix);
    if yaml.trim().is_empty() {
        return Ok(());
    }
    serde_saphyr::from_str::<crate::loose::Loose>(yaml)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Every key of a prefix's YAML as JSON, for readers whose keys are their
/// own (an AI action's `needs`). No frontmatter reads as no keys; a block
/// that is not a map of keys, or does not parse, is an error with the
/// parser's words.
pub fn read_map(prefix: &str) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let yaml = yaml_of(prefix);
    if yaml.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    match serde_saphyr::from_str::<serde_json::Value>(yaml).map_err(|e| e.to_string())? {
        serde_json::Value::Object(map) => Ok(map),
        serde_json::Value::Null => Ok(serde_json::Map::new()),
        _ => Err("The frontmatter is not a list of keys".to_owned()),
    }
}

/// Whether a prefix's YAML reads as a map of keys, or there is none.
pub fn yaml_ok(prefix: &str) -> bool {
    let yaml = yaml_of(prefix);
    yaml.trim().is_empty()
        || matches!(
            serde_saphyr::from_str::<serde_json::Value>(yaml),
            Ok(serde_json::Value::Object(_) | serde_json::Value::Null)
        )
}

/// The file for `prefix` and `body`. A closing fence that ends the file
/// with no line end gets one (`eol`, the note's), so the body never runs
/// onto the fence and turns the frontmatter into text.
pub fn join(prefix: &str, body: &str, eol: &str) -> String {
    let fenced = !prefix.strip_prefix(BOM).unwrap_or(prefix).is_empty();
    if fenced && !body.is_empty() && !prefix.ends_with('\n') {
        format!("{prefix}{eol}{body}")
    } else {
        format!("{prefix}{}", body_under(prefix, body))
    }
}

/// `body` as written under `prefix`. With no frontmatter above, a body that
/// opens with a `---` rule and has another such line below would read as
/// frontmatter, so its opening rule is written `***`: the same rule.
pub fn body_under<'a>(prefix: &str, body: &'a str) -> Cow<'a, str> {
    let bare = prefix.strip_prefix(BOM).unwrap_or(prefix).is_empty();
    if bare
        && body.starts_with("---")
        && split(&format!("{prefix}{body}")).prefix.len() > prefix.len()
    {
        Cow::Owned(format!("***{}", &body[3..]))
    } else {
        Cow::Borrowed(body)
    }
}

/// Refuses an edit that would leave frontmatter that read well unreadable:
/// its title, id and `locked` would be lost. Frontmatter that was already
/// broken stays the person's to mend.
pub fn still_readable(before: &str, after: &str) -> crate::error::Result<()> {
    if yaml_ok(before) && !yaml_ok(after) {
        return Err(crate::error::Error::Invalid(
            "That change would make the note's frontmatter unreadable, so nothing was written"
                .to_owned(),
        ));
    }
    Ok(())
}

/// The YAML between the fences of a prefix.
fn yaml_of(prefix: &str) -> &str {
    let rest = prefix.strip_prefix(BOM).unwrap_or(prefix);
    let Some(first) = line_end(rest, 0) else {
        return "";
    };
    let last = rest
        .trim_end_matches(['\n', '\r'])
        .rfind('\n')
        .map_or(first, |i| i + 1);
    if last <= first {
        ""
    } else {
        &rest[first..last]
    }
}

#[cfg(test)]
mod tests;
