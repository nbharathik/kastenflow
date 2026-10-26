//! The agent modes at work: which mode holds for what an op touches, the one
//! decision for every agent op (`decide`), the commits autonomous mode makes
//! (a checkpoint first, a `Kasten-Mode` trailer, `Approved-by` for what would
//! have waited), where an in-app chat writes, and the person-only op that
//! changes the mode.

use serde_json::Value;

use super::boards::project_of;
use super::{Change, Kasten};
use crate::agent::{AgentOp, Session};
use crate::config::{CONFIG_PATH, Config};
use crate::config_keys::AgentMode;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::policy::{self, AUTONOMOUS_APPROVER, AgentPolicy, Commit, Decision};
use crate::time::Instant;

/// How strict a mode is: the lowest wins where an op touches two projects.
fn rank(mode: AgentMode) -> u8 {
    match mode {
        AgentMode::Review => 0,
        AgentMode::Balanced => 1,
        AgentMode::Autonomous => 2,
    }
}

/// The projects an op touches (none for the library): where a note is, and
/// where it goes or is made.
pub(super) fn projects_of(op: &AgentOp) -> Vec<Option<String>> {
    match op {
        AgentOp::Batch { ops, .. } => ops.iter().flat_map(projects_of).collect(),
        AgentOp::Move { path, project } => vec![project_of(path), project.clone()],
        // The page stays in the stricter of where it is and where it goes.
        AgentOp::SetParent {
            path,
            parent: Some(parent),
        } => vec![project_of(path), project_of(parent)],
        // A new note, board, deck or diagram is filed under the project's
        // folder name, however the agent spells it ("Photo Organiser" is
        // `photo-organiser`), and that is the project whose mode holds.
        AgentOp::CreateNote {
            project: Some(project),
            ..
        }
        | AgentOp::SmartCreate {
            project: Some(project),
            ..
        }
        | AgentOp::CreateBoard {
            project: Some(project),
            ..
        }
        | AgentOp::CreateDeck {
            project: Some(project),
            ..
        }
        | AgentOp::CreateDiagram {
            project: Some(project),
            ..
        } => vec![Some(crate::slug::slugify(project))],
        AgentOp::CreateNote {
            parent: Some(parent),
            ..
        }
        | AgentOp::SmartCreate {
            parent: Some(parent),
            ..
        } => vec![project_of(parent)],
        // A new source file has no existing path (`path()`), but its place says the project.
        AgentOp::SaveSource { path, .. } => vec![project_of(path)],
        // The setup is read from this project, whatever folder it is written to.
        AgentOp::SaveProjectSetup { project, .. } => {
            vec![super::setup_agent::project_for_mode(project)]
        }
        other => vec![other.path().and_then(project_of)],
    }
}

/// While it lives, the commits of one session are made in autonomous mode.
pub(super) struct AutonomousScope<'a> {
    kasten: &'a Kasten,
}

impl Drop for AutonomousScope<'_> {
    fn drop(&mut self) {
        self.kasten.state().autonomous = None;
    }
}

impl Kasten {
    /// The mode that holds for a write to `project` (none: the library) at
    /// `now`. Autonomous work is only allowed where it can be undone, so a
    /// vault without history is balanced whatever its config says.
    pub fn agent_mode(&self, project: Option<&str>, now: Instant) -> AgentMode {
        self.mode_among(&[project.map(str::to_owned)], now)
    }

    pub(super) fn mode_among(&self, projects: &[Option<String>], now: Instant) -> AgentMode {
        let config = self.config();
        let mode = projects
            .iter()
            .map(|project| policy::effective_mode(&config, project.as_deref(), now))
            .min_by_key(|mode| rank(*mode))
            .unwrap_or_default();
        if mode == AgentMode::Autonomous && !self.has_history() {
            AgentMode::Balanced
        } else {
            mode
        }
    }

    /// What to do with an agent op: refuse it, keep it for review, or commit
    /// it (and how). The refusals come first and hold in every mode; then the
    /// op is classed by the limits it is over, and the mode of what it touches
    /// (the strictest, where it touches more than one project) decides.
    pub fn decide(&self, session: &Session, op: &AgentOp, now: Instant) -> Result<Decision> {
        // A batch is decided as a whole: one refusal refuses it, one change
        // that waits makes all of it wait (engine/batch_decide.rs).
        if let AgentOp::Batch { ops, .. } = op {
            return self.decide_batch(session, ops, now);
        }
        if let Err(err) = self.refusals(op) {
            return Ok(Decision::Refuse(err));
        }
        let class = self.op_class(session, op, now)?;
        let mut projects = self.touched_projects(op)?;
        projects.extend(self.floor_of(session));
        let mode = self.mode_among(&projects, now);
        Ok(policy::decide(mode, class))
    }

    /// Holds `session` to the mode of `project` (none: the library) as well as
    /// to that of the notes its ops touch: the stricter of the two decides.
    /// A smart page's session is held to the page's own project, so a page in
    /// a Review project cannot write freely to a note in a looser one.
    pub fn hold_session_to(&self, session: &Session, project: Option<&str>) {
        self.state()
            .floors
            .insert(session.id.clone(), project.map(str::to_owned));
    }

