//! The agent layer: sessions, the ops agents
//! may run, and proposals, the ops that wait for a person's review. The
//! guardrails that decide between running, proposing and refusing live in
//! the engine, next to the ops they guard.

mod change_set;
mod import;
mod op;
mod proposal;
mod session;

pub use change_set::{
    ApplyOutcome, ChangeSet, Dropped, FileKind, MAX_STAGED_BYTES, MAX_STAGED_FILES, NewFile,
    StagedAsset, StagedFile, Step,
};
pub use import::{DeckImport, ImportedDeck};
pub use op::{AgentOp, SmartNewFile};
pub use proposal::{PROPOSALS, Proposal, ProposalStatus, Target};
pub use session::{NAME_MAX, Session, Tally, clean_name, is_invisible, load_trust, save_trust};
