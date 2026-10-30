//! The order a person put a table's rows in: `order: [ids]` in the view's own
//! YAML in the tag file. One file, one commit, and only that view's line
//! changes.

use std::fs;

use kasten_core::agent::AgentOp;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};
use serde_json::json;

use crate::change_sets::open as open_with_session;
use crate::common::{NOW, TempVault, dev_vault};

const FILE: &str = "tags/task.yaml";
const HOUSE: &str = "# my tasks\nname: task\ncolor: green\nextra: {keep: [1, 2]}\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\nviews:\n  # the board\n  - {name: Board, type: kanban, group_by: status}\n  - {name: All, type: table, custom: {a: 1}, wrap: true}\n  - {name: Due, type: calendar, date: due}\nmore: 1\n";

fn open_with(yaml: &str) -> (TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    fs::write(t.vault.root().join(FILE), yaml).unwrap();
    k.commit_external().unwrap();
    k.reindex().unwrap();
    (t, k)
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

fn text(t: &TempVault) -> String {
    fs::read_to_string(t.vault.root().join(FILE)).unwrap()
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

fn order(k: &Kasten, tag: &str, view: &str, list: &[&str]) -> kasten_core::Result<()> {
    k.set_view_order(&Actor::Human, tag, view, &ids(list), NOW)
        .map(|_| ())
}

#[test]
fn only_that_views_line_changes_and_the_rest_of_the_file_is_as_written() {
    let (t, k) = open_with(HOUSE);
    let before = commits(&k);
    order(&k, "task", "All", &["01HAAA", "01HBBB"]).unwrap();
    let want = HOUSE.replace(
        "{name: All, type: table, custom: {a: 1}, wrap: true}",
        "{name: All, type: table, custom: {a: 1}, wrap: true, order: [01HAAA, 01HBBB]}",
    );
    assert_eq!(text(&t), want, "one line, byte for byte");
    assert_eq!(commits(&k), before + 1, "one commit");
    let last = &k.log(Some(FILE), 1).unwrap()[0];
    assert_eq!(last.summary, "order: #task All");
    let schema = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap();
    assert_eq!(schema.views[1]["order"], json!(["01HAAA", "01HBBB"]));
    assert_eq!(
        schema.views[1]["custom"],
        json!({"a": 1}),
        "unknown keys are kept"
    );
}

#[test]
fn the_view_is_found_by_its_name_ignoring_case_and_the_tag_with_or_without_a_hash() {
    let (t, k) = open_with(HOUSE);
    order(&k, "#Task", "  all ", &["01HAAA"]).unwrap();
    assert!(text(&t).contains("wrap: true, order: [01HAAA]}"));
}

#[test]
fn a_second_order_replaces_the_first_in_place_and_none_takes_it_away() {
    let (t, k) = open_with(HOUSE);
    order(&k, "task", "All", &["01HAAA", "01HBBB"]).unwrap();
    order(&k, "task", "All", &["01HBBB", "01HAAA", "01HCCC"]).unwrap();
    assert!(text(&t).contains("wrap: true, order: [01HBBB, 01HAAA, 01HCCC]}\n"));
    assert_eq!(text(&t).matches("order:").count(), 1);
    order(&k, "task", "All", &[]).unwrap();
    assert_eq!(text(&t), HOUSE, "back to the bytes it had");
}

#[test]
fn the_same_order_again_writes_nothing_and_commits_nothing() {
    let (t, k) = open_with(HOUSE);
    order(&k, "task", "All", &["01HAAA", "01HBBB"]).unwrap();
    let (file, before) = (text(&t), commits(&k));
    order(&k, "task", "All", &["01HAAA", "01HBBB"]).unwrap();
    order(&k, "task", "All", &["01HAAA", "01HBBB", "01HAAA"]).unwrap();
    assert_eq!((text(&t), commits(&k)), (file, before));
    // Nothing to take away either.
    order(&k, "task", "Board", &[]).unwrap();
    assert_eq!(commits(&k), before);
}

#[test]
fn ids_are_trimmed_and_a_repeat_counts_once() {
    let (t, k) = open_with(HOUSE);
    order(&k, "task", "Due", &[" 01HAAA ", "01HBBB", "01HAAA"]).unwrap();
    assert!(
        text(&t).contains("date: due, order: [01HAAA, 01HBBB]}"),
        "{}",
        text(&t)
    );
}

#[test]
fn ids_that_look_like_other_things_come_back_as_the_text_they_were() {
    let (t, k) = open_with(HOUSE);
    let odd = [
        "12345",
        "true",
        "null",
        "1e3",
        "a, b",
        "x: y",
        "#c",
        "[d]",
        "{e}",
        "-",
        "it's \"q\"",
        "ünï",
    ];
    order(&k, "task", "All", &odd).unwrap();
    let schema = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap();
    assert_eq!(schema.views[1]["order"], json!(odd), "{}", text(&t));
    // Only that line changed.
    let (before, after) = (HOUSE.lines().collect::<Vec<_>>(), text(&t));
    let after: Vec<&str> = after.lines().collect();
    assert_eq!(before.len(), after.len());
    let changed: Vec<usize> = (0..before.len())
        .filter(|&i| before[i] != after[i])
        .collect();
    assert_eq!(changed.len(), 1, "{changed:?}");
}

#[test]
fn a_view_written_over_several_lines_makes_the_views_be_written_again_and_the_rest_stays() {
    let yaml = "# mine\nname: task\nproperties:\n  - {key: status, type: text}\nviews:\n  - name: All\n    type: table\n  - {name: Due, type: calendar, date: due}\nmore: 1  # keep\n";
    let (t, k) = open_with(yaml);
    order(&k, "task", "All", &["01HAAA"]).unwrap();
    let after = text(&t);
    let (head, _) = yaml.split_once("views:").unwrap();
    assert!(after.starts_with(head), "{after}");
    assert!(after.ends_with("more: 1  # keep\n"), "{after}");
    assert!(
        after.contains("  - {name: All, type: table, order: [01HAAA]}\n"),
        "{after}"
    );
    assert!(
        after.contains("  - {name: Due, type: calendar, date: due}\n"),
        "{after}"
    );
}

#[test]
fn a_line_with_a_comment_after_it_is_not_edited_in_place_but_nothing_else_is_lost() {
    let yaml = "name: task\nviews:\n  - {name: All, type: table}  # the main one\n  - {name: Due, type: calendar, date: due}\n";
    let (t, k) = open_with(yaml);
    order(&k, "task", "All", &["01HAAA"]).unwrap();
    let schema = k
        .tag_schemas()
        .unwrap()
        .into_iter()
        .find(|s| s.name == "task")
        .unwrap();
    assert_eq!(schema.views.len(), 2);
    assert_eq!(schema.views[0]["order"], json!(["01HAAA"]));
    assert!(text(&t).starts_with("name: task\nviews:\n"));
}

#[test]
fn windows_line_ends_stay() {
    let crlf = HOUSE.replace('\n', "\r\n");
    let (t, k) = open_with(&crlf);
    order(&k, "task", "All", &["01HAAA"]).unwrap();
    let want = crlf.replace("wrap: true}\r\n", "wrap: true, order: [01HAAA]}\r\n");
    assert_eq!(text(&t), want);
}

#[test]
fn what_cannot_be_ordered_is_refused_and_nothing_is_written() {
    let (t, k) = open_with(HOUSE);
    let (file, before) = (text(&t), commits(&k));
    let why = |err: kasten_core::Error| err.to_string();
    let missing = why(order(&k, "task", "Nope", &["01HAAA"]).unwrap_err());
    assert!(
        missing.contains("no view called “Nope”") && missing.contains("“Board”"),
        "{missing}"
    );
    assert!(
        why(order(&k, "nothing", "All", &["x"]).unwrap_err())
            .contains("no schema for the tag “nothing”")
    );
    assert!(why(order(&k, "task", "All", &["x", " "]).unwrap_err()).contains("an id is empty"));
    assert!(why(order(&k, "task", "All", &["x\ny"]).unwrap_err()).contains("is not an id"));
    let many: Vec<String> = (0..5001).map(|n| format!("id{n}")).collect();
    let big = k.set_view_order(&Actor::Human, "task", "All", &many, NOW);
    assert!(big.unwrap_err().to_string().contains("at most 5000"));
    assert_eq!((text(&t), commits(&k)), (file, before));
}

#[test]
fn a_view_saved_with_an_order_that_is_not_a_list_of_ids_is_refused() {
    let (t, k) = open_with(HOUSE);
    let file = text(&t);
    for bad in [json!("x"), json!([1, 2]), json!({"a": 1})] {
        let views = [json!({"name": "All", "type": "table", "order": bad})];
        let why = k
            .set_tag_views(&Actor::Human, "task", &views, NOW)
            .unwrap_err()
            .to_string();
        assert!(
            why.contains("order setting that is not a list of ids"),
            "{why}"
        );
    }
    let good = [json!({"name": "All", "type": "table", "order": ["a", "b"]})];
    k.set_tag_views(&Actor::Human, "task", &good, NOW).unwrap();
    assert_ne!(text(&t), file);
}

#[test]
fn an_agent_orders_rows_like_any_ordinary_write_and_review_holds_it() {
    let (t, k, s) = open_with_session();
    fs::write(t.vault.root().join(FILE), HOUSE).unwrap();
    k.commit_external().unwrap();
    let op = AgentOp::SetViewOrder {
        tag: "task".into(),
        view: "All".into(),
        ids: ids(&["01HAAA"]),
    };
    // Balanced: made at once, one commit with the op named.
    let before = commits(&k);
    let Outcome::Done { result } = k.agent_run(&s, &op, NOW).unwrap() else {
        panic!("an ordinary write is made at once");
    };
    assert_eq!(result["order"], 1);
    assert_eq!(commits(&k), before + 1);
    assert_eq!(
        k.log(Some(FILE), 1).unwrap()[0].op.as_deref(),
        Some("set_view_order")
    );
    // A view that is not there is refused before anything waits.
    let bad = AgentOp::SetViewOrder {
        tag: "task".into(),
        view: "Nope".into(),
        ids: vec![],
    };
    assert!(
        k.agent_run(&s, &bad, NOW)
            .unwrap_err()
            .to_string()
            .contains("no view called")
    );
    // Review everything: it waits, and accepting makes it.
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Review),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
    let again = AgentOp::SetViewOrder {
        tag: "task".into(),
        view: "All".into(),
        ids: ids(&["01HBBB", "01HAAA"]),
    };
    let Outcome::PendingReview { proposal, .. } = k.agent_run(&s, &again, NOW).unwrap() else {
        panic!("review holds every change");
    };
    assert!(
        fs::read_to_string(t.vault.root().join(FILE))
            .unwrap()
            .contains("order: [01HAAA]}")
    );
    k.accept_proposal(&proposal, "me", NOW).unwrap();
    assert!(
        fs::read_to_string(t.vault.root().join(FILE))
            .unwrap()
            .contains("order: [01HBBB, 01HAAA]}")
    );
}
