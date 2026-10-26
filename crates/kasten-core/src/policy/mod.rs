//! How much an agent may change without asking: the three agent modes
//! (review everything, balanced, autonomous), the one function that turns an
//! op's kind and the mode into commit, propose or refuse, and the checkpoints
//! autonomous work leaves behind. The engine (engine/agent_policy.rs) applies
//! this to real ops; nothing here touches the vault but the checkpoint list.

mod checkpoints;
mod modes;

use std::collections::BTreeMap;

pub use checkpoints::{CHECKPOINTS_PATH, Checkpoint, SESSION_LABEL};
pub(crate) use checkpoints::{
    forget as forget_checkpoint, load as load_checkpoints, record as record_checkpoint,
};
pub use modes::{
    AUTONOMOUS_APPROVER, Commit, Decision, OpClass, decide, effective_mode, parse_time,
};

use crate::config_keys::AgentMode;

/// A batch of more than this many ops gets a checkpoint first.
pub const BATCH_CHECKPOINT_OVER: usize = 20;

/// The agent mode a person sets (`set_agent_policy`): the vault's mode, until
/// when it holds (an ISO time; none means without end), and the projects that
/// have a mode of their own.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AgentPolicy {
    pub mode: AgentMode,
    pub until: Option<String>,
    pub projects: BTreeMap<String, AgentMode>,
}
