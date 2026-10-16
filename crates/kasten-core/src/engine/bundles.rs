//! Project bundles: planning and exporting a project with what it uses, and
//! importing one (the import itself is `import`'s, for a folder that holds a
//! bundle's manifest). Exporting reads the vault and writes a folder outside it:
//! no commit is made and nothing in the vault changes.

mod collect;
mod uses;

use std::path::Path;

use super::Kasten;
use crate::bundle::{self, BundleExported, BundlePlan};
use crate::error::Result;
use crate::time::Instant;

impl Kasten {
    /// What exporting the project in `projects/<project>/` would put in a bundle.
    pub fn plan_export(&self, project: &str) -> Result<BundlePlan> {
        Ok(collect::collect(self, project)?.plan())
    }

    /// Writes the bundle of the project in `projects/<project>/` into `dest`, a folder
    /// that is new or empty and outside the vault. The manifest goes in last.
    pub fn export_project(
        &self,
        project: &str,
        dest: &Path,
        now: Instant,
    ) -> Result<BundleExported> {
        let collected = collect::collect(self, project)?;
        bundle::write_export(&collected, self.root(), dest, now)
    }
}
