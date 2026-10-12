// A person's keys (keymap.ts), kept with the window's other preferences in
// the browser's storage: they belong to this computer, not to the vault.

import { create } from "zustand";

import { assign, formatBinding, isMac, lookupFor, resolveKeymap, type Keymap } from "./keymap";

const KEY = "kasten.keys";

function load(): Keymap {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Keymap) : {};
  } catch {
    return {};
  }
}

function save(overrides: Keymap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    // The keys fall back to their defaults next time.
  }
}

interface KeysState {
  /** What the person changed, by command id. */
  overrides: Keymap;
  /** Every command's keys. */
  keymap: Record<string, string[]>;
  /** Which command each key runs. */
  lookup: Map<string, string>;
  /** Gives a command one key (taking it from any other), clears its keys
   * (null) or resets them (undefined). Returns the commands that lost it. */
  set(id: string, binding: string | null | undefined): string[];
  resetAll(): void;
}

function build(overrides: Keymap) {
  const keymap = resolveKeymap(overrides, isMac());
  return { overrides, keymap, lookup: lookupFor(keymap) };
}

export const useKeys = create<KeysState>()((set, get) => ({
  ...build(load()),
  set(id, binding) {
    const { overrides, took } = assign(get().overrides, id, binding, isMac());
    set(build(overrides));
    save(overrides);
    return took;
  },
  resetAll() {
    set(build({}));
    save({});
  },
}));

/** A command's first key as this system writes it, or "" when it has none. */
export function keyLabel(keymap: Keymap, id: string): string {
  const first = keymap[id]?.[0];
  return first ? formatBinding(first, isMac()) : "";
}

/** A command's first key, kept current as the person changes keys. */
export const useKeyLabel = (id: string) => useKeys((s) => keyLabel(s.keymap, id));

/** "Show sidebar (Ctrl+\)", or just the label when the command has no key. */
export const withKey = (label: string, key: string) => (key ? `${label} (${key})` : label);

/** A button's tooltip with the command's key, read as the button renders. */
export const keyTitle = (label: string, id: string) => withKey(label, keyLabel(useKeys.getState().keymap, id));

/** A menu item's hint: the command's key, read as the menu opens. */
export const keyHint = (id: string) => keyLabel(useKeys.getState().keymap, id) || undefined;
