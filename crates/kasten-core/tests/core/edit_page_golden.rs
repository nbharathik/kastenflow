//! Golden cases for `edit_page`'s steps: `fixtures/roundtrip/edit_page/<case>/`
//! holds an `input.md`, the `steps.json`, and the `expected.md` the steps must
//! give byte for byte, or an `error.txt` with the words the refusal must hold.
//! A step may leave out the hash of a block: it is filled in from the input.
//! Every case runs twice, as stored and with Windows line ends.

use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::pages::{Kind, PageStep, blocks_of, edit_text};
use serde_json::Value;

struct Case {
    name: String,
    input: String,
    steps: Value,
    expected: Option<String>,
    error: Option<String>,
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/roundtrip/edit_page")
}

fn cases() -> Vec<Case> {
    let mut names: Vec<String> = fs::read_dir(root())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
        .into_iter()
        .map(|name| {
            let read = |file: &str| fs::read_to_string(root().join(&name).join(file)).ok();
            Case {
                input: read("input.md").unwrap_or_else(|| panic!("{name}: no input.md")),
                steps: serde_json::from_str(
                    &read("steps.json").unwrap_or_else(|| panic!("{name}: no steps.json")),
                )
                .unwrap_or_else(|e| panic!("{name}: steps.json: {e}")),
                expected: read("expected.md"),
                error: read("error.txt"),
                name,
            }
        })
        .collect()
}

fn crlf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\n', "\r\n")
}

/// Gives every `{"block": "bN"}` without a hash the hash of that block in `input`.
fn fill(value: &mut Value, input: &str) {
    match value {
        Value::Object(map) => {
            map.retain(|key, _| !key.starts_with('_'));
            if let Some(Value::String(id)) = map.get("block").cloned()
                && !map.contains_key("hash")
            {
                let n: usize = id.trim_start_matches('b').parse().unwrap();
                let hash = blocks_of(input)[n - 1].hash.clone();
                map.insert("hash".into(), Value::String(hash));
            }
            map.values_mut().for_each(|v| fill(v, input));
        }
        Value::Array(items) => items.iter_mut().for_each(|v| fill(v, input)),
        _ => {}
    }
}

fn steps_of(case: &Case, input: &str) -> Vec<PageStep> {
    let mut json = case.steps.clone();
    fill(&mut json, input);
    serde_json::from_value(json).unwrap_or_else(|e| panic!("{}: steps: {e}", case.name))
}

/// The ids the steps name.
fn named(case: &Case) -> Vec<usize> {
    let text = case.steps.to_string();
    let mut out = Vec::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("\"b") {
        let digits: String = rest[at + 2..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        if let Ok(n) = digits.parse() {
            out.push(n);
        }
        rest = &rest[at + 2..];
    }
    out
}

/// Every block the steps do not name (`named`: their numbers), and that holds
/// none that they do, is in the output with the same bytes, in the same order.
pub fn untouched_keep_bytes(input: &str, output: &str, named: &[usize]) -> Result<(), String> {
    let blocks = kasten_core::pages::Page::parse(kasten_core::frontmatter::split(input).body);
    let ranges: Vec<(usize, usize)> = named
        .iter()
        .filter_map(|n| blocks.blocks.get(n - 1))
        .map(|b| blocks.range_of(b))
        .collect();
    let out_body = kasten_core::frontmatter::split(output).body;
    let mut at = 0;
    for block in &blocks.blocks {
        let (start, end) = blocks.range_of(block);
        // A container's blocks are checked on their own.
        let container = matches!(block.kind, Kind::Toggle | Kind::Columns | Kind::Column);
        if container || ranges.iter().any(|&(s, e)| start < e && s < end) {
            continue;
        }
        let source = &blocks.body()[start..end];
        match out_body[at..].find(source) {
            Some(found) => at += found + source.len(),
            None => {
                return Err(format!(
                    "block {} ({source:?}) did not keep its bytes",
                    block.id
                ));
            }
        }
    }
    Ok(())
}

fn untouched_blocks_keep_their_bytes(case: &Case, input: &str, output: &str) -> Result<(), String> {
    untouched_keep_bytes(input, output, &named(case))
}

fn run(case: &Case, input: &str, expected: Option<&str>) -> Result<(), String> {
    let steps = steps_of(case, input);
    match (edit_text(input, &steps), expected, &case.error) {
        (Ok((out, _)), Some(want), _) => {
            if out != want {
                return Err(format!("gave {out:?}, wanted {want:?}"));
            }
            untouched_blocks_keep_their_bytes(case, input, &out)
        }
        (Err(err), None, Some(words)) => {
            if err.to_string().contains(words.trim()) {
                Ok(())
            } else {
                Err(format!("refused with {err:?}, wanted words {words:?}"))
            }
        }
        (Ok((out, _)), None, Some(words)) => {
            Err(format!("wanted a refusal ({words:?}), got {out:?}"))
        }
        (Err(err), Some(_), _) => Err(format!("refused: {err}")),
        _ => Err("a case needs an expected.md or an error.txt".to_owned()),
    }
}

#[test]
fn there_are_at_least_twenty_cases_and_some_refusals() {
    let all = cases();
    assert!(all.iter().filter(|c| c.expected.is_some()).count() >= 20);
    assert!(all.iter().filter(|c| c.error.is_some()).count() >= 5);
}

#[test]
fn every_case_gives_its_bytes_in_lf_and_with_windows_line_ends() {
    let mut failures = Vec::new();
    for case in cases() {
        if let Err(why) = run(&case, &case.input, case.expected.as_deref()) {
            failures.push(format!("{} (as stored): {why}", case.name));
        }
        let windows = crlf(&case.input);
        let want = case.expected.as_deref().map(crlf);
        if let Err(why) = run(&case, &windows, want.as_deref()) {
            failures.push(format!("{} (Windows line ends): {why}", case.name));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
