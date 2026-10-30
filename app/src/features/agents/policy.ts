// How much agents may do: the words for each mode, the time box for autonomous
// mode, and the arithmetic of "until" (the core decides what holds; this only
// says it and builds what the person picked).

import type { AgentMode, AgentPolicy, AgentPolicyView } from "../../lib/vault/types";

export const MODE_NAMES: Record<AgentMode, string> = {
  review: "Review everything",
  balanced: "Balanced",
  autonomous: "Autonomous",
};

/** One plain sentence for each. */
export const MODE_SENTENCES: Record<AgentMode, string> = {
  review: "Every change an agent wants to make waits for you to look at it first.",
  balanced: "Small changes go straight in. Big or risky ones wait for you.",
  autonomous: "Agents work freely, and you can undo it all. A restore point is saved before they start.",
};

export type TimeBox = "hour" | "eight" | "open";

export const TIME_BOXES: readonly { id: TimeBox; label: string }[] = [
  { id: "hour", label: "1 hour" },
  { id: "eight", label: "8 hours" },
  { id: "open", label: "Until I turn it off" },
];

const HOUR = 3_600_000;

/** The `until` a time box means when picked at `now`: null is without end. */
export function untilFor(box: TimeBox, now: number): string | null {
  if (box === "open") return null;
  return new Date(now + (box === "hour" ? HOUR : 8 * HOUR)).toISOString();
}

/** Milliseconds for an `until`, or null when it is empty or cannot be read. */
export function timeOf(until: string | null): number | null {
  if (!until) return null;
  const text = until.trim().replace(" ", "T");
  // The core reads a time with no zone as UTC (a date alone is its midnight, UTC); so does this.
  const zoned = !text.includes("T") || /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text) ? text : `${text}Z`;
  const ms = Date.parse(zoned);
  return Number.isNaN(ms) ? null : ms;
}

/** The time box that shows as picked for an `until` set at some time: none means without end, a short wait is the hour. */
export function boxOf(until: string | null, now: number): TimeBox {
  const end = timeOf(until);
  if (end === null) return "open";
  return end - now <= 90 * 60_000 ? "hour" : "eight";
}

/** Whether an `until` has passed (one that cannot be read counts as passed). */
export function ended(until: string | null, now: number): boolean {
  if (!until) return false;
  const end = timeOf(until);
  return end === null || now >= end;
}

/** Whether autonomous agents are at work anywhere now, as the core said when it was last asked, and the clock since. */
export function autonomousOn(view: AgentPolicyView | null, now: number): boolean {
  if (!view) return false;
  const anywhere = view.active === "autonomous" || view.autonomousProjects.length > 0;
  return anywhere && !ended(view.until, now);
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DAY_CLOCK = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const DATE_CLOCK = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** "until 3:45 PM", "until Thu 9:00 AM", or "until you turn it off". */
export function untilWords(until: string | null, now: number): string {
  const end = timeOf(until);
  if (end === null) return "until you turn it off";
  const when = new Date(end);
  const sameDay = when.toDateString() === new Date(now).toDateString();
  if (sameDay) return `until ${CLOCK.format(when)}`;
  return `until ${(end - now < 6 * 24 * HOUR ? DAY_CLOCK : DATE_CLOCK).format(when)}`;
}

/** Where autonomous agents work: everything, or the projects (by their titles). */
export function scopeWords(view: AgentPolicyView, titleOf: (folder: string) => string): string {
  if (view.active === "autonomous") return "all your notes";
  return view.autonomousProjects.map(titleOf).join(", ");
}

/** The policy with every autonomous scope turned down to balanced, for "Turn off". */
export function turnedOff(policy: AgentPolicy): AgentPolicy {
  const projects = Object.fromEntries(Object.entries(policy.projects).filter(([, mode]) => mode !== "autonomous"));
  return { mode: policy.mode === "autonomous" ? "balanced" : policy.mode, until: null, projects };
}

/** The policy when the vault's mode is picked. Autonomous brings its time box (an hour until another is chosen). */
export function withMode(policy: AgentPolicy, mode: AgentMode, box: TimeBox, now: number): AgentPolicy {
  return { ...policy, mode, until: mode === "autonomous" ? untilFor(box, now) : null };
}

/** The policy with one project's own mode, or none to follow the vault's. */
export function withProject(policy: AgentPolicy, folder: string, mode: AgentMode | null, box: TimeBox, now: number): AgentPolicy {
  const projects = { ...policy.projects };
  if (mode === null) delete projects[folder];
  else projects[folder] = mode;
  // A time box belongs to autonomous work: the first autonomous scope starts one, the last one to go ends it.
  const was = policy.mode === "autonomous" || Object.values(policy.projects).includes("autonomous");
  const is = policy.mode === "autonomous" || Object.values(projects).includes("autonomous");
  const until = !is ? null : was ? policy.until : untilFor(box, now);
  return { ...policy, projects, until };
}
