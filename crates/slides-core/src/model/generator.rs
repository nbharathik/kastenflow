//! A code picture: a picture element that keeps the program that draws it. The deck stores the code,
//! its language, what it may read and when it last ran, in the picture's `generator` field, and the
//! picture it drew sits in the host's image store as any picture does, so a PowerPoint or PDF export
//! and an older build see an ordinary picture. The field is one the element lists nowhere (it is kept
//! in the element's `extra`, as `x-diagram` is), so every build keeps it and no format version changes;
//! [`ImageEl::generator`] reads it and [`ImageEl::set_generator`] writes it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Extra, ImageEl};

/// The field of an image element that holds its [`PictureGenerator`].
pub const GENERATOR_KEY: &str = "generator";
/// The only language there is for now.
pub const LANGUAGE_JS: &str = "js";
/// The longest code a picture keeps (the host refuses to run more).
pub const MAX_CODE_BYTES: usize = 128 * 1024;
/// The most inputs a picture may declare.
pub const MAX_INPUTS: usize = 16;

fn js() -> String {
    LANGUAGE_JS.to_owned()
}

model! {
    /// What the code makes: an SVG picture, or the same drawing as a PNG.
    #[derive(Copy, Eq, Default)]
    #[serde(rename_all = "camelCase")]
    pub enum GeneratorOutput {
        #[default]
        Svg,
        Png,
    }

    /// Where an input comes from: a file in the host's image store (a CSV), a page of the host, or the text itself.
    #[serde(rename_all = "camelCase")]
    pub enum GeneratorInputKind {
        Asset,
        Note,
        Data,
    }

    /// Something the code may read, by the name it reads it with (`inputs.sales`). Read-only.
    #[serde(rename_all = "camelCase")]
    pub struct GeneratorInput {
        pub name: String,
        pub kind: GeneratorInputKind,
        pub value: String,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The last time the code ran: a hash of the code and everything it read, and when.
    #[serde(rename_all = "camelCase")]
    pub struct GeneratorRun {
        pub hash: String,
        pub at: u64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// The program behind a picture, kept inside the deck.
    #[serde(rename_all = "camelCase")]
    pub struct PictureGenerator {
        #[serde(default = "js")]
        pub language: String,
        pub code: String,
        #[serde(default)]
        pub inputs: Vec<GeneratorInput>,
        #[serde(default)]
        pub output: GeneratorOutput,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub last_run: Option<GeneratorRun>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub made_by: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl PictureGenerator {
    /// A new program with no inputs, never run.
    pub fn new(code: impl Into<String>, output: GeneratorOutput) -> PictureGenerator {
        PictureGenerator {
            language: js(),
            code: code.into(),
            inputs: Vec::new(),
            output,
            last_run: None,
            made_by: None,
            extra: Extra::new(),
        }
    }

    /// What is wrong with the block, said as what to change; None when it is fine to run.
    pub fn problem(&self) -> Option<String> {
        if self.language != LANGUAGE_JS {
            return Some(format!(
                "Code pictures are written in JavaScript (\"{LANGUAGE_JS}\"), not \"{}\".",
                self.language.chars().take(20).collect::<String>()
            ));
        }
        if self.code.trim().is_empty() {
            return Some("The code is empty.".to_owned());
        }
        if self.code.len() > MAX_CODE_BYTES {
            return Some(format!(
                "The code is longer than {} KB.",
                MAX_CODE_BYTES / 1024
            ));
        }
        if self.inputs.len() > MAX_INPUTS {
            return Some(format!("A picture may have at most {MAX_INPUTS} inputs."));
        }
        for (i, input) in self.inputs.iter().enumerate() {
            let plain = input
                .name
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && input.name.len() <= 40
                && input
                    .name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !plain {
                return Some(format!(
                    "\"{}\" cannot name an input: use letters, digits and _, starting with a letter.",
                    input.name.chars().take(20).collect::<String>()
                ));
            }
            if self.inputs[..i]
                .iter()
                .any(|other| other.name == input.name)
            {
                return Some(format!("Two inputs are called {}.", input.name));
            }
        }
        None
    }
}

/// A short name for what the code and everything it read were: the same text always has the same hash.
pub fn run_hash(code: &str, inputs_hash: &str, output: GeneratorOutput) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let word = match output {
        GeneratorOutput::Svg => "svg",
        GeneratorOutput::Png => "png",
    };
    for byte in code
        .bytes()
        .chain([0])
        .chain(inputs_hash.bytes())
        .chain([0])
        .chain(word.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

impl ImageEl {
    /// The program behind this picture, when it has one. A block that is not one (written by hand, or
    /// by a newer build in a way this one cannot read) counts as none and is left as it is.
    pub fn generator(&self) -> Option<PictureGenerator> {
        serde_json::from_value(self.extra.get(GENERATOR_KEY)?.clone()).ok()
    }

    /// Gives the picture a program, or takes it away (the picture stays).
    pub fn set_generator(&mut self, generator: Option<&PictureGenerator>) {
        match generator.and_then(|g| serde_json::to_value(g).ok()) {
            Some(value) => {
                self.extra.insert(GENERATOR_KEY.to_owned(), value);
            }
            None => {
                self.extra.remove(GENERATOR_KEY);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Element;
    use serde_json::{Value, json};

    fn image(extra: Value) -> Value {
        let mut value = json!({ "type": "image", "id": "e-1", "x": 10.0, "y": 20.0, "w": 300.0, "h": 200.0, "src": "assets/chart.svg", "alt": "A chart" });
        if let (Some(target), Value::Object(more)) = (value.as_object_mut(), extra) {
            target.extend(more);
        }
        value
    }

    fn parsed(value: &Value) -> ImageEl {
        match serde_json::from_value::<Element>(value.clone()).unwrap() {
            Element::Image(image) => image,
            other => panic!("expected an image, got {other:?}"),
        }
    }

    #[test]
    fn a_picture_with_a_program_reads_it_and_writes_it_back_as_it_was() {
        let block = json!({
            "language": "js",
            "code": "return kit.svg(100, 50);",
            "inputs": [{ "name": "sales", "kind": "asset", "value": "assets/sales.csv", "x-note": 1 }],
            "output": "svg",
            "lastRun": { "hash": "00ff00ff00ff00ff", "at": 1_762_000_000_000u64 },
            "madeBy": "agent:claude-code",
            "x-future": { "keep": [1, 2] },
        });
        let value = image(json!({ "generator": block }));
        let element = parsed(&value);
        let generator = element.generator().expect("the block is read");
        assert_eq!(generator.language, "js");
        assert_eq!(generator.inputs[0].kind, GeneratorInputKind::Asset);
        assert_eq!(
            generator.last_run.as_ref().map(|r| r.at),
            Some(1_762_000_000_000)
        );
        assert_eq!(generator.made_by.as_deref(), Some("agent:claude-code"));
        // Writing the element out gives the JSON that was read, every unknown field included.
        assert_eq!(
            serde_json::to_value(Element::Image(element)).unwrap(),
            value
        );
    }

    #[test]
    fn an_old_picture_has_no_program_and_stays_as_it_was() {
        let value = image(json!({}));
        let element = parsed(&value);
        assert_eq!(element.generator(), None);
        assert!(!element.extra.contains_key(GENERATOR_KEY));
        assert_eq!(
            serde_json::to_value(Element::Image(element)).unwrap(),
            value
        );
    }

    #[test]
    fn a_block_that_leaves_things_out_takes_the_defaults() {
        let value = image(json!({ "generator": { "code": "return 1" } }));
        let generator = parsed(&value).generator().unwrap();
        assert_eq!(generator.language, "js");
        assert_eq!(generator.output, GeneratorOutput::Svg);
        assert!(
            generator.inputs.is_empty()
                && generator.last_run.is_none()
                && generator.made_by.is_none()
        );
        // Written out, only what was there comes back with the defaults the type has.
        let written = serde_json::to_value(&generator).unwrap();
        assert!(written.get("lastRun").is_none() && written.get("madeBy").is_none());
        assert_eq!(written["output"], "svg");
    }

    #[test]
    fn a_block_that_is_not_one_counts_as_none_and_is_left_alone() {
        for bad in [
            json!("code"),
            json!({ "language": "js" }),
            json!({ "code": 4 }),
            json!([1]),
        ] {
            let value = image(json!({ "generator": bad }));
            let element = parsed(&value);
            assert_eq!(element.generator(), None, "{bad}");
            assert_eq!(
                serde_json::to_value(Element::Image(element)).unwrap(),
                value
            );
        }
    }

    #[test]
    fn setting_and_taking_away_a_program_touches_nothing_else() {
        let mut element = parsed(&image(json!({ "x-diagram": "library/flow.drawio" })));
        let mut generator = PictureGenerator::new("return kit.svg(10, 10);", GeneratorOutput::Png);
        generator.made_by = Some("agent:x".to_owned());
        element.set_generator(Some(&generator));
        assert_eq!(element.generator().as_ref(), Some(&generator));
        assert_eq!(
            element.extra.get("x-diagram"),
            Some(&json!("library/flow.drawio"))
        );
        element.set_generator(None);
        assert_eq!(element.generator(), None);
        assert_eq!(
            serde_json::to_value(Element::Image(element)).unwrap(),
            image(json!({ "x-diagram": "library/flow.drawio" }))
        );
    }

    #[test]
    fn a_block_is_checked_before_it_is_run() {
        let ok = PictureGenerator::new("return 1", GeneratorOutput::Svg);
        assert_eq!(ok.problem(), None);
        let mut other = ok.clone();
        other.language = "python".to_owned();
        assert!(other.problem().unwrap().contains("JavaScript"));
        assert!(
            PictureGenerator::new("  ", GeneratorOutput::Svg)
                .problem()
                .is_some()
        );
        assert!(
            PictureGenerator::new("x".repeat(MAX_CODE_BYTES + 1), GeneratorOutput::Svg)
                .problem()
                .is_some()
        );
        let named = |name: &str| {
            let mut g = ok.clone();
            g.inputs.push(GeneratorInput {
                name: name.to_owned(),
                kind: GeneratorInputKind::Data,
                value: String::new(),
                extra: Extra::new(),
            });
            g
        };
        assert_eq!(named("sales").problem(), None);
        for bad in ["", "1st", "a b", "a-b"] {
            assert!(named(bad).problem().is_some(), "{bad:?}");
        }
        let mut twice = named("sales");
        twice.inputs.push(twice.inputs[0].clone());
        assert!(twice.problem().unwrap().contains("sales"));
    }

    #[test]
    fn the_run_hash_follows_the_code_what_it_read_and_the_output() {
        let base = run_hash("code", "in", GeneratorOutput::Svg);
        assert_eq!(base, run_hash("code", "in", GeneratorOutput::Svg));
        assert_eq!(base.len(), 16);
        assert_ne!(base, run_hash("code2", "in", GeneratorOutput::Svg));
        assert_ne!(base, run_hash("code", "in2", GeneratorOutput::Svg));
        assert_ne!(base, run_hash("code", "in", GeneratorOutput::Png));
        // The parts do not run together.
        assert_ne!(
            run_hash("ab", "c", GeneratorOutput::Svg),
            run_hash("a", "bc", GeneratorOutput::Svg)
        );
    }
}
