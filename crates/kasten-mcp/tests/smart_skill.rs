//! The smart pages skill, the kit reference resource `kasten://smart/kit` and
//! the three worked pages. Everything they say is held against the real kit
//! (the names it registers), the real tool list, and the real `smart_check`.

mod common;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use common::{Client, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::smart_kit;
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

const EXAMPLES: [&str; 3] = [
    "conference-tracker",
    "reading-dashboard",
    "project-status-board",
];
const FILES: [&str; 3] = ["smart.yaml", "index.html", "app.js"];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
        .replace("\r\n", "\n")
}

fn skill() -> String {
    read(&root().join("skills/kasten-smart-pages/SKILL.md"))
}

fn example(name: &str, file: &str) -> String {
    read(
        &root()
            .join("skills/kasten-smart-pages/examples")
            .join(name)
            .join(file),
    )
}

// ---- what the kit registers --------------------------------------------------------------

#[derive(Default)]
struct Kit {
    kasten: BTreeSet<String>,
    top: BTreeSet<String>,
    components: BTreeSet<String>,
    members: BTreeSet<(String, String)>,
}

fn ident(text: &str) -> &str {
    let end = text
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .unwrap_or(text.len());
    &text[..end]
}

/// Every place `word` starts a name on its own (not after a letter, a dot or a slash).
fn starts(text: &str, word: &str) -> Vec<usize> {
    text.match_indices(word)
        .map(|(i, _)| i)
        .filter(|&i| {
            text[..i]
                .chars()
                .next_back()
                .is_none_or(|c| !(c.is_ascii_alphanumeric() || "_./:-".contains(c)))
        })
        .collect()
}

fn kit_files() -> Vec<String> {
    let base = root().join("app/src/smart-kit");
    let mut files = vec![read(&base.join("kit.js"))];
    for folder in ["lib", "components"] {
        let mut names: Vec<PathBuf> = fs::read_dir(base.join(folder))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "js"))
            .collect();
        names.sort();
        files.extend(names.iter().map(|p| read(p)));
    }
    files
}

fn kit() -> Kit {
    let mut kit = Kit::default();
    for text in kit_files() {
        for at in starts(&text, "kit.") {
            let rest = &text[at + 4..];
            let name = ident(rest);
            let after = rest[name.len()..].trim_start();
            if name.is_empty() || !after.starts_with('=') || after.starts_with("==") {
                continue;
            }
            kit.top.insert(name.to_owned());
            if matches!(name, "dates" | "format" | "keys" | "charts")
                && let Some(open) = after.find('{')
                && let Some(close) = after[open..].find('}')
            {
                for member in after[open + 1..open + close].split(',') {
                    let member = ident(member.trim());
                    if !member.is_empty() {
                        kit.members.insert((name.to_owned(), member.to_owned()));
                    }
                }
            }
        }
        for part in text.split("defineComponent(\"").skip(1) {
            kit.components.insert(ident(part).to_owned());
        }
        for at in starts(&text, "api.") {
            let rest = &text[at + 4..];
            let name = ident(rest);
            if rest[name.len()..].trim_start().starts_with('=')
                && !rest[name.len()..].trim_start().starts_with("==")
            {
                kit.kasten.insert(name.to_owned());
            }
        }
        // The calls made from one list: `["query", "list", ...].forEach`.
        if let Some(end) = text.find("].forEach((k) =>") {
            let start = text[..end].rfind('[').unwrap();
            for quoted in text[start..end].split('"').skip(1).step_by(2) {
                kit.kasten.insert(quoted.to_owned());
            }
        }
    }
    kit.kasten.insert("call".to_owned());
    kit
}

/// The names `text` uses that the kit does not have: `kasten.X`, `kit.X`,
/// `kit.components.X` and `kit.dates|format|keys|charts.X`.
fn unknown_names(text: &str, kit: &Kit) -> BTreeSet<String> {
    let mut unknown = BTreeSet::new();
    for at in starts(text, "kasten.") {
        let name = ident(&text[at + 7..]);
        if !name.is_empty() && !matches!(name, "yaml") && !kit.kasten.contains(name) {
            unknown.insert(format!("kasten.{name}"));
        }
    }
    for at in starts(text, "kit.") {
        let rest = &text[at + 4..];
        let name = ident(rest);
        if name.is_empty() || matches!(name, "js" | "css") {
            continue;
        }
        let sub = rest[name.len()..]
            .strip_prefix('.')
            .map(ident)
            .filter(|s| !s.is_empty());
        let known = if !kit.top.contains(name) {
            false
        } else if name == "components" {
            sub.is_none_or(|s| kit.components.contains(s))
        } else if matches!(name, "dates" | "format" | "keys" | "charts") {
            sub.is_none_or(|s| kit.members.contains(&(name.to_owned(), s.to_owned())))
        } else {
            true
        };
        if !known {
            unknown.insert(match sub {
                Some(s) if name == "components" || kit.members.iter().any(|(g, _)| g == name) => {
                    format!("kit.{name}.{s}")
                }
                _ => format!("kit.{name}"),
            });
        }
    }
    unknown
}

