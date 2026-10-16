//! `deck_from_note`, the one deck tool only Kasten has: a deck from a note in
//! the vault, and from the notes it links to when asked.
//!
//! The note's headings become slides, with the note's list on the slide and
//! its prose in the speaker notes; its pictures become picture slides placed
//! at their own proportions; the citation keys it uses that the vault's `.bib`
//! files know become the footers of the slides. The deck is built in memory
//! with the tools an agent calls itself (`create_deck`, `place_image`,
//! `add_citation` in `update_elements`) and then made in the vault in one
//! write, so it is one commit in the caller's session, held to the same limits
//! as any other deck an agent makes, and one proposal when it has to wait for
//! review. Lint is run on the deck as it is in the vault.

mod body;
mod outline;
mod plan;
mod storyboard;
mod text;

use kasten_core::Kasten;
use serde::Deserialize;
use serde_json::{Value, json};
use slides_core::agent::{Agent, MemoryStore, Store, ToolError, ToolOutput, ToolResult, ToolSpec};
use slides_core::page::StoryEntry;

use super::store::KastenStore;
use crate::tools::locked;
use plan::{Plan, Source};

/// The arguments of the tool.
#[derive(Debug, Deserialize)]
struct Options {
    note: String,
    #[serde(default)]
    include_linked: bool,
    #[serde(default)]
    theme: Option<String>,
    #[serde(default)]
    title: Option<String>,
    /// Answer the slides the note would make as a storyboard, and make nothing.
    #[serde(default)]
    draft: bool,
    /// The heading level a storyboard is cut at (1 to 6); 0 or absent for the level that suits the note.
    #[serde(default)]
    split: u8,
    /// A storyboard, drafted and changed: the deck is made from it.
    #[serde(default)]
    storyboard: Option<Vec<StoryEntry>>,
}

/// The most problems the answer lists.
const MOST_PROBLEMS: usize = 8;

/// The tool as the server lists it.
pub(super) fn spec() -> ToolSpec {
    ToolSpec {
        name: "deck_from_note".to_owned(),
        description: "Makes a new deck from a note of the vault and returns where it is and what lint thinks of it. The note's headings become slides: the list under a heading is the slide, the note's prose under it becomes the speaker notes. Its pictures become picture slides placed at their own proportions, and the citation keys it uses ([@key], \\cite{key}) that the vault's .bib files know become the slide's footer, with a references slide at the end. `include_linked` also turns the notes it links to into sections. Layouts are chosen for what is on each slide. Use it to start a talk from what the person already wrote, then refine slide by slide with the other deck tools and lint after every batch; a note that has no headings gives one slide. Like create_deck it never replaces a deck, and it is held to the same limits and review. To plan the slides first, call it with `draft: true`: it makes nothing and answers the storyboard, one entry for each section of the note (title, point, evidence, notes, layout, and the section it came from); change the entries (reorder, merge, drop, rewrite) and call it again with `storyboard` set to them to make the deck, whose slides remember the sections they came from so the person can bring them up to date when the note changes.".to_owned(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "note": { "type": "string", "description": "The note to make the deck from: its title, its path (such as projects/talk/pages/plan.md) or its id." },
                "include_linked": { "type": "boolean", "description": "Also make sections of the notes it links to (the first six, a few slides each). Off by default." },
                "title": { "type": "string", "description": "The deck's title, if not the note's." },
                "theme": { "type": "string", "description": "Light (default), Dark, Serif, Lecture, Minimal, Bold, Modern, Academic, Pitch, Dark Studio or Warm Paper." },
                "project": { "type": "string", "description": "The project to make the deck in, as list_notes names a note's project (its folder under projects/). Without one the deck goes to the library." },
                "draft": { "type": "boolean", "description": "Only draft: answer the storyboard (the slides the note would make) and make no deck. Off by default." },
                "split": { "type": "integer", "minimum": 0, "maximum": 6, "description": "With `draft`: the heading level a slide starts at (1 to 6); 0 or left out for the level that suits the note." },
                "storyboard": {
                    "type": "array",
                    "description": "The entries of a draft, changed as you like, to make the deck from instead of the note's own headings.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string", "description": "The slide's title." },
                            "point": { "type": "string", "description": "The sentence the slide makes; it leads the slide's words." },
                            "evidence": { "type": "array", "items": { "type": "string" }, "description": "What backs the point up, one Markdown block each: a list item (nested ones indented by two spaces), a picture, a table, code." },
                            "notes": { "type": "string", "description": "What the speaker says, as Markdown." },
                            "layout": { "type": "string", "description": "title-body, title-only or section; left out lets the content choose." },
                            "sources": { "type": "array", "description": "The sections of the note it came from, as the draft gave them; leave them as they are.", "items": { "type": "object" } }
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["note"],
            "additionalProperties": false
        }),
        read_only: false,
    }
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// The report of `lint_deck` in a few numbers and the first problems.
fn summary(report: &Value) -> Value {
    let issues = report["issues"].as_array().cloned().unwrap_or_default();
    let count = |severity: &str| issues.iter().filter(|i| i["severity"] == severity).count();
    let listed: Vec<Value> = issues
        .iter()
        .filter(|i| i["severity"] != "info")
        .take(MOST_PROBLEMS)
        .map(|i| json!({ "slide": i["slide"], "element": i["element"], "rule": i["rule"], "severity": i["severity"], "message": i["message"], "hint": i["hint"] }))
        .collect();
    json!({
        "errors": count("error"),
        "warnings": count("warning"),
        "info": count("info"),
        "problems": listed,
        "skipped": report["skipped"],
    })
}

