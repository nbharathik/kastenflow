//! The bibliography's part of `verify`: files that cannot be read, entries that are cut
//! short and keys that two entries share. It reports and never fixes.

use slides_bib::{Kind, scan};

use super::super::{Kasten, Problem};
use crate::bib::MatchKind;
use crate::error::Result;

fn problem(kind: &str, path: &str, detail: String) -> Problem {
    Problem {
        kind: kind.to_owned(),
        path: Some(path.to_owned()),
        detail,
    }
}

impl Kasten {
    /// What is wrong with the vault's `.bib` files. The same DOI under two keys is not
    /// a problem (it is listed as a duplicate work); the same key twice is, because a
    /// citation can name only one of them.
    pub fn bibliography_problems(&self) -> Result<Vec<Problem>> {
        let mut out = Vec::new();
        for file in self.read_bib_files()? {
            if let Some(why) = &file.problem {
                out.push(problem("bibliography", &file.path, why.clone()));
            }
            let Some(text) = &file.text else { continue };
            for span in scan(text) {
                if span.kind == Kind::Entry && !span.closed {
                    let key = span.key_in(text).unwrap_or("");
                    out.push(problem(
                        "bibliography",
                        &file.path,
                        format!("The entry {key} is not closed: a closing brace is missing"),
                    ));
                }
            }
        }
        for twice in self
            .bibliography()?
            .duplicates
            .into_iter()
            .filter(|d| d.by == MatchKind::Key)
        {
            let places: Vec<&str> = twice.entries.iter().map(|e| e.file.as_str()).collect();
            out.push(Problem {
                kind: "bibliography-duplicate".to_owned(),
                path: places.first().map(|p| (*p).to_owned()),
                detail: format!(
                    "The key {} is used in {}: a citation can name only one of them",
                    twice.value,
                    places.join(", ")
                ),
            });
        }
        Ok(out)
    }
}
