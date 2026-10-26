//! Formula values for the rows of a tag database: worked out when rows are
//! read, on copies of the notes, and never written to a file.

use super::Kasten;
use crate::error::Result;
use crate::note::NoteMeta;
use crate::tags::TagSchema;
use crate::tags::formula::{Day, Env, Problems, fill, needs_backlinks};

impl Kasten {
    /// Sets the formula properties of `schema` in `rows` (copies of notes
    /// from `everything`, which relations are followed in) as of `today`.
    /// The notes' files and the index are not touched. A cell that cannot be
    /// worked out is empty and named in the returned problems.
    pub fn fill_formulas(
        &self,
        schema: &TagSchema,
        rows: &mut [NoteMeta],
        everything: &[NoteMeta],
        today: Day,
    ) -> Result<Problems> {
        if !schema.properties.iter().any(|p| p.kind == "formula") {
            return Ok(Problems::new());
        }
        let mut env = Env::new(today, everything);
        if needs_backlinks(schema) {
            let mut counts = std::collections::HashMap::new();
            for row in rows.iter() {
                counts.insert(row.path.clone(), self.backlinks(&row.path)?.len());
            }
            env.backlinks = Some(counts);
        }
        Ok(fill(rows, schema, &env))
    }
}
