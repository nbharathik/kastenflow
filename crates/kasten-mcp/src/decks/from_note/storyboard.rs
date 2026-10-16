//! The storyboard side of `deck_from_note`: `draft` answers the slides a note would make as a storyboard (a title, a point, the evidence and the
//! notes for each, with the section of the note it came from) without making anything, and `storyboard` makes the deck from entries the
//! caller has changed. The deck is made with the editor's own operation (`add_storyboard_slides`), so the slides remember the sections they came
//! from, and it is made in the vault in one write, like every deck this tool makes.

use serde_json::{Value, json};
use slides_core::agent::{Agent, Store, ToolError, ToolOutput, ToolResult};
use slides_core::ops::Engine;
use slides_core::page::{self, StoryEntry, StorySource};

use super::plan::{MOST_SLIDES, Source, picture_path};
use super::text::pictures_in;
use super::{KastenStore, summary};

/// The entries a note would make, as a storyboard, for the caller to change and hand back.
pub(super) fn draft(source: &Source, path: &str, split: u8) -> ToolResult {
    let note = source
        .read(path)
        .map_err(|e| ToolError::new(e.to_string()))?;
    let page = StorySource {
        page: path.to_owned(),
        id: note.meta.id.clone(),
        title: Some(note.meta.title.trim().to_owned()),
        section: None,
        markdown: note.text.clone(),
    };
    let entries = page::draft(&page, split);
    if entries.is_empty() {
        return Err(ToolError::new(
            "That note has nothing to put on slides: it has no headings and no words.",
        ));
    }
    Ok(ToolOutput::json(json!({
        "note": path,
        "title": note.meta.title.trim(),
        "slides": entries.len(),
        "entries": entries,
        "next": "Change the entries as you like (reorder, merge, drop, rewrite title, point, evidence, notes or layout; evidence is one Markdown block each) and call deck_from_note again with the same note and `storyboard` set to them. The slides then remember the sections they came from.",
    })))
}

/// The picture of an evidence block when it is one: `![alt](src)` or `![[name.png|alt]]` alone on its line.
fn picture_of(block: &str) -> Option<(String, String)> {
    let (found, rest) = pictures_in(block.trim());
    match found.as_slice() {
        [one] if rest.trim().is_empty() => Some((one.alt.clone(), one.src.clone())),
        _ => None,
    }
}

/// Points the pictures of an entry at the files they are in the vault, and drops (and says so) the ones that are not there.
fn resolve(source: &Source, note: &str, entry: &mut StoryEntry, warnings: &mut Vec<String>) {
    let title = entry.title.clone();
    entry.evidence = std::mem::take(&mut entry.evidence)
        .into_iter()
        .filter_map(|block| {
            let Some((alt, src)) = picture_of(&block) else {
                return Some(block);
            };
            // A picture from the web is reported by the operation, which knows a deck cannot keep it.
            if page::is_remote(&src) {
                return Some(block);
            }
            match picture_path(source, note, &src) {
                Some(path) => Some(format!("![{alt}]({path})")),
                None => {
                    warnings.push(format!(
                        "Left out the picture `{src}` of “{title}”: it is not a picture in the vault's assets/ folder."
                    ));
                    None
                }
            }
        })
        .collect();
}

/// Makes the deck of a storyboard and answers like the rest of the tool does.
pub(super) fn build(
    source: &Source,
    store: &mut KastenStore<'_>,
    path: &str,
    title: Option<&str>,
    theme: Option<&str>,
    entries: Vec<StoryEntry>,
) -> ToolResult {
    if entries.is_empty() {
        return Err(ToolError::new(
            "`storyboard` has no entries. Ask for the draft first (`draft`: true) and hand its entries back, changed or not.",
        ));
    }
    let note = source
        .read(path)
        .map_err(|e| ToolError::new(e.to_string()))?;
    let name = title
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| note.meta.title.trim())
        .to_owned();
    let mut warnings = Vec::new();
    let mut entries = entries;
    if entries.len() > MOST_SLIDES - 1 {
        warnings.push(format!(
            "The deck has room for {MOST_SLIDES} slides; the rest of the storyboard was left out."
        ));
        entries.truncate(MOST_SLIDES - 1);
    }
    for entry in &mut entries {
        resolve(source, path, entry, &mut warnings);
    }
    // The pictures that are on the slides: the ones in the vault (the web's are left out by the operation).
    let pictures = entries
        .iter()
        .flat_map(|e| &e.evidence)
        .filter(|block| picture_of(block).is_some_and(|(_, src)| !page::is_remote(&src)))
        .count();

    let mut engine = Engine::create(&name, theme.unwrap_or("Light"), seed())
        .map_err(|e| ToolError::new(e.to_string()))?;
    let applied = engine
        .apply("add_storyboard_slides", json!({ "entries": entries }))
        .map_err(|e| ToolError::new(e.to_string()))?;
    let omitted = applied.output["omitted"].clone();
    for item in omitted.as_array().into_iter().flatten() {
        if let Some(reason) = item["reason"].as_str() {
            warnings.push(reason.to_owned());
        }
    }
    let text =
        slides_core::canonical::write(engine.deck()).map_err(|e| ToolError::new(e.to_string()))?;

    // Made in the vault in one write.
    let saved = store.create(&name, &text)?;
    let report = Agent::new().call(store, "lint_deck", json!({ "deck": saved.name }))?;
    let slides = slides_core::canonical::parse(&saved.text).map_or(0, |d| d.slides.len());
    Ok(ToolOutput::json(json!({
        "deck": saved.name,
        "hash": saved.hash,
        "title": name,
        "from": [path],
        "slides": slides,
        "pictures": pictures,
        "cited": Vec::<String>::new(),
        "warnings": warnings,
        "omitted": omitted,
        "lint": summary(&report.data.unwrap_or(Value::Null)),
    })))
}

/// Where the ids of a new deck start.
fn seed() -> u64 {
    kasten_core::Instant::now().millis
}
