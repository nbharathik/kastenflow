//! `kasten-latex.yaml`, the optional settings file beside a document's root
//! `.tex`: which file is the root, which engine builds it, where its
//! bibliography comes from, and whether agents may change it. Keys this
//! version does not know are kept when the file is written back.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::frontmatter::{set_key, set_key_raw};

/// The engines a document can be built with.
pub const ENGINES: [&str; 4] = ["tectonic", "latexmk-pdf", "latexmk-xe", "latexmk-lua"];
/// Where the bibliography comes from: the vault's managed `sources/references.bib`
/// (copied into the build) or a `.bib` that lives in the document's folder.
pub const BIBLIOGRAPHIES: [&str; 2] = ["vault", "local"];
/// The engine a document without a choice uses.
pub const DEFAULT_ENGINE: &str = "tectonic";
/// The bibliography a document without a choice uses.
pub const DEFAULT_BIBLIOGRAPHY: &str = "local";

fn not(flag: &bool) -> bool {
    !*flag
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LatexConfig {
    /// The root file, relative to the folder holding this file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main: Option<String>,
    /// One of `ENGINES`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    /// One of `BIBLIOGRAPHIES`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bibliography: Option<String>,
    /// Read-only for agents.
    #[serde(skip_serializing_if = "not")]
    pub locked: bool,
    /// Keys a newer version wrote, kept as they were.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl LatexConfig {
    /// The settings in `text`; a file that cannot be read gives the defaults.
    pub fn parse(text: &str) -> LatexConfig {
        Self::try_parse(text).unwrap_or_default()
    }

    /// The settings in `text`, or why it cannot be read.
    pub fn try_parse(text: &str) -> Result<LatexConfig> {
        let text = text.trim_start_matches('\u{feff}');
        if text.trim().is_empty() {
            return Ok(LatexConfig::default());
        }
        serde_saphyr::from_str(text).map_err(|_| {
            Error::Invalid("kasten-latex.yaml could not be read; fix or remove it first".to_owned())
        })
    }

    /// The file as it is written.
    pub fn to_yaml(&self) -> Result<String> {
        serde_saphyr::to_string(self).map_err(|e| Error::Invalid(e.to_string()))
    }

    /// The file as it is written over `existing` (the file's present text):
    /// only the lines of the four keys that changed are touched, so comments,
    /// key order, quoting and every key this version does not know stay byte
    /// for byte. A file that cannot be patched safely is written out whole.
    pub fn to_yaml_over(&self, existing: &str) -> Result<String> {
        let old = Self::try_parse(existing)?;
        if old == *self {
            return Ok(existing.to_owned());
        }
        if old.extra == self.extra
            && !existing.trim().is_empty()
            && let Some(patched) = self.patched(existing, &old)
            && Self::try_parse(&patched).is_ok_and(|read| read == *self)
        {
            return Ok(patched);
        }
        self.to_yaml()
    }

    /// `existing` with the lines of the keys that differ from `old` changed.
    fn patched(&self, existing: &str, old: &LatexConfig) -> Option<String> {
        let (bom, rest) = match existing.strip_prefix('\u{feff}') {
            Some(rest) => ("\u{feff}", rest),
            None => ("", existing),
        };
        let eol = if rest.contains("\r\n") { "\r\n" } else { "\n" };
        let sep = if rest.ends_with('\n') { "" } else { eol };
        let mut block = format!("---{eol}{rest}{sep}---{eol}");
        for (key, was, now) in [
            ("main", &old.main, &self.main),
            ("engine", &old.engine, &self.engine),
            ("bibliography", &old.bibliography, &self.bibliography),
        ] {
            if was != now {
                block = set_key(&block, key, now.as_deref(), eol);
            }
        }
        if old.locked != self.locked {
            block = set_key_raw(&block, "locked", self.locked.then_some("true"), eol);
        }
        let inner = block
            .strip_prefix(&format!("---{eol}"))?
            .strip_suffix(&format!("---{eol}"))?;
        Some(format!("{bom}{inner}"))
    }

    /// The engine that builds the document: the chosen one if it is known.
    pub fn engine_name(&self) -> &str {
        self.engine
            .as_deref()
            .filter(|e| ENGINES.contains(e))
            .unwrap_or(DEFAULT_ENGINE)
    }

    /// The bibliography choice: the chosen one if it is known.
    pub fn bibliography_name(&self) -> &str {
        self.bibliography
            .as_deref()
            .filter(|b| BIBLIOGRAPHIES.contains(b))
            .unwrap_or(DEFAULT_BIBLIOGRAPHY)
    }

    /// Refuses a setting a person tries to save that cannot work.
    pub fn check(&self) -> Result<()> {
        if let Some(engine) = &self.engine
            && !ENGINES.contains(&engine.as_str())
        {
            return Err(Error::Invalid(format!(
                "The engine can be {}; not “{engine}”",
                ENGINES.join(", ")
            )));
        }
        if let Some(bibliography) = &self.bibliography
            && !BIBLIOGRAPHIES.contains(&bibliography.as_str())
        {
            return Err(Error::Invalid(format!(
                "The bibliography can be vault or local; not “{bibliography}”"
            )));
        }
        if let Some(main) = &self.main
            && (!main.ends_with(".tex")
                || main.starts_with('/')
                || main.contains(['\\', ':', '\0'])
                || main
                    .split('/')
                    .any(|p| p.is_empty() || p == "." || p == ".."))
        {
            return Err(Error::Invalid(format!(
                "The main file must be a .tex path inside the folder; not “{main}”"
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FUTURE: &str = include_str!("../../../../fixtures/latex/yaml/future.yaml");

    #[test]
    fn reads_the_four_keys_and_keeps_the_rest() {
        let config = LatexConfig::parse(FUTURE);
        assert_eq!(config.main.as_deref(), Some("src/paper.tex"));
        assert_eq!(config.engine_name(), "latexmk-xe");
        assert_eq!(config.bibliography_name(), "vault");
        assert!(config.locked);
        assert_eq!(config.extra["future_flag"], 3);
        assert_eq!(config.extra["shelf"]["tags"][1], 2026);
    }

    #[test]
    fn writes_back_with_the_unknown_keys() {
        let config = LatexConfig::parse(FUTURE);
        let again = LatexConfig::parse(&config.to_yaml().unwrap());
        assert_eq!(config, again);
        assert!(config.to_yaml().unwrap().contains("future_flag"));
    }

    #[test]
    fn missing_or_unreadable_files_mean_defaults() {
        let config = LatexConfig::parse("");
        assert_eq!(
            (
                config.engine_name(),
                config.bibliography_name(),
                config.locked
            ),
            ("tectonic", "local", false)
        );
        assert_eq!(
            LatexConfig::parse("engine: [unclosed").engine_name(),
            "tectonic"
        );
        assert!(LatexConfig::try_parse("engine: [unclosed").is_err());
        // An engine nobody knows is not used.
        assert_eq!(LatexConfig::parse("engine: word").engine_name(), "tectonic");
    }

    #[test]
    fn refuses_settings_that_cannot_work() {
        let bad = |c: LatexConfig| c.check().unwrap_err().to_string();
        assert!(
            bad(LatexConfig {
                engine: Some("word".into()),
                ..Default::default()
            })
            .contains("engine")
        );
        assert!(
            bad(LatexConfig {
                bibliography: Some("cloud".into()),
                ..Default::default()
            })
            .contains("bibliography")
        );
        for main in ["../x.tex", "/x.tex", "a/../x.tex", "x.md", "a//x.tex"] {
            assert!(
                bad(LatexConfig {
                    main: Some(main.into()),
                    ..Default::default()
                })
                .contains("main"),
                "{main}"
            );
        }
        let fine = LatexConfig {
            main: Some("src/x.tex".into()),
            engine: Some("tectonic".into()),
            ..Default::default()
        };
        assert!(fine.check().is_ok());
    }
}
