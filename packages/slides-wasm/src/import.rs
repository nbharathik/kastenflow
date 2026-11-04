//! Reading a PowerPoint file in the browser: the deck and pictures it holds, the runs of slides
//! that repeat each other, and how an imported deck is put into the deck being edited.

use serde::Deserialize;
use slides_core::{Deck, canonical};
use slides_pptx::import::{ImportOptions, Mode, import, plan_import, similar_runs};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

use crate::{fail, json};

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Options {
    /// Starts the ids of everything the import makes.
    seed: Option<f64>,
    /// The deck's title as the person asked for it: it wins over anything in the file.
    title: Option<String>,
    /// What to call the deck when the file gives no title of its own (the file's name).
    name: Option<String>,
    /// Keep the marker each slide's notes carried, which a new version is matched by.
    markers: Option<bool>,
}

/// An imported file: the deck as `.deck` text, the pictures it names and what the import said.
#[wasm_bindgen]
pub struct ImportedFile {
    title: String,
    deck: String,
    names: String,
    bytes: Vec<u8>,
    lengths: Vec<u32>,
    report: String,
}

#[wasm_bindgen]
impl ImportedFile {
    /// The deck's title: the one asked for, else the file's own, else its name.
    #[wasm_bindgen(getter)]
    pub fn title(&self) -> String {
        self.title.clone()
    }

    /// The text of the `.deck` file.
    #[wasm_bindgen(getter)]
    pub fn deck(&self) -> String {
        self.deck.clone()
    }

    /// The paths of the pictures the deck names (`assets/...`), as a JSON array.
    #[wasm_bindgen(getter)]
    pub fn names(&self) -> String {
        self.names.clone()
    }

    /// The pictures one after another, in the order of `names`.
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }

    /// How long each picture is.
    #[wasm_bindgen(getter)]
    pub fn lengths(&self) -> Vec<u32> {
        self.lengths.clone()
    }

    /// `{"slides", "hidden", "pictures", "raw": [...], "warnings": [...]}` as JSON text.
    #[wasm_bindgen(getter)]
    pub fn report(&self) -> String {
        self.report.clone()
    }
}

/// Reads a `.pptx` file. `options` is JSON: `{"seed": 7, "title": "Talk", "markers": true}`.
#[wasm_bindgen(js_name = importPptx)]
pub fn import_pptx(bytes: &[u8], options: &str) -> Result<ImportedFile, JsValue> {
    let options: Options = serde_json::from_str(options)
        .map_err(|e| fail(slides_core::Error::bad_input("import", e)))?;
    let defaults = ImportOptions::default();
    let imported = import(
        bytes,
        &ImportOptions {
            seed: options.seed.map_or(defaults.seed, |s| s as u64),
            title: options.title,
            name: options.name,
            markers: options.markers.unwrap_or(defaults.markers),
            // The editor draws and edits charts, and exports them as charts PowerPoint can edit.
            native_charts: true,
            ..defaults
        },
    )
    .map_err(|e| fail(slides_core::Error::invalid(e.to_string())))?;
    let report = &imported.report;
    let report = serde_json::json!({
        "slides": report.slides,
        "hidden": report.hidden,
        "pictures": report.pictures,
        "raw": report.raw.iter().map(|r| serde_json::json!({ "slide": r.slide, "element": r.element, "original": r.original })).collect::<Vec<_>>(),
        "warnings": report.warnings.iter().map(|w| serde_json::json!({ "slide": w.slide, "element": w.element, "message": w.message })).collect::<Vec<_>>(),
    });
    let mut all = Vec::new();
    let mut lengths = Vec::with_capacity(imported.media.len());
    for file in &imported.media {
        all.extend_from_slice(&file.bytes);
        lengths.push(u32::try_from(file.bytes.len()).unwrap_or(u32::MAX));
    }
    let names: Vec<&str> = imported.media.iter().map(|m| m.path.as_str()).collect();
    Ok(ImportedFile {
        title: imported.deck.title.clone(),
        deck: canonical::write(&imported.deck).map_err(fail)?,
        names: json(&names)?,
        bytes: all,
        lengths,
        report: report.to_string(),
    })
}