/// The batch that cites: a footer on every slide with keys, and a slide listing the works when any were cited.
fn citing(plan: &Plan, ids: &[String]) -> Vec<Value> {
    let mut operations: Vec<Value> = Vec::new();
    for (planned, id) in plan.slides.iter().zip(ids.iter().skip(1)) {
        if planned.keys.is_empty() {
            continue;
        }
        operations
            .push(json!({ "op": "add_citation", "input": { "slide": id, "keys": planned.keys } }));
    }
    if !operations.is_empty() {
        let n = operations.len() + 1;
        operations.push(json!({ "op": "add_slide", "input": { "layout": "title-only", "content": { "title": "References" } } }));
        operations.push(json!({ "op": "add_elements", "input": { "slide": format!("${n}.slide"), "elements": [
            { "type": "citation", "keys": [], "format": "list", "x": 64, "y": 140, "w": 832, "h": 340 }
        ] } }));
    }
    operations
}

/// Runs the tool for a connection. The deck is built in memory, with the tools an agent calls itself,
/// and then made in the vault in one piece: one write, one commit, and one proposal if it has to wait.
pub(super) fn run(kasten: &Kasten, store: &mut KastenStore<'_>, args: &Value) -> ToolResult {
    let options: Options = serde_json::from_value(args.clone())
        .map_err(|e| ToolError::new(format!("failed to read the arguments: {e}")))?;
    if options.note.trim().is_empty() {
        return Err(ToolError::new(
            "`note` names the note to make the deck from: its title, its path (such as projects/talk/pages/plan.md) or its id.",
        ));
    }
    // A chat that previews its changes makes the deck from the notes as they will be saved.
    let staged = store.stage.map(|set| locked(set).clone());
    let refs = store.references();
    let source = Source {
        kasten,
        refs: refs.as_ref(),
        staged: staged.as_ref(),
    };
    let path = source
        .resolve(&options.note)
        .map_err(|e| ToolError::new(e.to_string()))?;
    // A storyboard first (`draft`), or a deck made from one (`storyboard`).
    if options.draft {
        return storyboard::draft(&source, &path, options.split);
    }
    if let Some(entries) = options.storyboard {
        return storyboard::build(
            &source,
            store,
            &path,
            options.title.as_deref(),
            options.theme.as_deref(),
            entries,
        );
    }
    let mut plan = plan::of_deck(&source, &path, options.include_linked).map_err(ToolError::new)?;
    if let Some(title) = options.title.as_deref().filter(|t| !t.trim().is_empty()) {
        plan.title = title.trim().to_owned();
    }

    // The pictures the deck will show, where the tools can read them.
    let mut scratch = MemoryStore::new();
    let mut warnings = plan.warnings.clone();
    for planned in &mut plan.slides {
        let Some(picture) = &planned.picture else {
            continue;
        };
        match source.asset(&picture.src) {
            Ok(bytes) => {
                scratch.assets.insert(picture.src.clone(), bytes);
            }
            Err(error) => {
                warnings.push(format!("Left out the picture `{}`: {error}", picture.src));
                planned.picture = None;
                planned.layout = Some("section");
            }
        }
    }

    let mut agent = Agent::new();
    let mut make = json!({ "outline": outline::of(&plan), "title": plan.title });
    if let Some(theme) = &options.theme {
        make["theme"] = json!(theme);
    }
    let made = agent.call(&mut scratch, "create_deck", make)?;
    let data = made.data.unwrap_or(Value::Null);
    let name = data["deck"].as_str().unwrap_or_default().to_owned();
    let ids: Vec<String> = data["slides"]
        .as_array()
        .map(|slides| {
            slides
                .iter()
                .filter_map(|s| s["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    warnings.extend(strings(&data["warnings"]));

    // Pictures at their own proportions.
    let mut pictures = 0;
    for (planned, id) in plan.slides.iter().zip(ids.iter().skip(1)) {
        let Some(picture) = &planned.picture else {
            continue;
        };
        let placed = agent.call(
            &mut scratch,
            "place_image",
            json!({ "deck": name, "slide": id, "src": picture.src, "placeholder": "image", "alt": picture.alt }),
        );
        match placed {
            Ok(_) => pictures += 1,
            Err(error) => warnings.push(format!(
                "Could not place `{}`: {}",
                picture.src, error.message
            )),
        }
    }

    // Citations, and a slide that lists the works.
    let operations = citing(&plan, &ids);
    if !operations.is_empty() {
        let batch = agent.call(
            &mut scratch,
            "update_elements",
            json!({ "deck": name, "operations": operations }),
        );
        if let Err(error) = batch {
            warnings.push(format!("Could not add the citations: {}", error.message));
        }
    }
    let mut cited: Vec<String> = Vec::new();
    for key in plan.slides.iter().flat_map(|s| s.keys.iter()) {
        if !cited.contains(key) {
            cited.push(key.clone());
        }
    }

    // Made in the vault in one write.
    let text = scratch
        .decks
        .get(&name)
        .cloned()
        .ok_or_else(|| ToolError::new("The deck could not be built."))?;
    let saved = store.create(&plan.title, &text)?;
    let report = Agent::new().call(store, "lint_deck", json!({ "deck": saved.name }))?;
    let slides = slides_core::canonical::parse(&saved.text).map_or(ids.len(), |d| d.slides.len());
    Ok(ToolOutput::json(json!({
        "deck": saved.name,
        "hash": saved.hash,
        "title": plan.title,
        "from": plan.from,
        "slides": slides,
        "pictures": pictures,
        "cited": cited,
        "warnings": warnings,
        "lint": summary(&report.data.unwrap_or(Value::Null)),
    })))
}
