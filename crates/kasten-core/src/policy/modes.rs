//! What an agent op comes to under each agent mode. The mode of a write is
//! its project's own, else the vault's (`.kasten/config.yaml`, `agents:`); a
//! time-boxed mode that has run out is `balanced` again. `decide` is the one
//! place that turns "what kind of op is this" and "which mode holds" into
//! commit, propose or refuse.

use crate::config::Config;
use crate::config_keys::AgentMode;
use crate::error::Error;
use crate::time::Instant;

/// The person who approves what autonomous mode lets through, as the
/// `Approved-by` trailer names them.
pub const AUTONOMOUS_APPROVER: &str = "autonomous-mode";

/// What kind of op a write is, once the guardrails that refuse have passed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpClass {
    /// Inside every limit.
    Ordinary,
    /// Over a soft limit that holds now (a trusted session has had its
    /// limits lifted already, so none is reported for it); the reason says which.
    Soft(String),
    /// An op that waits for a person whoever is trusted (a full rewrite, a tag
    /// schema, a template, a deck or board or diagram sent to the trash).
    Always(String),
    /// Never done by an agent, in any mode.
    Hard(String),
}

/// How a commit that goes ahead is made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Commit {
    /// The mode is autonomous: a checkpoint comes first and the commit says so.
    pub autonomous: bool,
    /// The op would have waited for review; autonomous mode let it through
    /// and its commit says so (`Approved-by: autonomous-mode`).
    pub auto_accepted: bool,
}

/// What to do with an op.
#[derive(Debug)]
pub enum Decision {
    Commit(Commit),
    /// Keep it as a proposal, for this reason.
    Propose(String),
    Refuse(Error),
}

const REVIEW_ALL: &str = "Review everything is on, so every change waits for your review";

/// The three modes against the four kinds of op (the table in the guardrails).
pub fn decide(mode: AgentMode, class: OpClass) -> Decision {
    let plain = Commit {
        autonomous: false,
        auto_accepted: false,
    };
    let autonomous = Commit {
        autonomous: true,
        auto_accepted: false,
    };
    match (mode, class) {
        (_, OpClass::Hard(why)) => Decision::Refuse(Error::Invalid(why)),
        (AgentMode::Review, OpClass::Ordinary) => Decision::Propose(REVIEW_ALL.to_owned()),
        (AgentMode::Review | AgentMode::Balanced, OpClass::Soft(why) | OpClass::Always(why)) => {
            Decision::Propose(why)
        }
        (AgentMode::Balanced, OpClass::Ordinary) => Decision::Commit(plain),
        (AgentMode::Autonomous, OpClass::Ordinary | OpClass::Soft(_)) => {
            Decision::Commit(autonomous)
        }
        (AgentMode::Autonomous, OpClass::Always(_)) => Decision::Commit(Commit {
            auto_accepted: true,
            ..autonomous
        }),
    }
}

/// Milliseconds since the epoch for an ISO time (`2026-12-01`,
/// `2026-12-01T09:30`, `2026-12-01T09:30:00Z`, with a fraction or an offset
/// such as `+02:00`); none for text that is not one. A date alone is its
/// midnight, UTC.
pub fn parse_time(text: &str) -> Option<u64> {
    let text = text.trim();
    let (date, rest) = match text.split_once(['T', 't', ' ']) {
        Some((date, rest)) => (date, Some(rest)),
        None => (text, None),
    };
    let mut parts = date.split('-');
    let (year, month, day): (i64, i64, i64) = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (mut clock, mut offset) = (0_i64, 0_i64);
    if let Some(rest) = rest {
        let (time, zone) = match rest.find(['Z', 'z', '+', '-']) {
            Some(at) => rest.split_at(at),
            None => (rest, ""),
        };
        let mut fields = time.split(':');
        let hour: i64 = fields.next()?.parse().ok()?;
        let minute: i64 = fields.next().map_or(Some(0), |m| m.parse().ok())?;
        let second: f64 = fields.next().map_or(Some(0.0), |s| s.parse().ok())?;
        if fields.next().is_some() || hour > 23 || minute > 59 || !(0.0..61.0).contains(&second) {
            return None;
        }
        clock = hour * 3600 + minute * 60 + second as i64;
        offset = match zone {
            "" | "Z" | "z" => 0,
            _ => {
                let sign = if zone.starts_with('-') { -1 } else { 1 };
                let (h, m) = zone[1..].split_once(':').unwrap_or((&zone[1..], "0"));
                sign * (h.parse::<i64>().ok()? * 3600 + m.parse::<i64>().ok()? * 60)
            }
        };
    }
    // Howard Hinnant's civil-to-days algorithm.
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    u64::try_from((days * 86_400 + clock - offset) * 1000).ok()
}

