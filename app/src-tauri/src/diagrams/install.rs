//! Installing the diagram editor: the plugin installer (`plugins::payload`)
//! with the editor's own parts, which are what its WAR is unpacked with
//! (`extract`) and the `index.html` a whole copy holds.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use super::extract::{Failure, Limits, extract};
use super::pinned::Source;
use crate::plugins::payload::{Spec, install as install_payload};

#[cfg(test)]
pub use crate::plugins::payload::{PARTIAL, Phase};
pub use crate::plugins::payload::{Progress, VERSION_FILE, client, release_host};

/// How the editor's download is unpacked and what makes a copy whole.
pub fn editor_spec(limits: Limits) -> Spec {
    Spec {
        label: "the diagram editor".to_owned(),
        required: "index.html",
        unpack: Arc::new(move |war, into, cancel, progress| {
            extract(war, into, &limits, cancel, progress).map(|_| ())
        }),
    }
}

/// Downloads, checks, unpacks and installs `source` as `<root>/<version>/`.
/// `report` hears each step. On any failure nothing of the new copy is left,
/// and an installed one is untouched.
pub async fn install(
    client: &reqwest::Client,
    source: &Source,
    root: &Path,
    limits: Limits,
    cancel: Arc<AtomicBool>,
    report: Arc<dyn Fn(Progress) + Send + Sync>,
) -> Result<(), Failure> {
    install_payload(client, source, root, &editor_spec(limits), cancel, report).await
}
