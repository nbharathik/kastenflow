// The settings a thread's model answers with (reasoning effort, thinking
// budget, temperature, longest answer): small pure helpers for the Advanced
// popover and the store. What a model takes is capabilities.ts.

import type { Range } from "./capabilities";
import type { GenerationSettings } from "./types";

/** Nothing set: every provider's own defaults. */
export const NO_SETTINGS: Readonly<GenerationSettings> = Object.freeze({});

/** Whether anything is set. */
export const isSet = (settings: GenerationSettings) => Object.values(settings).some((v) => v !== undefined);

/** `settings` with `key` set to `value`, or cleared when `value` is undefined. */
export function setting<K extends keyof GenerationSettings>(settings: GenerationSettings, key: K, value: GenerationSettings[K] | undefined): GenerationSettings {
  const next: Record<string, unknown> = { ...settings };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as GenerationSettings;
}

/** A typed number held to a control's range; undefined for text that is not one. */
export function inRange(text: string, range: Range, whole = false): number | undefined {
  if (text.trim() === "") return undefined;
  const typed = Number(text);
  if (!Number.isFinite(typed)) return undefined;
  const value = Math.min(range.max, Math.max(range.min, typed));
  return whole ? Math.round(value) : Math.round(value * 100) / 100;
}

/** Stored or received settings, checked: anything else is left out. */
export function readSettings(raw: unknown): GenerationSettings {
  if (!raw || typeof raw !== "object") return {};
  const { reasoningEffort, thinkingBudget, temperature, maxOutputTokens } = raw as Record<string, unknown>;
  const out: GenerationSettings = {};
  if (reasoningEffort === "minimal" || reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high") out.reasoningEffort = reasoningEffort;
  if (typeof thinkingBudget === "number" && Number.isFinite(thinkingBudget)) out.thinkingBudget = thinkingBudget;
  if (typeof temperature === "number" && Number.isFinite(temperature)) out.temperature = temperature;
  if (typeof maxOutputTokens === "number" && Number.isFinite(maxOutputTokens)) out.maxOutputTokens = maxOutputTokens;
  return out;
}

/** A short line for what is set, for the button's title: "High effort · 8,000 thinking tokens". */
export function describe(settings: GenerationSettings): string {
  const parts: string[] = [];
  if (settings.reasoningEffort) parts.push(`${settings.reasoningEffort[0]!.toUpperCase()}${settings.reasoningEffort.slice(1)} effort`);
  if (settings.thinkingBudget !== undefined) parts.push(`${settings.thinkingBudget.toLocaleString("en")} thinking tokens`);
  if (settings.temperature !== undefined) parts.push(`temperature ${settings.temperature}`);
  if (settings.maxOutputTokens !== undefined) parts.push(`up to ${settings.maxOutputTokens.toLocaleString("en")} tokens`);
  return parts.join(" · ");
}
