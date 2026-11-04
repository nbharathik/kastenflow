//! Lint in the browser. A page that draws the deck asks the engine what to
//! measure (`lintProbes`), lays those words out, and hands the sizes back with
//! the slide to lint; the report comes back as JSON.

use std::collections::BTreeMap;

use serde::Deserialize;
use slides_core::lint::{self, Measures, Options, Refs, estimate};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

use super::{SlidesEngine, fail, json};

/// The measures a page took, as JSON (`Measures`), or none.
fn measures_of(text: Option<String>) -> Result<Option<Measures>, JsValue> {
    text.filter(|t| !t.trim().is_empty())
        .map(|t| {
            serde_json::from_str(&t)
                .map_err(|e| fail(slides_core::Error::bad_input("lint measures", e)))
        })
        .transpose()
}

/// The keys of the bibliography, as a JSON array of strings, or none.
fn refs_of(text: Option<String>) -> Result<Option<Refs>, JsValue> {
    #[derive(Deserialize)]
    struct Keys(Vec<String>);
    text.filter(|t| !t.trim().is_empty())
        .map(|t| {
            serde_json::from_str::<Keys>(&t)
                .map(|keys| Refs::new(keys.0))
                .map_err(|e| fail(slides_core::Error::bad_input("lint references", e)))
        })
        .transpose()
}

#[wasm_bindgen]
impl SlidesEngine {
    /// The texts of a slide a page is asked to measure, as JSON (`Probe[]`), as the slide
    /// draws them: a citation is the work of the page's bibliography, not its key.
    #[wasm_bindgen(js_name = lintProbes)]
    pub fn lint_probes(&self, slide: &str) -> Result<String, JsValue> {
        let page = super::references::shared();
        lint::probes_with(self.inner.deck(), slide, page.as_deref())
            .map_err(fail)
            .and_then(|probes| json(&probes))
    }

    /// The sizes the engine works out for the texts of one slide, as JSON (`Measures`, marked
    /// as estimates), for a page that cannot lay the text out itself: it hands them to
    /// `lintSlide` as it would the sizes it took.
    #[wasm_bindgen(js_name = lintEstimate)]
    pub fn lint_estimate(&self, slide: &str) -> Result<String, JsValue> {
        let deck = self.inner.deck();
        let found = deck
            .slide(slide)
            .ok_or_else(|| fail(slides_core::Error::no_slide(slide)))?;
        let page = super::references::shared();
        let sizes = estimate::slide_measures_with(deck, found, page.as_deref());
        json(&Measures {
            slides: BTreeMap::from([(slide.to_owned(), sizes)]),
            estimated: true,
        })
    }

    /// The problems of one slide, as JSON (`Report`). `measures` is the sizes the page took
    /// for the slide's probes (`Measures`), and `refs` the bibliography's keys (a JSON array),
    /// or, left out, the bibliography the page gave with `setReferences`; a rule that needs
    /// what is not given is named in the report's `skipped`.
    #[wasm_bindgen(js_name = lintSlide)]
    pub fn lint_slide(
        &self,
        slide: &str,
        measures: Option<String>,
        refs: Option<String>,
    ) -> Result<String, JsValue> {
        let measures = measures_of(measures)?;
        let refs = refs_of(refs)?;
        let page = super::references::shared();
        let options = Options {
            measures: measures.as_ref(),
            refs: refs.as_ref().or(page.as_deref()),
        };
        lint::lint_slide_with(self.inner.deck(), slide, &options)
            .map_err(fail)
            .and_then(|report| json(&report))
    }

    /// The `off-brand-colour` problems of the deck for a brand of these colours (a JSON array of
    /// `#rrggbb` strings), as JSON (`Issue[]`). Not part of `lintDeck`: only a host with a brand kit asks.
    #[wasm_bindgen(js_name = lintBrand)]
    pub fn lint_brand(&self, colors: &str) -> Result<String, JsValue> {
        let colors: Vec<String> = serde_json::from_str(colors)
            .map_err(|e| fail(slides_core::Error::bad_input("brand colours", e)))?;
        json(&lint::off_brand(
            self.inner.deck(),
            &lint::Brand::new(colors),
        ))
    }

