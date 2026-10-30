//! What the backup knows beyond a push: how many changes it lacks, files
//! too big for GitHub that stay out of history, a safety branch for a
//! backup someone rewrote, and the answers the person is given (back up now,
//! linking an existing backup, the weekly check, early failure notices).
//! Nothing here deletes or rewrites anything: a push is never forced, and a
//! file left out of history stays on disk.

pub mod answer;
pub mod auto_pull;
pub mod config;
pub mod link;
pub mod notice;
pub mod recovered;
pub mod skip;
pub mod status;
pub mod verify;

pub use answer::{BackUpNow, CarryOn, NotBackedUp};
pub use auto_pull::{AutoPull, Held};
pub use config::{BackupConfig, DEFAULT_FETCH_MINUTES, GetLatest};
pub use link::{LinkChoice, LinkResult};
pub use notice::{BackupNotice, FAILING_FOR_MS, REFUSED_TIMES};
pub use skip::{LargeFile, SKIP_LIMIT, SKIP_PATH, SkippedFile, WARN_LIMIT};
pub use status::BackupExtras;
pub use verify::{CHECK_EVERY_MS, RemoteCheck};
