// Triage's keys: one letter or digit per action, so a batch goes through
// without opening a menu. The same table draws the help line under the card.

export type TriageAct =
  | "next"
  | "prev"
  | "move"
  | "tag"
  | "board"
  | "collection"
  | "task"
  | "archive"
  | "later"
  | "tomorrow"
  | "week"
  | "month"
  | "reading"
  | "page"
  | "done"
  | "home"
  | "undo"
  | "open"
  | "stack"
  | "this-week"
  | "stop";

const KEYS: Record<string, TriageAct> = {
  j: "next",
  k: "prev",
  m: "move",
  t: "tag",
  b: "board",
  c: "collection",
  n: "task",
  a: "archive",
  l: "later",
  "1": "tomorrow",
  "2": "week",
  "3": "month",
  r: "reading",
  p: "page",
  d: "done",
  s: "home",
  u: "undo",
  w: "this-week",
  o: "open",
  Enter: "open",
  Escape: "stop",
};

/** The action a key stands for. Shift+Enter or Shift+O opens the card in the side stack. */
export function actOf(event: Pick<KeyboardEvent, "key" | "shiftKey">): TriageAct | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const act = KEYS[key];
  if (!act) return null;
  return act === "open" && event.shiftKey ? "stack" : act;
}

/** The help line: keys and what they do, in the order a person reaches for them. */
export const HELP: readonly (readonly [keys: string, what: string])[] = [
  ["J K", "next, previous"],
  ["M", "project"],
  ["T", "tag"],
  ["B", "board"],
  ["C", "collection"],
  ["N", "task"],
  ["A", "archive"],
  ["L", "later"],
  ["1 2 3", "tomorrow, a week, a month"],
  ["R", "reading"],
  ["P", "page"],
  ["D", "done"],
  ["U", "undo"],
  ["W", "this week"],
  ["Esc", "stop"],
];

/** The help line as one sentence, for a screen reader and the line's tooltip. */
export const helpText = (): string => HELP.map(([keys, what]) => `${keys} ${what}`).join(", ");