fn parse(text: &str, what: &str) -> Result<Deck, JsValue> {
    canonical::parse(text).map_err(|e| fail(slides_core::Error::bad_input(what, e)))
}

/// Runs of slides that follow each other and are builds of one another (see
/// `slides_core::ops::similar_runs`), as a JSON array of arrays of places in the deck.
#[wasm_bindgen(js_name = similarRuns)]
pub fn similar_runs_of(deck: &str) -> Result<String, JsValue> {
    json(&similar_runs(&parse(deck, "similar_runs")?))
}

/// How to put an imported deck into the deck being edited. `mode` is `add`, `replace` or `merge`;
/// `after` (for `add`) names the slide the new ones go after. Returns
/// `{"operations": [[name, input], ...], "slides": [ids], "notes": [...]}` as JSON text: the
/// operations to apply together, the ids the imported slides have afterwards and what to tell the person.
#[wasm_bindgen(js_name = planImport)]
pub fn plan(
    existing: &str,
    imported: &str,
    mode: &str,
    after: Option<String>,
) -> Result<String, JsValue> {
    let mode = match mode {
        "add" => Mode::Add { after },
        "replace" => Mode::Replace,
        "merge" => Mode::Merge,
        other => {
            return Err(fail(slides_core::Error::bad_input(
                "plan_import",
                format!("the mode is `add`, `replace` or `merge`, not `{other}`"),
            )));
        }
    };
    let plan = plan_import(
        &parse(existing, "plan_import")?,
        parse(imported, "plan_import")?,
        &mode,
    );
    json(&serde_json::json!({
        "operations": plan.operations,
        "slides": plan.slides,
        "notes": plan.notes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SlidesEngine;

    fn exported() -> Vec<u8> {
        let mut engine = SlidesEngine::create("Talk", "Light", 3.0).unwrap();
        for title in ["One", "Two"] {
            engine
                .apply(
                    "add_slide",
                    &format!(
                        r#"{{"layout":"title-body","content":{{"title":"{title}","body":"- a"}}}}"#
                    ),
                )
                .unwrap();
        }
        engine.export_pptx("{}", "[]", &[], &[]).unwrap().bytes()
    }

    #[test]
    fn a_pptx_comes_back_as_deck_text_pictures_and_a_report() {
        let file = import_pptx(&exported(), r#"{"seed": 5, "title": "From a file"}"#).unwrap();
        let deck = canonical::parse(&file.deck()).unwrap();
        assert_eq!(deck.slides.len(), 3);
        assert_eq!(file.title(), "From a file", "the title asked for wins");
        assert_eq!(deck.title, file.title());
        assert_eq!(file.names(), "[]");
        assert!(file.lengths().is_empty() && file.bytes().is_empty());
        let report: serde_json::Value = serde_json::from_str(&file.report()).unwrap();
        assert_eq!(report["slides"], 3);
        assert_eq!(report["warnings"], serde_json::json!([]));
    }

    #[test]
    fn a_plan_names_the_operations_and_the_slides_they_make() {
        let file = import_pptx(&exported(), "{}").unwrap();
        let mut engine = SlidesEngine::create("Mine", "Serif", 9.0).unwrap();
        let existing = engine.save().unwrap();
        for mode in ["add", "replace", "merge"] {
            let plan: serde_json::Value =
                serde_json::from_str(&plan_for(&existing, &file.deck(), mode)).unwrap();
            let operations = plan["operations"].as_array().unwrap();
            assert_eq!(operations.len(), 1, "{mode}");
            let batch = serde_json::to_string(&plan["operations"]).unwrap();
            engine.apply_batch(&batch).unwrap();
            let ids = plan["slides"].as_array().unwrap();
            assert_eq!(ids.len(), 3, "{mode}");
            assert!(engine.undo().unwrap().is_some(), "{mode} is one step");
            assert_eq!(engine.save().unwrap(), existing, "{mode}");
        }
    }

    fn plan_for(existing: &str, imported: &str, mode: &str) -> String {
        plan(existing, imported, mode, None).unwrap()
    }

    #[test]
    fn runs_of_similar_slides_are_found_in_deck_text() {
        let engine = SlidesEngine::create("Talk", "Light", 4.0).unwrap();
        assert_eq!(similar_runs_of(&engine.save().unwrap()).unwrap(), "[]");
    }
}
