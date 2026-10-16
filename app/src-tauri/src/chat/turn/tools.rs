//! Running a step's tool calls: one at a time, except calls that only read
//! (`readOnlyHint`), which run together up to four at once with their results
//! given back in the model's order. `update_plan` is the chat's own tool and
//! never reaches the vault. Every call gets a result, run or not, so the
//! thread stays whole.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use kasten_mcp::tools::{Writes, call_with};
use serde_json::{Value, json};
use tokio::task::JoinHandle;

use super::{Turn, changes_info};
use crate::chat::budget::{LoopGuard, Meter, Pause};
use crate::chat::model::{ToolCall, ToolOutput};
use crate::chat::plan::{self, PlanItem};
use crate::chat::summary::{Described, describe};
use crate::chat::{EventKind, ToolResultInfo, ToolUse};

/// A tool result longer than this is cut, so one read cannot fill the
/// model's context.
const RESULT_LIMIT: usize = 50_000;

/// How often a running tool is told the person has stopped the turn.
const STOP_LOOK: Duration = Duration::from_millis(100);

/// The most calls that run at once.
pub const MAX_PARALLEL: usize = 4;

type Ran = (Result<Value, String>, Described);

fn not_run(call: &ToolCall, why: &str) -> ToolOutput {
    ToolOutput {
        id: call.id.clone(),
        content: format!("Not run: {why}"),
        is_error: true,
    }
}

/// A result as the model reads it: compact JSON, cut if it is huge.
fn content(value: &Value) -> String {
    let text = value.to_string();
    match text.char_indices().nth(RESULT_LIMIT) {
        Some((at, _)) => format!(
            "{}\n[Cut: the result had {} characters. Ask for less, such as with a smaller limit.]",
            &text[..at],
            text.chars().count()
        ),
        None => text,
    }
}

/// What a call whose arguments are not JSON comes to. As Anthropic suggests:
/// the input back, so the model can mend it.
fn invalid(call: &ToolCall) -> Ran {
    (
        Err(json!({"INVALID_JSON": call.arguments}).to_string()),
        Described {
            ok: false,
            summary: format!(
                "Could not run {}: its arguments were not valid JSON",
                call.name
            ),
            paths: vec![],
            staged: false,
        },
    )
}

