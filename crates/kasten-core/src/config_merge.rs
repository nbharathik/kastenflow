//! Writes the vault's config back without losing what the program does not
//! model: YAML comments, keys a newer version wrote, the order of the keys.
//! The new config is written as YAML first; then, block by block (a block is a
//! top-level key with its lines and the comments above it), a block whose
//! value did not change keeps the old file's bytes, and a block that did takes
//! the new text. Keys only the old file has stay unless this version knows
//! them (a known key that is no longer set was removed on purpose).

use std::collections::BTreeMap;

use crate::config::Config;

/// The top-level keys of `Config`; one that the new text leaves out is
/// removed, any other key of the old file is somebody else's and stays.
const KNOWN: [&str; 9] = [
    "name",
    "format",
    "git",
    "guardrails",
    "ai",
    "journal_template",
    "plugins",
    "agents",
    "backup",
];

struct Block {
    key: String,
    text: String,
}

struct Parts {
    /// Comment and blank lines before the first key.
    head: String,
    blocks: Vec<Block>,
    /// Comment and blank lines after the last block.
    tail: String,
}

fn key_of(line: &str) -> Option<&str> {
    let first = line.chars().next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    let key_ok = key
        .trim_end()
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    let rest_ok = rest.is_empty() || rest.starts_with([' ', '\t', '\r', '\n']);
    (key_ok && rest_ok).then(|| key.trim_end())
}

fn is_quiet(line: &str) -> bool {
    line.trim().is_empty() || line.starts_with('#')
}

/// A list item written at the key's own indent (`skipped:` then `- path: a`),
/// which YAML allows.
fn is_item(line: &str) -> bool {
    line.strip_prefix('-')
        .is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '\t', '\r', '\n']))
}

/// None when the text is not a plain block mapping this can split safely
/// (a flow mapping, a `---` line, repeated keys, content before the first key).
fn split(text: &str) -> Option<Parts> {
    let mut head = String::new();
    let mut blocks: Vec<Block> = Vec::new();
    let mut pending = String::new();
    for line in text.split_inclusive('\n') {
        if let Some(key) = key_of(line) {
            if blocks.iter().any(|b| b.key == key) {
                return None;
            }
            // Comments above the first key stay at the top of the file; the
            // ones above a later key belong to that key.
            let lead = std::mem::take(&mut pending);
            let lead = if blocks.is_empty() {
                head.push_str(&lead);
                String::new()
            } else {
                lead
            };
            blocks.push(Block {
                key: key.to_owned(),
                text: format!("{lead}{line}"),
            });
        } else if is_quiet(line) {
            pending.push_str(line);
        } else if line.starts_with([' ', '\t']) || is_item(line) {
            let last = blocks.last_mut()?;
            last.text.push_str(&pending);
            pending.clear();
            last.text.push_str(line);
        } else {
            return None;
        }
    }
    if blocks.is_empty() {
        head.push_str(&std::mem::take(&mut pending));
    }
    Some(Parts {
        head,
        blocks,
        tail: pending,
    })
}

fn with_newline(mut text: String) -> String {
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

/// What differs between files: which keys a newer version of the program
/// owns, when two texts of a key say the same, and which new keys are not
/// worth adding.
pub(crate) struct Rules<'a> {
    /// A key of the old file that the new text leaves out is removed when it
    /// is one of these; any other key is somebody else's and stays.
    pub known: &'a [&'a str],
    /// Whether two texts of one key mean the same.
    pub same: &'a dyn Fn(&str, &str, &str) -> bool,
    /// A key the old file lacks, whose new text adds nothing.
    pub adds_nothing: &'a dyn Fn(&str, &str) -> bool,
}

fn same_yaml(a: &str, b: &str) -> bool {
    let read = |text: &str| serde_saphyr::from_str::<serde_json::Value>(text).ok();
    matches!((read(a), read(b)), (Some(x), Some(y)) if x == y)
}