/// The mode that holds for a write to `project` at `now`: the project's own,
/// else the vault's, else balanced. When the vault's `until` has passed (or
/// cannot be read, which is taken as passed), an autonomous mode is balanced
/// again; a mode that is stricter than that (review) never ends by itself, so
/// a stale `until` can only ever make agents more careful, not less.
pub fn effective_mode(config: &Config, project: Option<&str>, now: Instant) -> AgentMode {
    let chosen = config.agent_mode_for(project);
    if chosen != AgentMode::Autonomous {
        return chosen;
    }
    let ended = config
        .agents
        .as_ref()
        .and_then(|a| a.until.as_deref())
        .is_some_and(|until| parse_time(until).is_none_or(|end| now.millis >= end));
    if ended { AgentMode::Balanced } else { chosen }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(text: &str) -> Config {
        serde_saphyr::from_str(text).unwrap()
    }

    fn commit(decision: Decision) -> Commit {
        match decision {
            Decision::Commit(c) => c,
            other => panic!("expected a commit, got {other:?}"),
        }
    }

    fn kind(decision: &Decision) -> &'static str {
        match decision {
            Decision::Commit(c) if c.auto_accepted => "auto",
            Decision::Commit(c) if c.autonomous => "lifted",
            Decision::Commit(_) => "commit",
            Decision::Propose(_) => "propose",
            Decision::Refuse(_) => "refuse",
        }
    }

    #[test]
    fn the_matrix() {
        let classes = || {
            [
                OpClass::Ordinary,
                OpClass::Soft("soft".into()),
                OpClass::Always("always".into()),
                OpClass::Hard("hard".into()),
            ]
        };
        let expected = [
            (
                AgentMode::Review,
                ["propose", "propose", "propose", "refuse"],
            ),
            (
                AgentMode::Balanced,
                ["commit", "propose", "propose", "refuse"],
            ),
            (
                AgentMode::Autonomous,
                ["lifted", "lifted", "auto", "refuse"],
            ),
        ];
        for (mode, want) in expected {
            let got: Vec<&str> = classes()
                .into_iter()
                .map(|class| kind(&decide(mode, class)))
                .collect();
            assert_eq!(got, want, "{mode:?}");
        }
        assert_eq!(
            commit(decide(AgentMode::Balanced, OpClass::Ordinary)),
            Commit {
                autonomous: false,
                auto_accepted: false
            }
        );
    }

    #[test]
    fn a_review_reason_is_the_ops_own_when_it_has_one() {
        let Decision::Propose(reason) = decide(AgentMode::Review, OpClass::Soft("why".into()))
        else {
            panic!()
        };
        assert_eq!(reason, "why");
        let Decision::Propose(reason) = decide(AgentMode::Review, OpClass::Ordinary) else {
            panic!()
        };
        assert!(reason.contains("every change"), "{reason}");
    }

    #[test]
    fn times_are_read_in_utc_with_offsets() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("1970-01-02"), Some(86_400_000));
        assert_eq!(parse_time("2025-09-24T08:12:05Z"), Some(1_758_701_525_000));
        assert_eq!(
            parse_time("2025-09-24T10:12:05+02:00"),
            Some(1_758_701_525_000)
        );
        assert_eq!(parse_time("2025-09-24 08:12"), Some(1_758_701_520_000));
        assert_eq!(
            parse_time("2000-02-29T00:00:00.500Z"),
            Some(951_782_400_000)
        );
        for bad in ["", "soon", "2025-13-01", "2025-09-24T25:00", "2025-09"] {
            assert_eq!(parse_time(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_project_beats_the_vault_and_a_time_box_runs_out() {
        let config = cfg(
            "agents:\n  mode: autonomous\n  until: 2026-12-01T00:00:00Z\n  projects:\n    thesis:\n      mode: review\n    talks:\n      mode: autonomous\n",
        );
        let before = Instant {
            millis: parse_time("2026-11-30T23:59:59Z").unwrap(),
        };
        let after = Instant {
            millis: parse_time("2026-12-01T00:00:00Z").unwrap(),
        };
        assert_eq!(effective_mode(&config, None, before), AgentMode::Autonomous);
        assert_eq!(
            effective_mode(&config, Some("thesis"), before),
            AgentMode::Review
        );
        assert_eq!(
            effective_mode(&config, Some("other"), before),
            AgentMode::Autonomous
        );
        assert_eq!(effective_mode(&config, None, after), AgentMode::Balanced);
        assert_eq!(
            effective_mode(&config, Some("talks"), after),
            AgentMode::Balanced
        );
        assert_eq!(
            effective_mode(&config, Some("thesis"), after),
            AgentMode::Review
        );
        // A time nobody can read does not keep the mode on.
        let broken = cfg("agents:\n  mode: autonomous\n  until: whenever\n");
        assert_eq!(effective_mode(&broken, None, before), AgentMode::Balanced);
        // A stale end on a vault kept on review never loosens it to balanced.
        let strict = cfg("agents:\n  mode: review\n  until: 2020-01-01\n");
        assert_eq!(effective_mode(&strict, None, after), AgentMode::Review);
        let unreadable = cfg("agents:\n  mode: review\n  until: whenever\n");
        assert_eq!(effective_mode(&unreadable, None, after), AgentMode::Review);
        // No end means no end; no key means balanced.
        let open = cfg("agents:\n  mode: autonomous\n");
        assert_eq!(effective_mode(&open, None, after), AgentMode::Autonomous);
        assert_eq!(
            effective_mode(&cfg("name: X\n"), None, after),
            AgentMode::Balanced
        );
    }
}
