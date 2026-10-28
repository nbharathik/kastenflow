//! The table that says which editor actions have a tool (`agent-parity.ts` in the app's page editor, checked
//! against the menus by a test there) names only tools that exist, and the table is not empty.

use std::collections::BTreeSet;

use kasten_mcp::tools::specs;

const TABLE: &str = include_str!("../../../app/src/features/pages/editor/agent-parity.ts");

/// Every `"tool exists: a, b; note"` value: the tool names before the semicolon.
fn named() -> Vec<(String, String)> {
    let mut found = Vec::new();
    for line in TABLE.lines().filter(|l| !l.trim_start().starts_with("//")) {
        let Some(at) = line.find("tool exists: ") else {
            continue;
        };
        let after = &line[at + "tool exists: ".len()..];
        let Some(end) = after.find('"') else { continue };
        let value = &after[..end];
        let names = value.split(';').next().unwrap_or_default();
        for name in names.split(", ") {
            found.push((name.trim().to_owned(), line.trim().to_owned()));
        }
    }
    found
}

#[test]
fn every_tool_the_editor_table_names_is_a_real_tool() {
    let real: BTreeSet<String> = specs().into_iter().map(|s| s.name).collect();
    let named = named();
    assert!(
        named.len() > 100,
        "{} names: the table was not read",
        named.len()
    );
    let unknown: Vec<&(String, String)> = named
        .iter()
        .filter(|(name, _)| !real.contains(name))
        .collect();
    assert!(unknown.is_empty(), "not tools: {unknown:?}");
}

#[test]
fn the_table_names_the_tools_the_audit_added_and_keeps_its_open_gaps_in_view() {
    let names: BTreeSet<String> = named().into_iter().map(|(name, _)| name).collect();
    for tool in ["edit_page", "board_edit", "set_note_meta", "update_props"] {
        assert!(names.contains(tool), "{tool}");
    }
    // The gaps are a short list the next release reads before it ships.
    let gaps = TABLE
        .lines()
        .filter(|l| !l.trim_start().starts_with("//") && l.contains("\"gap: "))
        .count();
    assert!(
        (1..=4).contains(&gaps),
        "{gaps} gaps: write them up before adding more"
    );
}