    /// The project `session` is held to (`hold_session_to`), if any.
    pub(super) fn floor_of(&self, session: &Session) -> Option<Option<String>> {
        self.state().floors.get(&session.id).cloned()
    }

    /// The projects an op touches: `projects_of`, and, for the parity ops
    /// whose place is not their path's, where they put or change things.
    pub(super) fn touched_projects(&self, op: &AgentOp) -> Result<Vec<Option<String>>> {
        let mut out = projects_of(op);
        match op {
            AgentOp::Batch { ops, .. } => {
                for each in ops {
                    out.extend(self.parity_projects(each)?);
                }
            }
            other => out.extend(self.parity_projects(other)?),
        }
        Ok(out)
    }

    /// Runs an op that `decide` let through, as the session's agent.
    pub(super) fn execute_committed(
        &self,
        session: &Session,
        op: &AgentOp,
        how: Commit,
        now: Instant,
    ) -> Result<Value> {
        let changes = match op {
            AgentOp::Batch { ops, .. } => ops.len(),
            _ => 1,
        };
        let _autonomous = self.autonomous_scope_for(session, how, changes, now)?;
        self.execute(&session.actor(), op, now)
    }

    /// For an autonomous commit: the checkpoint is taken first, then, until
    /// the scope is dropped, the session's commits carry the mode.
    pub(super) fn autonomous_scope(
        &self,
        session: &Session,
        how: Commit,
        now: Instant,
    ) -> Result<Option<AutonomousScope<'_>>> {
        self.autonomous_scope_for(session, how, 1, now)
    }

    /// `autonomous_scope` for `changes` changes made together (a batch).
    fn autonomous_scope_for(
        &self,
        session: &Session,
        how: Commit,
        changes: usize,
        now: Instant,
    ) -> Result<Option<AutonomousScope<'_>>> {
        if !how.autonomous {
            return Ok(None);
        }
        self.maybe_checkpoint(session, true, changes, now)?;
        self.state().autonomous = Some((session.id.clone(), how.auto_accepted));
        Ok(Some(AutonomousScope { kasten: self }))
    }

    /// The trailers for an agent commit: those it has, and, while its session
    /// commits in autonomous mode, the mode (and who approved what would
    /// have waited).
    pub(super) fn mode_trailers<'a>(
        &self,
        actor: &Actor,
        extra: &[(&'a str, String)],
    ) -> Vec<(&'a str, String)> {
        let mut out = extra.to_vec();
        if let Actor::Agent { session, .. } = actor
            && let Some((autonomous, auto)) = &self.state().autonomous
            && autonomous == session
        {
            out.push(("Kasten-Mode", "autonomous".to_owned()));
            if *auto {
                out.push(("Approved-by", AUTONOMOUS_APPROVER.to_owned()));
            }
        }
        out
    }

    /// Whether an in-app chat holds its writes as a change set for the person
    /// to apply: always on review, unless "Apply directly" is on in balanced,
    /// never in autonomous.
    pub fn chat_writes_staged(
        &self,
        project: Option<&str>,
        apply_directly: bool,
        now: Instant,
    ) -> bool {
        match self.agent_mode(project, now) {
            AgentMode::Review => true,
            AgentMode::Balanced => !apply_directly,
            AgentMode::Autonomous => false,
        }
    }

    /// Sets how much agents may do: the vault's mode, until when, and the
    /// projects with a mode of their own. Only a person can: an agent, whatever
    /// its session, is refused, and agents cannot write `.kasten/` either, so
    /// they cannot raise their own limits. One commit; keys this version does
    /// not know stay in the file.
    pub fn set_agent_policy(&self, actor: &Actor, wanted: AgentPolicy, now: Instant) -> Result<()> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Only a person can change how much agents may do".to_owned(),
            ));
        }
        let mode = wanted.mode;
        let until = wanted.until.filter(|u| !u.trim().is_empty());
        if let Some(until) = &until
            && policy::parse_time(until).is_none()
        {
            return Err(Error::Invalid(format!(
                "“{until}” is not a date and time (for example 2026-12-01 18:00)"
            )));
        }
        // The file is the truth, read under the write lock: another program
        // (or the app next to an MCP server) may have changed it, say a plugin
        // switched on, since this engine last looked; writing back an older
        // copy would undo that.
        let config = self.apply(actor, "set_agent_policy", false, now.millis, |vault| {
            let mut config = Config::load(vault.root())?;
            let mut agents = config.agents.take().unwrap_or_default();
            let mut kept = std::mem::take(&mut agents.projects);
            agents.mode = Some(mode);
            agents.until = until;
            agents.projects = wanted
                .projects
                .into_iter()
                .map(|(slug, mode)| {
                    let mut entry = kept.remove(&slug).unwrap_or_default();
                    entry.mode = Some(mode);
                    (slug, entry)
                })
                .collect();
            config.agents = Some(agents);
            config.save(vault.root())?;
            Ok(Change {
                message: format!("settings: agents {mode:?}").to_lowercase(),
                paths: vec![CONFIG_PATH.to_owned()],
                value: config,
            })
        })?;
        *self.config.write().unwrap_or_else(|p| p.into_inner()) = config;
        self.config_saved();
        Ok(())
    }
}