impl Turn<'_> {
    /// Whether the call only reads, so it may run beside others.
    fn reads(&self, call: &ToolCall) -> bool {
        call.name != plan::TOOL
            && self
                .tools
                .iter()
                .any(|t| t.name == call.name && t.read_only)
    }

    /// Runs `calls` in order, reads together. Each gets a result. The pause
    /// is the budget that ran out, if one did: the calls after it did not run.
    pub(super) async fn run_calls(
        &self,
        calls: &[ToolCall],
        meter: &mut Meter,
        watch: &mut LoopGuard,
        plan: &mut Vec<PlanItem>,
    ) -> (Vec<ToolOutput>, Option<Pause>) {
        let mut outputs = Vec::with_capacity(calls.len());
        let mut pause = None;
        let mut at = 0;
        while at < calls.len() {
            let call = &calls[at];
            if call.name == plan::TOOL {
                let output = self.plan_call(call, plan);
                watch.saw(call, &output);
                outputs.push(output);
                at += 1;
                continue;
            }
            if self.stopped() {
                outputs.push(not_run(call, "the user stopped this turn"));
                at += 1;
                continue;
            }
            if let Err(limit) = meter.call() {
                outputs.push(not_run(
                    call,
                    "this turn paused at its limit; call again if it is still needed",
                ));
                pause.get_or_insert(limit);
                at += 1;
                continue;
            }
            // The calls after this one that only read run beside it.
            let mut end = at + 1;
            if self.reads(call) {
                let room = (meter.calls_left() as usize).min(MAX_PARALLEL);
                while end < calls.len() && end - at < room && self.reads(&calls[end]) {
                    end += 1;
                }
            }
            let group = &calls[at..end];
            for _ in group {
                meter.took_call();
            }
            let results = self.run_group(group).await;
            for (call, output) in group.iter().zip(results) {
                watch.saw(call, &output);
                outputs.push(output);
            }
            at = end;
        }
        (outputs, pause)
    }

    /// The chat's own `update_plan`: replaces the plan and tells the window.
    fn plan_call(&self, call: &ToolCall, plan: &mut Vec<PlanItem>) -> ToolOutput {
        let made = call
            .input()
            .map_err(|_| "update_plan's arguments were not valid JSON".to_owned())
            .and_then(|input| plan::update(plan, &input));
        match made {
            Ok(next) => {
                *plan = next;
                self.emit(EventKind::Plan, |e| e.plan = Some(plan.clone()));
                ToolOutput {
                    id: call.id.clone(),
                    content: plan::answer(plan),
                    is_error: false,
                }
            }
            Err(why) => ToolOutput {
                id: call.id.clone(),
                content: why,
                is_error: true,
            },
        }
    }

    /// Starts the tool on a thread of its own.
    fn start(&self, call: &ToolCall, input: Value, stop: &Arc<AtomicBool>) -> JoinHandle<Ran> {
        let kasten = Arc::clone(self.kasten);
        let session = self.session.clone();
        let name = call.name.clone();
        let staging = self.changes.map(Arc::clone);
        let withdrawn = Arc::clone(stop);
        tokio::task::spawn_blocking(move || {
            let writes = match &staging {
                Some(set) => Writes::Staged(set.as_ref()),
                None => Writes::Direct,
            };
            let result = call_with(
                &kasten,
                &session,
                writes,
                Some(withdrawn.as_ref()),
                &name,
                input.clone(),
            );
            let described = describe(&kasten, &name, &input, &result);
            (result, described)
        })
    }

    /// Waits for a tool, telling it when the person stops the turn.
    async fn wait(&self, running: &mut JoinHandle<Ran>, stop: &AtomicBool, call: &ToolCall) -> Ran {
        let ran = loop {
            match tokio::time::timeout(STOP_LOOK, &mut *running).await {
                Ok(done) => break done,
                Err(_) => {
                    if self.stopped() {
                        stop.store(true, Ordering::SeqCst);
                    }
                }
            }
        };
        ran.unwrap_or_else(|err| {
            let why = format!("The tool stopped: {err}");
            let summary = format!("Could not run {}: {why}", call.name);
            let described = Described {
                ok: false,
                summary,
                paths: vec![],
                staged: false,
            };
            (Err(why), described)
        })
    }

    /// Runs a group of calls together and reports each, in order.
    async fn run_group(&self, group: &[ToolCall]) -> Vec<ToolOutput> {
        for call in group {
            let shown = call
                .input()
                .unwrap_or_else(|_| Value::String(call.arguments.clone()));
            self.emit(EventKind::Tool, |e| {
                e.tool = Some(ToolUse {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    input: shown,
                })
            });
        }
        // The tools run on threads of their own and cannot see the turn's stop flag, so a copy
        // is set from here while they run: a slide that has not been started drawing is then not.
        let stop = Arc::new(AtomicBool::new(self.stopped()));
        let mut started = Vec::with_capacity(group.len());
        for call in group {
            started.push(
                call.input()
                    .ok()
                    .map(|input| self.start(call, input, &stop)),
            );
        }
        let mut outputs = Vec::with_capacity(group.len());
        for (call, handle) in group.iter().zip(started) {
            let (result, described) = match handle {
                Some(mut running) => self.wait(&mut running, &stop, call).await,
                None => invalid(call),
            };
            outputs.push(self.report(call, result, described));
        }
        outputs
    }

    /// Tells the person how a call went and builds what the model reads.
    fn report(
        &self,
        call: &ToolCall,
        result: Result<Value, String>,
        described: Described,
    ) -> ToolOutput {
        let staged = described.staged;
        self.emit(EventKind::ToolResult, |e| {
            e.result = Some(ToolResultInfo {
                id: call.id.clone(),
                ok: described.ok,
                summary: described.summary,
                paths: described.paths,
                staged,
            })
        });
        // The bar above the message box follows what has been staged.
        if staged && let Some(changes) = self.changes {
            let info = changes_info(changes);
            self.emit(EventKind::Changes, |e| e.changes = Some(info));
        }
        match result {
            Ok(value) => ToolOutput {
                id: call.id.clone(),
                content: content(&value),
                is_error: false,
            },
            Err(error) => ToolOutput {
                id: call.id.clone(),
                content: error,
                is_error: true,
            },
        }
    }
}
