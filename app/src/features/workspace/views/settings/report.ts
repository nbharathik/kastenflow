// The connection report in words: what each request reached, how it ended,
// the tries it took and how long. The backend keeps only numbers, model and
// route names and short reasons (never a token, email, prompt or answer), so
// the text to copy has nothing private in it.

import type { RequestOutcome, RequestStage } from "../../../chat/agent-types";

const STAGES: Record<RequestStage, string> = { signIn: "Sign-in", renewal: "Renewing the sign-in", modelList: "Model list", request: "Request", stream: "Answer" };

const KINDS: Record<string, string> = {
  cancelled: "cancelled",
  connection: "connection",
  modelUnavailable: "model not available",
  permission: "not allowed",
  rateLimited: "rate limit",
  tooLong: "too long",
  refused: "refused",
  other: "error",
};

export const stageOf = (stage: RequestStage): string => STAGES[stage] ?? stage;

/** How the request ended: "Worked", or "Failed: connection (503, closed)". */
export function resultOf(outcome: RequestOutcome): string {
  if (outcome.ok) return "Worked";
  const why = outcome.kind ? (KINDS[outcome.kind] ?? outcome.kind) : "";
  const detail = [outcome.status !== null ? String(outcome.status) : "", outcome.reason].filter(Boolean).join(", ");
  return `Failed${why ? `: ${why}` : ""}${detail ? ` (${detail})` : ""}`;
}

/** "4 tries, connection made again". */
export function triesOf(outcome: RequestOutcome): string {
  return [`${outcome.attempts} ${outcome.attempts === 1 ? "try" : "tries"}`, outcome.renewed ? "token renewed" : "", outcome.rebuilt ? "connection made again" : ""].filter(Boolean).join(", ");
}

const span = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

/** "0.5 s to the first word, 4.2 s in all". */
export function speedOf(outcome: RequestOutcome): string {
  return [outcome.firstByteMs !== null ? `${span(outcome.firstByteMs)} to the first word` : "", `${span(outcome.totalMs)} in all`].filter(Boolean).join(", ");
}

const two = (n: number) => String(n).padStart(2, "0");

/** The time of day, 14:05:09. */
export function clockOf(at: number): string {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

const dayOf = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

/** The report as text to copy into a message: one line a request. */
export function reportText(outcomes: readonly RequestOutcome[]): string {
  const title = "KastenFlow connection report";
  if (outcomes.length === 0) return `${title}\nNo requests yet.`;
  return [title, ...outcomes.map((o) => [`${dayOf(o.at)} ${clockOf(o.at)}`, o.provider, o.model, o.route, stageOf(o.stage), resultOf(o), triesOf(o), speedOf(o)].join(" | "))].join("\n");
}
