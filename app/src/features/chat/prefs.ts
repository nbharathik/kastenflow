// The provider and model used last, which new chats start with. A
// preference of this window, kept in the browser's storage like the panel's
// tab; stored values are checked, since anything may be there.

import type { Learned } from "./capabilities";
import { isSet, readSettings } from "./settings";
import type { ChatProvider, GenerationSettings } from "./types";

const KEY = "kasten.chat.model";
const SETTINGS_KEY = "kasten.chat.settings";
const EFFORT_KEY = "kasten.chat.effort";
/** How many models' settings (and findings) are kept. */
const KEPT = 40;

export interface ModelChoice {
  provider: string;
  model: string;
}

export function lastModel(): ModelChoice | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!saved || typeof saved !== "object") return null;
    const { provider, model } = saved as Record<string, unknown>;
    return typeof provider === "string" && provider && typeof model === "string" ? { provider, model } : null;
  } catch {
    return null;
  }
}

export function keepModel(choice: ModelChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // New chats start with the first provider instead.
  }
}

const pairKey = (provider: string, model: string) => `${provider}\u0000${model}`;

/** A map kept in browser storage under `key`, read leniently: anything that
 * is not a plain object is nothing. */
function readMap(key: string): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Writes `map` with the newest `KEPT` entries (the last keys written). */
function writeMap(key: string, map: Record<string, unknown>): void {
  const keys = Object.keys(map);
  const kept = Object.fromEntries(keys.slice(Math.max(0, keys.length - KEPT)).map((k) => [k, map[k]]));
  try {
    localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // The next chat starts from the provider's defaults instead.
  }
}

/** The settings last used with `model` at `provider`, which a new chat with
 * it starts from; none when nothing was kept. */
export function savedSettings(provider: string, model: string): GenerationSettings {
  return readSettings(readMap(SETTINGS_KEY)[pairKey(provider, model)]);
}

/** Remembers the settings used with `model` at `provider`; nothing set forgets them. */
export function keepSettings(provider: string, model: string, settings: GenerationSettings): void {
  const map = readMap(SETTINGS_KEY);
  const key = pairKey(provider, model);
  delete map[key];
  if (isSet(settings)) map[key] = settings;
  writeMap(SETTINGS_KEY, map);
}

/** What this computer found out about `model` taking a reasoning effort. */
export function learnedEffort(provider: string, model: string): Learned | null {
  const found = readMap(EFFORT_KEY)[pairKey(provider, model)];
  return found === "works" || found === "refused" ? found : null;
}

/** Remembers that `model` takes a reasoning effort, or does not. */
export function learnEffort(provider: string, model: string, found: Learned): void {
  const map = readMap(EFFORT_KEY);
  const key = pairKey(provider, model);
  delete map[key];
  map[key] = found;
  writeMap(EFFORT_KEY, map);
}

/** The provider and model a thread uses: its own choice while that provider
 * exists, else the last one used, else the first provider's; null when no
 * provider is set up. An empty model means the provider's own. */
export function modelFor(thread: { provider: string | null; model: string | null }, providers: readonly ChatProvider[] | null, last: ModelChoice | null = lastModel()): ModelChoice | null {
  if (!providers || providers.length === 0) return null;
  const pick = (name: string | null | undefined) => (name ? providers.find((p) => p.name === name) : undefined);
  const own = pick(thread.provider);
  if (own) return { provider: own.name, model: thread.model?.trim() || own.model };
  const kept = pick(last?.provider);
  if (kept) return { provider: kept.name, model: last!.model.trim() || kept.model };
  return { provider: providers[0]!.name, model: providers[0]!.model };
}
