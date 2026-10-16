//! Full-text search: BM25 with titles boosted, prefix matches, and filters
//! beside the words (read out of the query by `filters`):
//!
//! - `tag:paper` or `#paper`, `project:photo-organiser`, `type:card`
//! - `before:2026-10-01`, `after:2026-09-01`: the note's own date (its
//!   `updated`, else `created`, else its file's time)
//! - `on:2026-10-06`: made or changed on that day
//! - `created:2026-10`, `updated:2026-09-01..2026-09-30`: a day, a month, a
//!   year or a range `a..b` (`a..` and `..b` leave one end open); `created`
//!   is the note's `created`, `updated` its own date as `before:` reads it
//! - `under:<note id or path>`: that page and every page below it, through
//!   the `parent` chain; a path with spaces is quoted, `under:"a b.md"`
//!
//! All narrow together, with words or alone (then the newest come first).

use rusqlite::ToSql;

use super::Index;
use super::filters::{Filters, filter_sql, parse_query};
use super::query::{META_COLUMNS, meta_of};
use crate::error::Result;
use crate::search::Hit;

/// The words as an FTS5 query: each a quoted prefix match, all required.
fn match_expression(words: &[String]) -> Option<String> {
    let parts: Vec<String> = words
        .iter()
        .map(|w| {
            w.split(|c: char| !c.is_alphanumeric())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// The upper bound of a prefix range: `abc` → `abd`, so `title_key >= q
/// AND title_key < upper` finds every title starting with `q` by index.
fn prefix_upper(prefix: &str) -> Option<String> {
    let mut chars: Vec<char> = prefix.chars().collect();
    while let Some(last) = chars.pop() {
        if let Some(next) = char::from_u32(last as u32 + 1) {
            chars.push(next);
            return Some(chars.into_iter().collect());
        }
    }
    None
}

impl Index {
    /// The best matches for `query`, most relevant first: titles equal to
    /// the query, then titles starting with it, then full-text matches by
    /// BM25 with titles weighted ten times the body.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Hit>> {
        let (words, filters) = parse_query(query);
        let expression = match_expression(&words);
        if expression.is_none() && filters == Filters::default() {
            return Ok(Vec::new());
        }
        let Some(expression) = expression else {
            return self.filtered(&filters, limit);
        };
        let typed = words.join(" ").trim().to_lowercase();
        let mut hits = self.title_hits(&typed, &filters, limit)?;
        let seen: std::collections::HashSet<String> = hits.iter().map(|h| h.path.clone()).collect();

        let want = limit.saturating_sub(hits.len());
        let found = if filters == Filters::default() {
            self.ranked_fast(&expression, want.saturating_add(seen.len() + 8))?
        } else {
            self.ranked_filtered(&expression, &filters, want.saturating_add(seen.len()))?
        };
        hits.extend(
            found
                .into_iter()
                .filter(|h| !seen.contains(&h.path))
                .take(want),
        );
        let total = hits.len();
        for (i, hit) in hits.iter_mut().enumerate() {
            hit.score = (total - i) as u32;
        }
        Ok(hits)
    }

    /// Notes whose title is, or starts with, what was typed.
    fn title_hits(&self, typed: &str, filters: &Filters, limit: usize) -> Result<Vec<Hit>> {
        let Some(upper) = prefix_upper(typed) else {
            return Ok(Vec::new());
        };
        let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(typed.to_owned()), Box::new(upper)];
        let filter = filter_sql(filters, &mut params);
        params.push(Box::new(limit as i64));
        let sql = format!(
            "SELECT n.path, n.title, n.icon, n.excerpt FROM notes n WHERE n.title_key >= ?1 AND n.title_key < ?2{filter}
             ORDER BY n.title_key = ?1 DESC, length(n.title_key), n.modified DESC LIMIT ?{}",
            params.len()
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(refs.as_slice(), |r| {
            Ok(Hit {
                path: r.get(0)?,
                title: r.get(1)?,
                icon: r.get(2)?,
                snippet: r.get(3)?,
                score: 0,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Full-text matches ranked inside FTS5 (`ORDER BY rank` stops after
    /// `limit` rows, so only those get snippets); templates dropped after.
    fn ranked_fast(&self, expression: &str, limit: usize) -> Result<Vec<Hit>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT n.path, n.title, n.icon, f.snip, n.kind FROM
               (SELECT rowid AS num, snippet(fts, 1, '', '', '…', 14) AS snip, rank FROM fts WHERE fts MATCH ?1 ORDER BY rank LIMIT ?2) f
             JOIN notes n ON n.num = f.num ORDER BY f.rank",
        )?;
        let rows = stmt.query_map(rusqlite::params![expression, limit as i64], |r| {
            Ok((
                Hit {
                    path: r.get(0)?,
                    title: r.get(1)?,
                    icon: r.get(2)?,
                    snippet: r.get(3)?,
                    score: 0,
                },
                r.get::<_, String>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (hit, kind) = row?;
            if kind != "template" && kind != crate::note::AI_ACTION {
                out.push(hit);
            }
        }
        Ok(out)
    }

    /// Full-text matches that pass filters, ranked by BM25.
    fn ranked_filtered(
        &self,
        expression: &str,
        filters: &Filters,
        limit: usize,
    ) -> Result<Vec<Hit>> {
        let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(expression.to_owned())];
        let filter = filter_sql(filters, &mut params);
        params.push(Box::new(limit as i64));
        let sql = format!(
            "SELECT n.path, n.title, n.icon, snippet(fts, 1, '', '', '…', 14) FROM fts JOIN notes n ON n.num = fts.rowid
             WHERE fts MATCH ?1{filter} ORDER BY bm25(fts, 10.0, 1.0) LIMIT ?{}",
            params.len()
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(refs.as_slice(), |r| {
            Ok(Hit {
                path: r.get(0)?,
                title: r.get(1)?,
                icon: r.get(2)?,
                snippet: r.get(3)?,
                score: 0,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Only filters, no words: the newest matching notes.
    fn filtered(&self, filters: &Filters, limit: usize) -> Result<Vec<Hit>> {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let filter = filter_sql(filters, &mut params);
        params.push(Box::new(limit as i64));
        let sql = format!(
            "SELECT {META_COLUMNS} FROM notes n WHERE 1 = 1{filter} ORDER BY n.modified DESC LIMIT ?{}",
            params.len()
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(refs.as_slice(), meta_of)?;
        let metas: Vec<_> = rows.collect::<std::result::Result<_, _>>()?;
        let total = metas.len();
        Ok(metas
            .into_iter()
            .enumerate()
            .map(|(i, m)| Hit {
                path: m.path,
                title: m.title,
                icon: m.icon,
                snippet: m.excerpt,
                score: (total - i) as u32,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_the_match_expression_from_the_words() {
        let (words, filters) = parse_query("type:card \"old notes\" diff");
        assert_eq!(filters.kind.as_deref(), Some("card"));
        assert_eq!(
            match_expression(&words).as_deref(),
            Some("\"old notes\"* \"diff\"*")
        );
        assert_eq!(match_expression(&["(\"*)".into()]), None);
    }
}