fn fenced_code(text: &str) -> String {
    text.split("```")
        .skip(1)
        .step_by(2)
        .collect::<Vec<_>>()
        .join("\n")
}

// ---- tests -------------------------------------------------------------------------------

#[test]
fn the_name_check_sees_what_the_kit_has_and_catches_a_made_up_name() {
    let kit = kit();
    for name in [
        "query", "watch", "update", "addTags", "append", "toggle", "ready", "call",
    ] {
        assert!(kit.kasten.contains(name), "kasten.{name}");
    }
    for name in ["stat", "table", "kanban", "map", "countdown", "bar"] {
        assert!(kit.components.contains(name), "component {name}");
    }
    assert!(kit.top.contains("h") && kit.top.contains("defineComponent"));
    assert!(kit.members.contains(&("dates".into(), "daysUntil".into())));
    assert!(kit.members.contains(&("format".into(), "percent".into())));
    let said = "kasten.watch(), kit.components.stat, kit.dates.isoDate, kasten.fetchAll(), \
                kit.components.cloud, kit.dates.tomorrow, kit.paint(), kit.format.percent, \
                see smart://kit/1/kit.js";
    let unknown: Vec<String> = unknown_names(said, &kit).into_iter().collect();
    assert_eq!(
        unknown,
        [
            "kasten.fetchAll",
            "kit.components.cloud",
            "kit.dates.tomorrow",
            "kit.paint"
        ]
    );
}

#[test]
fn the_skill_is_there_and_says_what_to_do_in_plain_words() {
    let skill = skill();
    assert!(skill.starts_with("---\nname: kasten-smart-pages\ndescription: "));
    let front = &skill[4..skill.find("\n---\n").unwrap()];
    let description = front.lines().nth(1).unwrap();
    assert!(
        description.len() > 120 && description.len() < 1024,
        "{description}"
    );
    for needle in [
        "kasten://smart/kit",
        "`smart_create`",
        "`smart_check`",
        "`smart_read`",
        "`smart_edit`",
        "`smart_write_file`",
        "no network",
        "notes",
        "examples/conference-tracker",
        "examples/reading-dashboard",
        "examples/project-status-board",
    ] {
        assert!(skill.contains(needle), "{needle}");
    }
    for private in ["dev/", "ADR", "decisions/", "milestone"] {
        assert!(!skill.contains(private), "{private}");
    }
    assert!(skill.split_whitespace().count() < 1800);
}

#[test]
fn every_tool_the_skill_names_exists() {
    let tools: BTreeSet<String> = specs().into_iter().map(|s| s.name).collect();
    // Words that are fields of a tool or of a page, not tools.
    let fields = [
        "base_hash",
        "paper_deadline",
        "abstract_deadline",
        "smart_yaml",
    ];
    let skill = skill();
    let named: BTreeSet<&str> = skill
        .split('`')
        .skip(1)
        .step_by(2)
        .filter(|w| w.contains('_') && w.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
        .collect();
    assert!(named.contains("smart_create") && named.contains("smart_check"));
    for word in named {
        assert!(
            tools.contains(word) || fields.contains(&word),
            "`{word}` is not a tool"
        );
    }
    // The tools it relies on are all listed.
    for tool in [
        "smart_create",
        "smart_read",
        "smart_edit",
        "smart_write_file",
        "smart_check",
        "query_tag",
        "update_tag_schema",
        "create_note",
        "batch",
    ] {
        assert!(tools.contains(tool), "{tool}");
    }
}

#[test]
fn every_kit_name_in_the_skill_the_examples_and_the_reference_exists() {
    let kit = kit();
    let mut texts: Vec<(String, String)> = vec![
        ("the skill".into(), skill()),
        ("the reference".into(), smart_kit::reference().to_owned()),
    ];
    let kasten_skill = read(&root().join("skills/kasten/SKILL.md"));
    let from = kasten_skill.find("## Smart pages").unwrap();
    let section = &kasten_skill[from..];
    texts.push((
        "the kasten skill".into(),
        section[..section[3..].find("\n## ").map_or(section.len(), |i| i + 3)].to_owned(),
    ));
    for name in EXAMPLES {
        for file in FILES {
            texts.push((format!("{name}/{file}"), example(name, file)));
        }
    }
    for (what, text) in texts {
        let unknown = unknown_names(&text, &kit);
        assert!(
            unknown.is_empty(),
            "{what} uses names the kit lacks: {unknown:?}"
        );
    }
    // And the code in the skill is not only prose: it uses the kit.
    assert!(skill().contains("kasten.watch("));
    assert!(!fenced_code(&skill()).is_empty());
}

#[test]
fn the_reference_holds_every_documented_component_and_the_three_pages() {
    let docs = root().join("app/src/smart-kit/docs");
    let mut documented: BTreeSet<String> = BTreeSet::new();
    let reference = smart_kit::reference();
    let kit = kit();
    for entry in fs::read_dir(&docs).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "md") {
            continue;
        }
        let name = path.file_stem().unwrap().to_str().unwrap().to_owned();
        let text = read(&path);
        assert!(
            reference.contains(text.trim()),
            "the reference lacks the documentation of {name}"
        );
        if name != "kit" {
            assert!(
                kit.components.contains(&name),
                "{name} is documented but the kit does not register it"
            );
        }
        documented.insert(name);
    }
    let said: BTreeSet<String> = smart_kit::documented()
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    assert_eq!(said, documented, "the resource and the docs folder differ");
    // Every component the kit registers is documented (and so in the reference).
    for component in &kit.components {
        assert!(
            documented.contains(component),
            "{component} has no documentation"
        );
    }
    for name in EXAMPLES {
        for file in FILES {
            assert!(
                reference.contains(example(name, file).trim_end()),
                "{name}/{file}"
            );
        }
    }
    for heading in [
        "Conference tracker",
        "Reading dashboard",
        "Project status board",
    ] {
        assert!(reference.contains(&format!("## {heading}")), "{heading}");
    }
    assert!(reference.contains("pending_review"));
    for private in ["dev/", "ADR", "decisions/"] {
        assert!(!reference.contains(private), "{private}");
    }
}

