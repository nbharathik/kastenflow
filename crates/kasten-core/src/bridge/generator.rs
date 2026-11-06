//! What a request to run a generator carries, and the limits on it. The code of a
//! code picture runs in a frame of the app's window (a sandbox with no network,
//! no vault and no way out but one message), so the request carries everything
//! the code may see: its text, and the inputs its picture declared, already read
//! by the asker. The window is given nothing else and reads nothing itself.
//!
//! The payload (`payloads/<id>.bin`, see [`super::Mailbox::ask_with`]) holds a
//! [`GeneratorPayload`]; the request holds only the output kind, the time limit
//! and the deck the picture is for.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The only language there is for now.
pub const LANGUAGE_JS: &str = "js";
/// The longest code a request may carry.
pub const MAX_CODE_BYTES: usize = 128 * 1024;
/// The most inputs a picture may declare, and the most text of one and of all.
pub const MAX_INPUTS: usize = 16;
pub const MAX_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_INPUTS_TOTAL: usize = 4 * 1024 * 1024;
/// The longest an input's name may be.
const MAX_NAME: usize = 40;
/// The most colours the theme handed to the kit may have.
const MAX_THEME_COLOURS: usize = 16;
/// How long code may run when the request says nothing, and the longest it may.
pub const DEFAULT_RUN_MS: u64 = 10_000;
pub const MAX_RUN_MS: u64 = 30_000;
/// The most a picture the code made may come to: the SVG text, and a PNG.
pub const MAX_GENERATED_SVG: usize = 1024 * 1024;
pub const MAX_GENERATED_PNG: usize = 2 * 1024 * 1024;
/// The most pixels a side of a PNG may have.
pub const MAX_GENERATED_SIDE: u32 = 4_000;

/// What the code makes: an SVG picture, or the same drawing as a PNG.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GeneratorOutput {
    #[default]
    Svg,
    Png,
}

impl GeneratorOutput {
    pub fn word(self) -> &'static str {
        match self {
            GeneratorOutput::Svg => "svg",
            GeneratorOutput::Png => "png",
        }
    }
}

/// One declared input, as text the asker has read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratorInputText {
    /// How the code names it: `inputs.sales`.
    pub name: String,
    pub text: String,
}

/// The code and what it may read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratorPayload {
    pub language: String,
    pub code: String,
    #[serde(default)]
    pub inputs: Vec<GeneratorInputText>,
    /// The deck's colours by token (`text1`, `bg1`, `accent1` …) as `#rrggbb`, for the drawing kit.
    #[serde(default)]
    pub theme: BTreeMap<String, String>,
}

/// Whether `text` is a colour the kit may be given: `#` and 3, 4, 6 or 8 hex digits.
pub fn is_hex_colour(text: &str) -> bool {
    text.strip_prefix('#').is_some_and(|digits| {
        matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// Whether `name` can be an input's name: a plain identifier the code can write.
pub fn is_input_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name.len() <= MAX_NAME
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

impl GeneratorPayload {
    /// Whether the payload is within the limits; why not, in a sentence.
    pub fn check(&self) -> Result<()> {
        if self.language != LANGUAGE_JS {
            return Err(invalid(format!(
                "Code pictures are written in JavaScript (\"js\"); “{}” is not a language this app runs",
                self.language.chars().take(20).collect::<String>()
            )));
        }
        if self.code.trim().is_empty() {
            return Err(invalid("The code is empty"));
        }
        if self.code.len() > MAX_CODE_BYTES {
            return Err(invalid(format!(
                "The code is longer than {} KB",
                MAX_CODE_BYTES / 1024
            )));
        }
        if self.inputs.len() > MAX_INPUTS {
            return Err(invalid(format!(
                "A picture may have at most {MAX_INPUTS} inputs"
            )));
        }
        let mut total = 0;
        for (i, input) in self.inputs.iter().enumerate() {
            if !is_input_name(&input.name) {
                return Err(invalid(format!(
                    "“{}” cannot name an input: use letters, digits and _, starting with a letter",
                    input.name.chars().take(20).collect::<String>()
                )));
            }
            if self.inputs[..i]
                .iter()
                .any(|other| other.name == input.name)
            {
                return Err(invalid(format!("Two inputs are called {}", input.name)));
            }
            if input.text.len() > MAX_INPUT_BYTES {
                return Err(invalid(format!(
                    "The input {} is larger than {} MB",
                    input.name,
                    MAX_INPUT_BYTES / 1024 / 1024
                )));
            }
            total += input.text.len();
        }
        if total > MAX_INPUTS_TOTAL {
            return Err(invalid(format!(
                "The inputs together are larger than {} MB",
                MAX_INPUTS_TOTAL / 1024 / 1024
            )));
        }
        if self.theme.len() > MAX_THEME_COLOURS
            || self.theme.iter().any(|(token, colour)| {
                token.is_empty()
                    || token.len() > MAX_NAME
                    || !token.chars().all(|c| c.is_ascii_alphanumeric())
                    || !is_hex_colour(colour)
            })
        {
            return Err(invalid(
                "The theme colours are tokens (text1, accent1 …) with colours like #1a2b3c",
            ));
        }
        Ok(())
    }
}

/// The time limit of a request in range: the default when none was given.
pub fn clamp_run_ms(ms: u64) -> u64 {
    ms.clamp(1_000, MAX_RUN_MS)
}
