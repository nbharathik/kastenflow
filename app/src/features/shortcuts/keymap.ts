// App-wide keys as data, so every shortcut can be changed. A key
// is a string such as "Mod+Shift+N", where Mod is Cmd on macOS and Ctrl
// elsewhere; Ctrl on its own only means something on macOS. The defaults
// below are Kasten's own; a person's changes go on top. Pure functions:
// the store keeps the changes and the window's handler looks keys up here.

export type Keymap = Readonly<Record<string, readonly string[]>>;

/** Keys that start each command, by command id. */
export const DEFAULT_KEYS: Keymap = {
  palette: ["Mod+K", "Mod+P"],
  "new-page": ["Mod+Shift+N"],
  "new-card": ["Mod+N"],
  "import-pdf": ["Mod+O"],
  journal: ["Mod+J"],
  "prev-day": ["Mod+Alt+ArrowUp"],
  "next-day": ["Mod+Alt+ArrowDown"],
  search: ["Mod+Shift+F"],
  back: ["Alt+ArrowLeft"],
  forward: ["Alt+ArrowRight"],
  sidebar: ["Mod+\\"],
  panel: ["Mod+."],
  "page-history": ["Mod+Shift+H"],
  focus: ["Mod+Shift+\\"],
  "toggle-properties": ["Mod+Alt+P"],
  theme: ["Mod+Shift+L"],
  save: ["Mod+S"],
  shortcuts: ["Mod+Shift+/"],
  "new-tab": ["Mod+T"],
  "close-tab": ["Mod+W"],
  "reopen-tab": ["Mod+Shift+T"],
  "next-tab": ["Ctrl+Tab", "Mod+PageDown"],
  "prev-tab": ["Ctrl+Shift+Tab", "Mod+PageUp"],
  split: ["Mod+Alt+ArrowRight"],
  stack: ["Mod+Shift+."],
  "chat-dock": ["Mod+Shift+A"],
  // Ctrl+Shift+L is the theme's; the selection goes with Alt.
  "chat-add-selection": ["Mod+Alt+L"],
  "zoom-in": ["Mod+=", "Mod+Shift+="],
  "zoom-out": ["Mod+-"],
  "zoom-reset": ["Mod+0"],
};

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const MODS = ["Mod", "Ctrl", "Alt", "Shift"] as const;

/** What Shift types on a US keyboard, back to the key that was pressed. */
const SHIFTED: Record<string, string> = {
  "?": "/", ">": ".", "<": ",", "|": "\\", "{": "[", "}": "]", '"': "'", ":": ";", "+": "=", _: "-", "~": "`",
  "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
};

const NAMED = /^(?:Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Left|Right|Up|Down)|F\d{1,2})$/;
const MODIFIERS = new Set(["Control", "Shift", "Alt", "AltGraph", "Meta", "OS", "Super", "Hyper", "Fn", "CapsLock"]);

/** A binding's shape: modifiers in order, then one key. */
const FORMAT = /^(?:Mod\+)?(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9]|[^\sA-Za-z0-9+]|Space|Plus|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Left|Right|Up|Down)|F\d{1,2})$/;

type Press = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

function keyName(event: Press, mac: boolean): string | null {
  // Option on macOS types a character (⌥K is "˚"); the key under it is meant.
  if (mac && event.altKey) {
    const under = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code ?? "");
    if (under) return under[1] ?? under[2]!;
  }
  const { key } = event;
  if (key === " ") return "Space";
  if (key.length === 1) {
    const base = event.shiftKey ? (SHIFTED[key] ?? key) : key;
    return base === "+" ? "Plus" : base.toUpperCase();
  }
  return NAMED.test(key) ? key : null;
}

/** The binding a key press makes, or null for a modifier on its own or a
 * key without a name (a dead key, an input method's). */
export function bindingOf(event: Press, mac: boolean): string | null {
  if (MODIFIERS.has(event.key)) return null;
  const key = keyName(event, mac);
  if (!key) return null;
  const held = { Mod: mac ? event.metaKey : event.ctrlKey || event.metaKey, Ctrl: mac && event.ctrlKey, Alt: event.altKey, Shift: event.shiftKey };
  return [...MODS.filter((m) => held[m]), key].join("+");
}

const MAC_ORDER = ["Ctrl", "Alt", "Shift", "Mod"] as const;
const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", PageUp: "PgUp", PageDown: "PgDn", Escape: "Esc", Enter: "↵", Plus: "+",
};

/** A binding as the system writes it: "Ctrl+Shift+N", or "⇧⌘N" on macOS. */
export function formatBinding(binding: string, mac: boolean): string {
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  const label = KEY_LABELS[key] ?? key;
  if (mac) return MAC_ORDER.filter((m) => parts.includes(m)).map((m) => MAC_SYMBOLS[m]).join("") + label;
  return [...parts.map((m) => (m === "Mod" ? "Ctrl" : m)), label].join("+");
}

/** Whether a binding may run a command: it needs Ctrl, Cmd or Alt (or is a
 * function key), so ordinary typing never does. */
export function canBind(binding: string): boolean {
  if (!FORMAT.test(binding)) return false;
  if (/(?:^|\+)F\d{1,2}$/.test(binding)) return true;
  return /^(?:Mod|Ctrl|Alt)\+/.test(binding);
}

/** A binding as this system reads it: off macOS, Ctrl is Mod. */
function canonical(binding: string, mac: boolean): string {
  if (mac || !binding.includes("Ctrl+")) return binding;
  const parts = binding.split("+");
  const key = parts.pop()!;
  const held = new Set(parts.map((p) => (p === "Ctrl" ? "Mod" : p)));
  return [...MODS.filter((m) => held.has(m)), key].join("+");
}

const unique = (keys: readonly string[]) => [...new Set(keys)];

/** Every command's keys: its defaults, or what the person chose instead.
 * Stored keys that are not keys are left out. */
export function resolveKeymap(overrides: Keymap, mac: boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, keys] of Object.entries(DEFAULT_KEYS)) out[id] = unique(keys.map((k) => canonical(k, mac)));
  for (const [id, keys] of Object.entries(overrides)) {
    if (!Array.isArray(keys)) continue;
    out[id] = unique(keys.filter((k): k is string => typeof k === "string" && canBind(k)).map((k) => canonical(k, mac)));
  }
  return out;
}

/** Which command each key runs. */
export function lookupFor(keymap: Keymap): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [id, keys] of Object.entries(keymap)) for (const key of keys) if (!lookup.has(key)) lookup.set(key, id);
  return lookup;
}

/** Gives `id` one key, clears its keys (null) or resets them to the
 * defaults (undefined). Any other command holding one of `id`'s keys
 * afterwards loses it; `took` lists those commands. */
export function assign(overrides: Keymap, id: string, binding: string | null | undefined, mac: boolean): { overrides: Record<string, string[]>; took: string[] } {
  const next: Record<string, string[]> = Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, [...v]]));
  if (binding === undefined) delete next[id];
  else next[id] = binding === null ? [] : [binding];
  const keymap = resolveKeymap(next, mac);
  const mine = new Set(keymap[id] ?? []);
  const took: string[] = [];
  for (const [other, keys] of Object.entries(keymap)) {
    if (other === id || !keys.some((k) => mine.has(k))) continue;
    next[other] = keys.filter((k) => !mine.has(k));
    took.push(other);
  }
  return { overrides: next, took };
}
