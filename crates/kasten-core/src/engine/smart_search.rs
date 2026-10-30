//! Search over a smart page's code folder: the words `index.html` shows (its
//! tags, scripts, styles and comments left out), found after the notes' own
//! hits and leading to the page. Nothing else in the folder is searched: not
//! its scripts, its data, nor its other files.

use std::collections::HashSet;
use std::fs;

use super::Kasten;
use crate::error::Result;
use crate::latex::snippet_around;
use crate::search::Hit;
use crate::smart::{INDEX_FILE, MAX_FILE_BYTES, SMART_DIR_SUFFIX, visible_text};

impl Kasten {
    /// Pages whose `index.html` shows every word of `query`, at most `limit`,
    /// not among `seen` (paths the notes' own search found already). Filters
    /// in the query (`tag:`, `project:`…) are the notes' business: with any,
    /// nothing is returned here.
    pub(super) fn smart_hits(
        &self,
        query: &str,
        limit: usize,
        seen: &HashSet<String>,
    ) -> Result<Vec<Hit>> {
        let (words, filters) = crate::index::parse_query(query);
        if words.is_empty() || filters != crate::index::Filters::default() || limit == 0 {
            return Ok(Vec::new());
        }
        let lowered: Vec<String> = words.iter().map(|word| word.to_lowercase()).collect();
        let suffix = format!("/{INDEX_FILE}");
        let mut hits = Vec::new();
        for stat in self.vault.files_among(&[INDEX_FILE])? {
            // `<page>.smart/index.html`, nothing else of that name.
            let Some(stem) = stat
                .path
                .strip_suffix(&suffix)
                .and_then(|dir| dir.strip_suffix(SMART_DIR_SUFFIX))
                .filter(|stem| !stem.is_empty() && !stem.ends_with('/'))
            else {
                continue;
            };
            let page = format!("{stem}.md");
            if stat.size > MAX_FILE_BYTES
                || seen.contains(&page)
                || crate::vault::in_templates(&page)
            {
                continue;
            }
            let Ok(note) = self.vault.read(&page) else {
                continue;
            };
            let Ok(html) = fs::read_to_string(self.vault.root().join(&stat.path)) else {
                continue;
            };
            let text = visible_text(&html);
            let lower = text.to_lowercase();
            if !lowered.iter().all(|word| lower.contains(word.as_str())) {
                continue;
            }
            hits.push(Hit {
                snippet: snippet_around(&text, &words[0], 90),
                path: page,
                title: note.meta.title,
                icon: note.meta.icon,
                score: 0,
            });
            if hits.len() >= limit {
                break;
            }
        }
        Ok(hits)
    }
}
