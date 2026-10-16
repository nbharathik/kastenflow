// What a model takes: the controls the Advanced popover may show. The
// backend's capability map (app/src-tauri/src/chat/capabilities) is the
// authority; this reads its answer, keeps it for the session, and works out
// from it which controls are on offer. `allowed` is pure.

import type { ChatClient } from "./client";
import type { Effort, GenerationSettings } from "./types";

/** Which API a provider's requests go to. */
export type Route = { kind: "anthropicMessages" } | { kind: "chatCompletions"; official: boolean } | { kind: "chatGptResponses" };

export interface Range {
  min: number;
  max: number;
}

/** Tokens a model may think with. */
export interface Budget extends Range {
  default: number;
}

export interface ModelCapabilities {
  version: number;
  route: Route;
  model: string;
  /** The family the rule matched, such as "gpt-5" or "claude-sonnet-4". */
  family: string;
  /** True when the model's family is confirmed in the provider's documentation;
   * false when the controls are offered to be tried on first use. */
  verified: boolean;
  /** The efforts the model takes; null when it takes none. */
  reasoningEffort: Effort[] | null;
  thinking: Budget | null;
  temperature: Range | null;
  maxOutput: Range | null;
  /** This computer found that the model refused a reasoning effort. */
  effortRefused: boolean;
  /** Reads pictures. */
  vision?: boolean;
  /** Whether `vision` is known; false for a local server's models and the ChatGPT plan, which may not read pictures. */
  visionKnown?: boolean;
  /** Tokens the model can hold, as the backend's table has it. */
  contextWindow?: number;
}

/** What a model does with pictures: `reads` them, `unsure` (it may not), or `blind` (it does not). */
export function pictures(caps: ModelCapabilities | null): "reads" | "unsure" | "blind" {
  if (!caps || caps.vision === undefined) return "unsure";
  if (caps.vision) return caps.visionKnown === false ? "unsure" : "reads";
  return caps.visionKnown === false ? "unsure" : "blind";
}

/** What this computer has found out about a model taking a reasoning effort. */
export type Learned = "works" | "refused";

/** The controls on offer for a model, given what is set now. */
export interface Allowed {
  efforts: Effort[];
  /** Efforts are offered to be tried on first use, not known to work. */
  effortTried: boolean;
  thinking: Budget | null;
  /** Null when the model has none, or while thinking is on. */
  temperature: Range | null;
  maxOutput: Range | null;
}

export const NOTHING: Allowed = { efforts: [], effortTried: false, thinking: null, temperature: null, maxOutput: null };

/** Whether any control is on offer. */
export const anyControl = (a: Allowed) => a.efforts.length > 0 || a.thinking !== null || a.temperature !== null || a.maxOutput !== null;

/** The controls a model offers. Unknown capabilities offer none. `learned` is
 * what an earlier answer showed about reasoning effort: a refusal takes the
 * control away, a success takes the "tried on first use" off it. */
export function allowed(caps: ModelCapabilities | null, settings: GenerationSettings = {}, learned: Learned | null = null): Allowed {
  if (!caps) return NOTHING;
  const refused = learned === "refused" || caps.effortRefused;
  const efforts = refused ? [] : (caps.reasoningEffort ?? []);
  const thinkingOn = caps.thinking !== null && settings.thinkingBudget !== undefined;
  return {
    efforts,
    effortTried: efforts.length > 0 && !caps.verified && learned !== "works",
    thinking: caps.thinking,
    temperature: thinkingOn ? null : caps.temperature,
    maxOutput: caps.maxOutput,
  };
}

const within = (range: Range, value: number) => Number.isFinite(value) && value >= range.min && value <= range.max;

/** `settings` with whatever the model does not take, or out of range, left
 * out. Nothing is changed in what it keeps. */
export function pruned(settings: GenerationSettings, controls: Allowed): GenerationSettings {
  const out: GenerationSettings = {};
  if (settings.reasoningEffort && controls.efforts.includes(settings.reasoningEffort)) out.reasoningEffort = settings.reasoningEffort;
  if (settings.thinkingBudget !== undefined && controls.thinking && within(controls.thinking, settings.thinkingBudget)) out.thinkingBudget = settings.thinkingBudget;
  if (settings.temperature !== undefined && controls.temperature && within(controls.temperature, settings.temperature) && out.thinkingBudget === undefined) out.temperature = settings.temperature;
  if (settings.maxOutputTokens !== undefined && controls.maxOutput && within(controls.maxOutput, settings.maxOutputTokens)) out.maxOutputTokens = settings.maxOutputTokens;
  return out;
}

const keyOf = (provider: string, model: string) => `${provider}\u0000${model}`;

/** Answers kept for the session, until a turn may have taught the backend more. */
const known = new Map<string, Promise<ModelCapabilities | null>>();

/** What `provider`'s `model` takes. Null when it cannot be told (offline
 * preview, an unknown provider): then no control is offered. */
export function capabilitiesOf(client: ChatClient, provider: string, model: string): Promise<ModelCapabilities | null> {
  const key = keyOf(provider, model);
  let held = known.get(key);
  if (!held) {
    // An answer that could not be had is not kept: the next ask tries again.
    held = client
      .modelCapabilities(provider, model)
      .catch(() => null)
      .then((caps) => {
        if (!caps && known.get(key) === held) known.delete(key);
        return caps;
      });
    known.set(key, held);
  }
  return held;
}

/** Forgets what was found for a model, so the next ask reads the backend: a
 * turn may have taught it that the model takes (or refuses) an effort. */
export function forgetCapabilities(provider?: string, model?: string): void {
  if (provider === undefined || model === undefined) known.clear();
  else known.delete(keyOf(provider, model));
}
