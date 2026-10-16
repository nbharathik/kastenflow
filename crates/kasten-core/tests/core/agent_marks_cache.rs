//! The agent marks cache carries marks on from the commit it was made at;
//! it must answer exactly as a walk from scratch would. Two copies of the
//! vault take the same random run of agent and person edits: one reads
//! through its cache, the other forgets it before every read.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome, frontmatter};
use serde_json::Map;

const BODY: &str = "Intro.\n\n## Notes\n\n- first\n- second\n\n## Later\n\nTail.\n";

/// xorshift64*: the same run every time.
struct Dice(u64);

impl Dice {
    fn roll(&mut self, n: usize) -> usize {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 33) as usize % n
    }
}

struct Copy {
    _t: common::TempVault,
    k: Kasten,
    path: String,
}

/// Runs an agent op, accepting it if it waits for review.
fn agent(k: &Kasten, s: &Session, op: AgentOp) -> serde_json::Value {
    match k.agent_run(s, &op, NOW).unwrap() {
        Outcome::Done { result } => result,
        Outcome::PendingReview { proposal, .. } => {
            k.accept_proposal(&proposal, "you", NOW).unwrap()
        }
        Outcome::Staged { .. } => unreachable!("agent_run never stages"),
    }
}

fn body(k: &Kasten, path: &str) -> String {
    frontmatter::split(&k.read(path).unwrap().text)
        .body
        .to_owned()
}

fn save(k: &Kasten, path: &str, body: &str) {
    let note = k.read(path).unwrap();
    k.save_body(&Actor::Human, path, body, &note.hash, NOW)
        .unwrap();
}

/// One step of the run, the same on each copy.
fn step(c: &mut Copy, what: usize, n: usize, pick: usize, sessions: &[Session; 2]) {
    let (k, path) = (&c.k, c.path.clone());
    let s = &sessions[n % 2];
    let append = |markdown: String, heading: Option<&str>| AgentOp::Append {
        path: path.clone(),
        markdown,
        heading: heading.map(Into::into),
    };
    match what {
        0 => drop(agent(k, s, append(format!("Agent paragraph {n}."), None))),
        1 => drop(agent(
            k,
            s,
            append(format!("- agent item {n}"), Some("Notes")),
        )),
        2 => {
            let text = body(k, &path);
            let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
            let old = lines[pick % lines.len()];
            let new = if old.starts_with('#') {
                old.to_owned()
            } else {
                format!("{old} (mine {n})")
            };
            save(k, &path, &text.replacen(old, &new, 1));
        }
        3 => save(
            k,
            &path,
            &format!("{}\nMy paragraph {n}.\n", body(k, &path)),
        ),
        4 => drop(k.commit_edits().unwrap()),
        5 => k.accept_agent_marks(&Actor::Human, &path, NOW).unwrap(),
        6 => {
            let op = AgentOp::ReplaceSection {
                path: path.clone(),
                heading: "Later".into(),
                markdown: format!("Agent section {n}.\n"),
            };
            drop(agent(k, s, op));
        }
        7 => {
            // A full rewrite of one line, accepted from review.
            k.commit_edits().unwrap();
            let old = body(k, &path);
            let lines: Vec<&str> = old
                .lines()
                .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
                .collect();
            let line = lines[pick % lines.len()];
            let op = AgentOp::Edit {
                path: path.clone(),
                body: old.replacen(line, &format!("Agent rewrite {n}."), 1),
                base: old.clone(),
                reason: None,
            };
            drop(agent(k, s, op));
        }
        _ => {
            k.commit_edits().unwrap();
            let renamed = k
                .rename(&Actor::Human, &path, &format!("Run {n}"), NOW)
                .unwrap();
            c.path = renamed.note.meta.path;
        }
    }
}

fn run(seed: u64, steps: usize) {
    let sessions = [
        Session::start("claude-code", NOW),
        Session::start("claude-desktop", NOW),
    ];
    let mut copies: Vec<Copy> = (0..2)
        .map(|_| {
            let t = dev_vault();
            let k = Kasten::open(t.vault.root()).unwrap();
            k.start_history().unwrap();
            let made = agent(
                &k,
                &sessions[0],
                AgentOp::CreateNote {
                    note_type: "page".into(),
                    title: "Run".into(),
                    body: BODY.into(),
                    project: None,
                    tags: vec![],
                    props: Map::new(),
                    parent: None,
                    template: None,
                },
            );
            let path = made["path"].as_str().unwrap().to_owned();
            Copy { _t: t, k, path }
        })
        .collect();
    let mut dice = Dice(seed);
    let mut marked_steps = 0;
    for n in 0..steps {
        let (what, pick) = (dice.roll(9), dice.roll(1000));
        for copy in &mut copies {
            step(copy, what, n, pick, &sessions);
        }
        let [cached, fresh] = [&copies[0], &copies[1]];
        assert_eq!(body(&cached.k, &cached.path), body(&fresh.k, &fresh.path));
        fresh.k.forget_agent_marks().unwrap();
        let shape = |c: &Copy| -> Vec<(usize, usize, String)> {
            let marks = c.k.agent_marks(&c.path).unwrap();
            marks
                .into_iter()
                .map(|m| (m.start, m.end, m.session))
                .collect()
        };
        marked_steps += usize::from(!shape(cached).is_empty());
        assert_eq!(
            shape(cached),
            shape(fresh),
            "seed {seed}, step {n} (kind {what}):\n{}",
            body(&cached.k, &cached.path)
        );
        let marked = |c: &Copy| {
            c.k.agent_marked(std::slice::from_ref(&c.path))
                .unwrap()
                .len()
        };
        assert_eq!(marked(cached), marked(fresh));
    }
    assert!(
        marked_steps * 3 > steps,
        "seed {seed}: marks at only {marked_steps} steps"
    );
}

#[test]
fn cached_marks_match_a_fresh_walk_through_random_edits() {
    for seed in [0x9e37_79b9_7f4a_7c15, 42, 7_777_777] {
        run(seed, 40);
    }
}