    /// The problems of every slide, as JSON (`Report`).
    #[wasm_bindgen(js_name = lintDeck)]
    pub fn lint_deck(
        &self,
        measures: Option<String>,
        refs: Option<String>,
    ) -> Result<String, JsValue> {
        let measures = measures_of(measures)?;
        let refs = refs_of(refs)?;
        let page = super::references::shared();
        let options = Options {
            measures: measures.as_ref(),
            refs: refs.as_ref().or(page.as_deref()),
        };
        json(&lint::lint_deck_with(self.inner.deck(), &options))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine_with_broken_slide() -> (SlidesEngine, String) {
        let mut engine = SlidesEngine::create("Deck", "Light", 3.0).unwrap();
        let added = engine.apply("add_slide", r#"{"layout":"blank"}"#).unwrap();
        let added: serde_json::Value = serde_json::from_str(&added).unwrap();
        let slide = added["output"]["slide"].as_str().unwrap().to_owned();
        let element = serde_json::json!({ "slide": slide, "elements": [
            { "type": "text", "id": "wide", "x": 800, "y": 100, "w": 400, "h": 60,
              "text": { "paragraphs": [{ "runs": [{ "t": "Off the edge" }] }] } }
        ] });
        engine.apply("add_elements", &element.to_string()).unwrap();
        (engine, slide)
    }

    #[test]
    fn lints_a_slide_and_says_what_it_could_not_check() {
        let (engine, slide) = engine_with_broken_slide();
        let report: serde_json::Value =
            serde_json::from_str(&engine.lint_slide(&slide, None, None).unwrap()).unwrap();
        let rules: Vec<&str> = report["issues"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["rule"].as_str().unwrap())
            .collect();
        assert_eq!(rules, ["off-slide"]);
        let skipped: Vec<&str> = report["skipped"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["rule"].as_str().unwrap())
            .collect();
        assert_eq!(skipped, ["text-overflow", "unresolved-citation"]);
    }

    #[test]
    fn measures_the_page_took_are_checked_against_the_boxes() {
        let (engine, slide) = engine_with_broken_slide();
        let probes: serde_json::Value =
            serde_json::from_str(&engine.lint_probes(&slide).unwrap()).unwrap();
        assert_eq!(probes[0]["id"], "wide");
        assert_eq!(probes[0]["areaWidth"], 400.0);
        let measures = serde_json::json!({ "slides": { slide.clone(): { "wide": {
            "textWidth": 80.0, "textHeight": 200.0 } } } });
        let report: serde_json::Value = serde_json::from_str(
            &engine
                .lint_slide(&slide, Some(measures.to_string()), Some("[]".to_owned()))
                .unwrap(),
        )
        .unwrap();
        let rules: Vec<&str> = report["issues"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["rule"].as_str().unwrap())
            .collect();
        assert_eq!(rules, ["text-overflow", "off-slide"]);
        assert_eq!(report["skipped"], serde_json::json!([]));
    }

    #[test]
    fn a_page_that_cannot_lay_text_out_hands_back_the_estimate_of_the_engine() {
        let (engine, slide) = engine_with_broken_slide();
        let estimate: serde_json::Value =
            serde_json::from_str(&engine.lint_estimate(&slide).unwrap()).unwrap();
        assert_eq!(estimate["estimated"], true);
        let size = |side: &str| estimate["slides"][&slide]["wide"][side].as_f64().unwrap();
        assert!(size("textWidth") > 0.0 && size("textHeight") > 0.0);

        // Lint takes it as it takes a measure, and no longer names the rule as one it could not check.
        let report: serde_json::Value = serde_json::from_str(
            &engine
                .lint_slide(&slide, Some(estimate.to_string()), Some("[]".to_owned()))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(report["issues"][0]["rule"], "off-slide");
        assert_eq!(report["skipped"], serde_json::json!([]));
    }

    #[test]
    fn what_is_measured_and_estimated_is_the_text_the_slide_draws_from_the_pages_bibliography() {
        let (mut engine, slide) = engine_with_broken_slide();
        let cite = serde_json::json!({ "slide": slide, "elements": [
            { "type": "citation", "id": "cite", "x": 64, "y": 480, "w": 700, "h": 30,
              "keys": ["vaswani2017attention"] }
        ] });
        engine.apply("add_elements", &cite.to_string()).unwrap();
        let words = |engine: &SlidesEngine| -> String {
            let probes: serde_json::Value =
                serde_json::from_str(&engine.lint_probes(&slide).unwrap()).unwrap();
            probes
                .as_array()
                .unwrap()
                .iter()
                .filter(|p| p["id"].as_str().is_some_and(|id| id.starts_with("cite")))
                .map(|p| p["parts"].to_string())
                .collect()
        };

        // Without a bibliography the slide draws the key.
        assert!(words(&engine).contains("vaswani2017attention"));

        super::super::references::set_references(Some(
            "@inproceedings{vaswani2017attention, title={Attention is all you need}, \
             author={Vaswani, Ashish and Shazeer, Noam}, \
             booktitle={Advances in Neural Information Processing Systems}, year={2017}}"
                .to_owned(),
        ));
        let known = words(&engine);
        assert!(
            known.contains("Vaswani and Shazeer, 2017 (NeurIPS)"),
            "{known}"
        );
        assert!(!known.contains("vaswani2017attention"), "{known}");
        let with: serde_json::Value =
            serde_json::from_str(&engine.lint_estimate(&slide).unwrap()).unwrap();
        super::super::references::set_references(None);
        let without: serde_json::Value =
            serde_json::from_str(&engine.lint_estimate(&slide).unwrap()).unwrap();
        assert_ne!(with, without, "the label is not the key");
    }

    #[test]
    fn a_deck_is_linted_whole() {
        let (engine, _) = engine_with_broken_slide();
        let report: serde_json::Value =
            serde_json::from_str(&engine.lint_deck(None, None).unwrap()).unwrap();
        // The empty subtitle of the title slide, and the element off the edge.
        assert!(report["issues"].as_array().unwrap().len() >= 2);
    }
}