/// The same rules for any file whose keys are all `known`: values compare as
/// YAML, and every new key is kept.
pub(crate) fn merge_yaml(old: &str, new: &str, known: &[&str]) -> String {
    merge_with(
        old,
        new,
        &Rules {
            known,
            same: &|_, a, b| same_yaml(a, b),
            adds_nothing: &|_, _| false,
        },
    )
}

/// `new` (the config as YAML) with the old file's comments, unknown keys and
/// key order put back wherever the value did not change.
pub(crate) fn merge(old: &str, new: &str) -> String {
    merge_with(
        old,
        new,
        &Rules {
            known: &KNOWN,
            // A key of the config means what the config reads from it (a
            // default left out equals the default written).
            same: &|key, a, b| {
                if KNOWN.contains(&key) {
                    let read = |text: &str| serde_saphyr::from_str::<Config>(text).ok();
                    matches!((read(a), read(b)), (Some(x), Some(y)) if x == y)
                } else {
                    same_yaml(a, b)
                }
            },
            adds_nothing: &|key, text| {
                KNOWN.contains(&key)
                    && serde_saphyr::from_str::<Config>(text).is_ok_and(|c| c == Config::default())
            },
        },
    )
}

pub(crate) fn merge_with(old: &str, new: &str, rules: &Rules) -> String {
    let crlf = old.contains("\r\n");
    let new = if crlf && !new.contains('\r') {
        new.replace('\n', "\r\n")
    } else {
        new.to_owned()
    };
    let (Some(old_parts), Some(new_parts)) = (split(old), split(&new)) else {
        return new;
    };
    let mut fresh: BTreeMap<&str, &Block> = new_parts
        .blocks
        .iter()
        .map(|b| (b.key.as_str(), b))
        .collect();
    let mut out = old_parts.head.clone();
    for block in &old_parts.blocks {
        match fresh.remove(block.key.as_str()) {
            Some(now) if (rules.same)(&block.key, &block.text, &now.text) => {
                out.push_str(&with_newline(block.text.clone()));
            }
            Some(now) => {
                // The comments above the key stay; its value is the new one.
                let lead: String = block
                    .text
                    .split_inclusive('\n')
                    .take_while(|line| is_quiet(line))
                    .collect();
                out.push_str(&lead);
                out.push_str(&with_newline(now.text.clone()));
            }
            None if rules.known.contains(&block.key.as_str()) => {}
            None => out.push_str(&with_newline(block.text.clone())),
        }
    }
    for block in &new_parts.blocks {
        if fresh.contains_key(block.key.as_str()) && !(rules.adds_nothing)(&block.key, &block.text)
        {
            out.push_str(&with_newline(block.text.clone()));
        }
    }
    out.push_str(&old_parts.tail);
    if out.trim().is_empty() { new } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OLD: &str = "# My vault\nname: Notes\n\n# keep this one small\ngit:\n  push_delay_seconds: 120 # two minutes\nfuture_key:\n  - a\n  - b # why\nformat: 1\n# end\n";

    fn config() -> Config {
        serde_saphyr::from_str("name: Notes\ngit:\n  push_delay_seconds: 120\nformat: 1\n").unwrap()
    }

    #[test]
    fn an_unchanged_config_is_written_back_byte_for_byte() {
        let new = serde_saphyr::to_string(&config()).unwrap();
        assert_eq!(merge(OLD, &new), OLD);
    }

    #[test]
    fn a_changed_block_takes_the_new_text_and_the_rest_stays() {
        let mut c = config();
        c.git.push_delay_seconds = 30;
        let new = serde_saphyr::to_string(&c).unwrap();
        let out = merge(OLD, &new);
        assert!(out.starts_with("# My vault\nname: Notes\n"), "{out}");
        assert!(out.contains("push_delay_seconds: 30"), "{out}");
        assert!(!out.contains("two minutes"), "{out}");
        assert!(out.contains("# keep this one small\ngit:"), "{out}");
        assert!(out.contains("future_key:\n  - a\n  - b # why\n"), "{out}");
        assert!(out.ends_with("format: 1\n# end\n"), "{out}");
        let back: Config = serde_saphyr::from_str(&out).unwrap();
        assert_eq!(back.git.push_delay_seconds, 30);
    }

    #[test]
    fn a_known_key_that_is_no_longer_set_goes_and_an_unknown_one_stays() {
        let old = "name: A\nplugins:\n  latex: true\nfuture: 1\n";
        let out = merge(old, &serde_saphyr::to_string(&Config::default()).unwrap());
        assert!(!out.contains("plugins") && !out.contains("latex"), "{out}");
        assert!(out.contains("future: 1\n"), "{out}");
    }

    #[test]
    fn new_keys_are_added_after_the_old_ones() {
        let mut c = config();
        c.journal_template = Some("daily".into());
        let out = merge(OLD, &serde_saphyr::to_string(&c).unwrap());
        assert!(out.contains("journal_template: daily"), "{out}");
        assert!(out.find("format: 1").unwrap() < out.find("journal_template").unwrap());
        assert!(out.ends_with("# end\n"), "{out}");
    }

    #[test]
    fn a_list_written_at_the_keys_indent_belongs_to_its_key() {
        let old = "# kept\nskipped:\n- path: a.bin\n  size: 7\nextra: 1\n";
        let new = "skipped:\n- path: a.bin\n  size: 9\nextra: 1\n";
        assert_eq!(
            merge_yaml(old, new, &["skipped"]),
            "# kept\nskipped:\n- path: a.bin\n  size: 9\nextra: 1\n"
        );
        assert_eq!(merge_yaml(old, old, &["skipped"]), old);
    }

    #[test]
    fn a_crlf_file_stays_crlf() {
        let old = "# c\r\nname: Notes\r\nformat: 1\r\n";
        let mut c = config();
        c.name = "Other".into();
        let out = merge(old, &serde_saphyr::to_string(&c).unwrap());
        assert!(
            out.contains("# c\r\n") && out.contains("name: Other\r\n"),
            "{out:?}"
        );
        assert!(!out.replace("\r\n", "").contains('\n'), "{out:?}");
    }

    #[test]
    fn a_file_it_cannot_split_is_replaced_by_the_new_text() {
        let new = serde_saphyr::to_string(&config()).unwrap();
        for old in [
            "{name: A}\n",
            "---\nname: A\n",
            "name: A\nname: B\n",
            "- a\n",
        ] {
            assert_eq!(merge(old, &new), new, "{old:?}");
        }
        // An empty or comment-only file gets the keys that differ from the
        // defaults, after its comments.
        let empty = merge("", &new);
        assert_eq!(serde_saphyr::from_str::<Config>(&empty).unwrap(), config());
        let noted = merge("# only a comment\n", &new);
        assert!(
            noted.starts_with("# only a comment\nname: Notes\n"),
            "{noted}"
        );
        assert_eq!(serde_saphyr::from_str::<Config>(&noted).unwrap(), config());
    }

    #[test]
    fn every_key_the_config_writes_is_known() {
        let mut c: Config = serde_saphyr::from_str(
            "plugins:\n  latex: true\nagents:\n  mode: review\nbackup:\n  fetch: false\njournal_template: j\n",
        )
        .unwrap();
        c.ai.embeddings = None;
        let text = serde_saphyr::to_string(&c).unwrap();
        for block in split(&text).unwrap().blocks {
            assert!(KNOWN.contains(&block.key.as_str()), "{}", block.key);
        }
    }

    #[test]
    fn an_old_number_that_is_now_a_string_is_replaced() {
        let mut c = config();
        c.name = "2024".into();
        let out = merge(
            "name: 2024\nformat: 1\n",
            &serde_saphyr::to_string(&c).unwrap(),
        );
        let back: Config = serde_saphyr::from_str(&out).unwrap();
        assert_eq!(back.name, "2024");
    }
}