#[test]
fn the_conference_tracker_example_is_the_atlas_page_of_the_fixture() {
    let atlas = root().join("fixtures/smart/projects/research/pages/conference-tracker.smart");
    for file in FILES {
        assert_eq!(
            example("conference-tracker", file),
            read(&atlas.join(file)),
            "{file} differs from the fixture page"
        );
    }
}

#[test]
fn the_examples_keep_their_data_in_notes() {
    for name in EXAMPLES {
        let app = example(name, "app.js");
        assert!(app.contains("kasten.watch("), "{name} reads live notes");
        for file in FILES {
            let text = example(name, file);
            for forbidden in [
                "http://",
                "https://",
                "fetch(",
                "XMLHttpRequest",
                "WebSocket",
            ] {
                assert!(!text.contains(forbidden), "{name}/{file}: {forbidden}");
            }
        }
        // No record written into the code: places and dates come out of a note's properties.
        for line in app
            .lines()
            .filter(|l| l.contains("lat:") || l.contains("deadline: \""))
        {
            assert!(line.contains("prop("), "{name}: data in code: {line}");
        }
    }
}

fn findings(k: &Kasten, s: &Session, page: &str) -> Vec<Value> {
    call(k, s, "smart_check", json!({"page": page})).unwrap()["findings"]
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn each_example_page_passes_smart_check() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("claude-code", Instant::now());
    for name in EXAMPLES {
        let files: Vec<Value> = FILES
            .iter()
            .map(|f| json!({"path": f, "content": example(name, f)}))
            .collect();
        let title = example(name, "smart.yaml")
            .lines()
            .find_map(|l| l.strip_prefix("title: "))
            .unwrap()
            .to_owned();
        let made = call(
            &k,
            &s,
            "smart_create",
            json!({"title": title, "files": files}),
        )
        .unwrap();
        assert_eq!(made["status"], json!("done"), "{name}: {made}");
        let page = made["result"]["page"].as_str().unwrap();
        let found = findings(&k, &s, page);
        // The dev vault has no notes with these tags yet, which is a warning, never an error.
        let bad: Vec<&Value> = found
            .iter()
            .filter(|f| {
                f["severity"] != json!("warning")
                    || !f["message"].as_str().unwrap().contains("no note has yet")
            })
            .collect();
        assert!(bad.is_empty(), "{name}: {bad:?}");
        let read = call(&k, &s, "smart_read", json!({"page": page})).unwrap();
        assert!(read["files"].as_array().unwrap().len() >= 3, "{name}");
    }
}

#[test]
fn the_reference_is_a_listed_resource_and_reads_back_whole() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    let list = c.request("resources/list", json!({}));
    let found = list["resources"]
        .as_array()
        .unwrap_or_else(|| panic!("{list}"))
        .iter()
        .find(|r| r["uri"] == json!(smart_kit::URI))
        .unwrap_or_else(|| panic!("not listed: {list}"));
    assert_eq!(found["name"], json!(smart_kit::NAME));
    assert_eq!(found["mimeType"], json!("text/markdown"));
    assert!(
        found["description"]
            .as_str()
            .unwrap()
            .contains("three finished pages")
    );
    let got = c.request("resources/read", json!({"uri": smart_kit::URI}));
    let item = &got["contents"][0];
    assert_eq!(item["uri"], json!(smart_kit::URI), "{got}");
    assert_eq!(item["mimeType"], json!("text/markdown"));
    assert_eq!(item["text"].as_str().unwrap(), smart_kit::reference());
    // Anything else is refused with a plain error, not an empty page.
    let other = c.request("resources/read", json!({"uri": "kasten://smart/nothing"}));
    assert!(other.get("contents").is_none(), "{other}");
    assert!(
        other.get("code").is_some() || other.get("message").is_some(),
        "{other}"
    );
}

#[test]
fn the_server_still_tells_agents_when_to_make_a_smart_page() {
    let v = vault();
    let c = Client::start(&v.0, "claude-code");
    for needle in [
        "When to make a smart page",
        "kasten://smart/kit",
        "The page has no network",
    ] {
        assert!(c.instructions.contains(needle), "{needle}");
    }
}
