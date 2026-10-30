//! A few flags and positional words, parsed by hand: the CLI is small enough
//! not to need an argument-parsing crate.

use std::path::PathBuf;

pub struct Args {
    pub positional: Vec<String>,
    flags: Vec<(String, Option<String>)>,
}

/// Flags that take no value.
const SWITCHES: [&str; 9] = [
    "--json",
    "--vault-wide",
    "--diff",
    "--dry-run",
    "--remote",
    "--carry-on",
    "--yes",
    "--help",
    "-h",
];

impl Args {
    pub fn parse(raw: impl IntoIterator<Item = String>) -> Result<Args, String> {
        let mut positional = Vec::new();
        let mut flags = Vec::new();
        let mut iter = raw.into_iter();
        while let Some(arg) = iter.next() {
            if arg == "--" {
                positional.extend(iter.by_ref());
                break;
            }
            if let Some(flag) = arg.strip_prefix("--").filter(|f| !f.is_empty()) {
                if let Some((name, value)) = flag.split_once('=') {
                    flags.push((format!("--{name}"), Some(value.to_owned())));
                } else if SWITCHES.contains(&arg.as_str()) {
                    flags.push((arg, None));
                } else {
                    let value = iter.next().ok_or_else(|| format!("{arg} needs a value"))?;
                    flags.push((arg, Some(value)));
                }
            } else if arg == "-h" {
                flags.push((arg, None));
            } else {
                positional.push(arg);
            }
        }
        Ok(Args { positional, flags })
    }

    pub fn has(&self, name: &str) -> bool {
        self.flags.iter().any(|(n, _)| n == name)
    }

    pub fn value(&self, name: &str) -> Option<&str> {
        self.flags
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .and_then(|(_, v)| v.as_deref())
    }

    pub fn number(&self, name: &str, default: usize) -> Result<usize, String> {
        match self.value(name) {
            Some(v) => v
                .parse()
                .map_err(|_| format!("{name} needs a number, not {v}")),
            None => Ok(default),
        }
    }

    /// The vault: `--vault`, else `KASTEN_VAULT`, else the current folder
    /// when it is a vault.
    pub fn vault(&self) -> Result<PathBuf, String> {
        if let Some(path) = self.value("--vault") {
            return Ok(PathBuf::from(path));
        }
        if let Ok(path) = std::env::var("KASTEN_VAULT")
            && !path.trim().is_empty()
        {
            return Ok(PathBuf::from(path));
        }
        let here = std::env::current_dir().map_err(|e| e.to_string())?;
        if here.join(".kasten").is_dir() {
            return Ok(here);
        }
        Err("No vault: pass --vault DIR, set KASTEN_VAULT, or run inside a vault".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_flags_values_and_words() {
        let args = Args::parse(
            [
                "capture",
                "--tags",
                "a,b",
                "Buy",
                "milk",
                "--json",
                "--limit=5",
            ]
            .map(String::from),
        )
        .unwrap();
        assert_eq!(args.positional, ["capture", "Buy", "milk"]);
        assert_eq!(args.value("--tags"), Some("a,b"));
        assert!(args.has("--json"));
        assert_eq!(args.number("--limit", 20).unwrap(), 5);
        assert!(Args::parse(["--tags".to_owned()]).is_err());
    }
}
