// Reading the agent harness's events: the plan, a pause, the step it is on and
// a connection tried again. The backend's payloads are read leniently (any
// shape that is not what was promised is nothing, never an error), so one odd
// event cannot break a thread.

import type { Paused, PauseReason, PlanItem, PlanStatus } from "./agent-types";
import type { ChatEvent } from "./types";

const STATUSES: ReadonlySet<string> = new Set<PlanStatus>(["todo", "doing", "done"]);
const REASONS: ReadonlySet<string> = new Set<PauseReason>(["rounds", "calls", "minutes", "loop", "length", "interrupted"]);

const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The plan a `plan` event carries: its items, as a list (or as `{items}`); none when it is neither. */
export function planOf(raw: unknown): PlanItem[] | null {
  const list = Array.isArray(raw) ? raw : Array.isArray(object(raw).items) ? (object(raw).items as unknown[]) : null;
  if (!list) return null;
  return list.flatMap((item, i): PlanItem[] => {
    const { id, text, status } = object(item);
    if (typeof text !== "string" || !text.trim()) return [];
    return [{ id: typeof id === "string" && id ? id : String(i + 1), text: text.trim(), status: typeof status === "string" && STATUSES.has(status) ? (status as PlanStatus) : "todo" }];
  });
}

/** What to say when the backend did not say it, by why the turn paused. */
const DETAIL: Record<PauseReason, string> = {
  rounds: "Paused: it reached the limit on steps. Continue to let it go on.",
  calls: "Paused: it reached the limit on tool calls. Continue to let it go on.",
  minutes: "Paused: it reached the time limit. Continue to let it go on.",
  loop: "Paused: it was repeating a call that gave the same result. Continue to let it try again, or change what you ask.",
  length: "Paused: the answer grew too long for one go. Continue to let it go on.",
  interrupted: "Interrupted: the app closed while it worked. Continue to let it go on.",
};

export const pauseDetail = (reason: PauseReason): string => DETAIL[reason];

/** Why a turn paused. A reason that is not known counts as an interruption. */
export function pausedOf(event: ChatEvent): Paused {
  const why: PauseReason = typeof event.reason === "string" && REASONS.has(event.reason) ? (event.reason as PauseReason) : "interrupted";
  return { reason: why, detail: typeof event.detail === "string" && event.detail.trim() ? event.detail.trim() : DETAIL[why] };
}

/** The step a `round` event says the model is on. */
export function roundOf(event: ChatEvent): number | null {
  return typeof event.n === "number" && Number.isFinite(event.n) ? event.n : null;
}

/** A message sent while the turn worked: what it said, and whether the turn has taken it up. */
export function queuedOf(event: ChatEvent): { text: string; delivered: boolean } | null {
  const text = event.text?.trim();
  return text ? { text, delivered: event.delivered === true } : null;
}

/** The line a `notice` with the code `retry` says: "Connection dropped, trying again (2 of 4)". */
export function retryOf(event: ChatEvent): string | null {
  return event.kind === "notice" && event.code === "retry" && event.text?.trim() ? event.text.trim() : null;
}
