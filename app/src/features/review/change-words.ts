// A commit in words, for the history. The core writes summaries
// such as "edit: Trip plan" or "rename: Old → New"; the history says
// "Edited" or "Renamed from Old", each with an icon. And a note's change
// as its text changed, with the frontmatter's keys named, not diffed.

import { isDay, longDay } from "../../lib/dates";
import type { IconName } from "../../ui/icons";
import { splitFrontmatter } from "../pages/markdown/frontmatter";
import { versionTime } from "../panel/history/versions";
import { diffLines, type DiffLine } from "./diff";
import { splitSummary } from "./words";

export interface ChangeWords {
  /** What happened: "Edited", "Moved to trash"; null for a summary in no known form. */
  action: string | null;
  icon: IconName;
  /** What it happened to: a note's title, a file, a day. */
  subject: string;
  /** More, when the summary says it: "from Old name", "§ Plan". */
  detail: string | null;
}

/** Verbs whose summary is only the subject. */
const PLAIN: Record<string, [string, IconName]> = {
  edit: ["Edited", "edit"],
  create: ["Created", "plus"],
  trash: ["Moved to trash", "trash"],
  props: ["Set properties", "sliders"],
  tags: ["Changed tags", "tag"],
  schema: ["Changed the database", "database"],
  journal: ["Wrote in the journal", "journal"],
  append: ["Added text", "list-plus"],
  duplicate: ["Duplicated", "copy"],
  clip: ["Clipped from the web", "globe"],
  asset: ["Added a file", "attach"],
  source: ["Added a PDF", "book"],
  highlight: ["Highlighted", "highlight"],
  accept: ["Kept an agent’s writing", "check"],
  propose: ["Proposed", "agent"],
  external: ["Changed outside KastenFlow", "external"],
  init: ["Started the vault", "sparkle"],
  templates: ["Added templates", "template"],
  import: ["Imported", "import"],
};

/** The words for a change; a journal day is named as the journal names it. */
const words = (action: string | null, icon: IconName, subject: string, detail: string | null = null): ChangeWords => ({ action, icon, subject: isDay(subject) ? longDay(subject) : subject, detail });

/** A board change's own words, "add 3 cards", in the past: "Added 3 cards". */
const BOARD_VERBS: Record<string, string> = { add: "Added", connect: "Connected", section: "Made the section", group: "Grouped", move: "Moved", remove: "Removed", link: "Linked" };

function boardWords(what: string): string {
  const [verb = "", ...rest] = what.split(" ");
  const past = BOARD_VERBS[verb];
  return past ? `${past} ${rest.join(" ")}`.trim() : `Changed the whiteboard: ${what}`;
}

/** "the version from 24 Sep 2026, 10:14" for the core's "2026-09-24 10:14" (UTC), or a commit id. */
function versionLabel(label: string): string {
  const stamp = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(label);
  return stamp ? `the version from ${versionTime(Date.parse(`${stamp[1]}T${stamp[2]}:00Z`))}` : `version ${label}`;
}

/** What `summary` says happened, to what. */
export function describeChange(summary: string): ChangeWords {
  const { verb, text } = splitSummary(summary);
  if (!verb) return words(null, "history", summary);
  const plain = PLAIN[verb];
  if (plain) return words(plain[0], plain[1], text);
  switch (verb) {
    case "rename": {
      const at = text.indexOf(" → ");
      return at < 0 ? words("Renamed", "text", text) : words("Renamed", "text", text.slice(at + 3), `from ${text.slice(0, at)}`);
    }
    case "restore": {
      const to = /^(.*) to (\d{4}-\d{2}-\d{2} \d{2}:\d{2}|[0-9a-f]{7,40})$/.exec(text);
      const subject = to ? to[1]! : text;
      return words("Restored", "restore", subject === "vault" ? "The whole vault" : subject, to ? `to ${versionLabel(to[2]!)}` : null);
    }
    case "convert": {
      const to = /^(.*) to (an? [\w-]+)$/.exec(text);
      return to ? words(`Turned into ${to[2]}`, "refresh", to[1]!) : words("Turned into", "refresh", text);
    }
    case "board": {
      if (text.startsWith("create ")) return words("Created a whiteboard", "board", text.slice(7));
      // "add 3 cards on Plan": what, then the board; a card's title may hold " on " too.
      const at = text.startsWith("add ") ? text.indexOf(" on ") : text.lastIndexOf(" on ");
      return at < 0 ? words("Changed the whiteboard", "board", text) : words(boardWords(text.slice(0, at)), "board", text.slice(at + 4));
    }
    case "section": {
      const at = text.indexOf(" § ");
      return at < 0 ? words("Rewrote a section", "section", text) : words("Rewrote a section", "section", text.slice(0, at), text.slice(at + 1));
    }
    case "deck": {
      // "create Talk", "edit Talk", and from an agent "edit Talk § add diagram".
      const made = text.startsWith("create ");
      const rest = text.replace(/^(create|edit) /, "");
      const at = rest.indexOf(" § ");
      return at < 0 ? words(made ? "Made a deck" : "Edited a deck", "present", rest) : words("Edited a deck", "present", rest.slice(0, at), rest.slice(at + 3));
    }
    case "template": {
      const at = text.lastIndexOf(" from ");
      return at < 0 ? words("Changed a template", "template", text) : words("Made from a template", "template", text.slice(0, at), `“${text.slice(at + 6)}”`);
    }
    case "undo": {
      const undid = describeChange(text);
      return words("Undid a change", "undo", undid.subject, undid.action ? `(${undid.action.toLowerCase()})` : null);
    }
    default:
      return words(verb.charAt(0).toUpperCase() + verb.slice(1).replace(/_/g, " "), "history", text);
  }
}

/** Frontmatter keys in words. */
const KEY_WORDS: Record<string, string> = { props: "properties", parent: "parent page", type: "kind", locked: "lock", created: "created date" };
/** Keys that change with every save, so they say nothing. */
const CLOCK = new Set(["updated"]);

/** Top-level YAML keys and their text, continuation lines included. */
function keysOf(front: string): Map<string, string> {
  const out = new Map<string, string>();
  let key: string | null = null;
  for (const line of front.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_][\w-]*)\s*:(.*)$/.exec(line);
    if (m) {
      key = m[1]!;
      out.set(key, m[2]!.trim());
    } else if (key && line.trim()) out.set(key, `${out.get(key)}\n${line}`);
  }
  return out;
}

/** The frontmatter keys two versions differ in, in words, leaving out the clock. */
export function detailsChanged(before: string, after: string): string[] {
  const a = keysOf(before);
  const b = keysOf(after);
  const keys = [...new Set([...b.keys(), ...a.keys()])];
  return keys.filter((k) => !CLOCK.has(k) && a.get(k) !== b.get(k)).map((k) => KEY_WORDS[k] ?? k);
}

/** A frontmatter block without its fences. */
const inside = (prefix: string) => prefix.replace(/^\ufeff?---[ \t]*\r?\n/, "").replace(/---[ \t]*(\r?\n)?$/, "");

/** What changed in a file: a note's text, and the frontmatter keys by name; other files whole. */
export function noteDiff(path: string, before: string | null, after: string | null): { lines: DiffLine[]; details: string[] } {
  if (!path.endsWith(".md")) return { lines: diffLines(before, after), details: [] };
  const a = before === null ? null : splitFrontmatter(before);
  const b = after === null ? null : splitFrontmatter(after);
  return {
    lines: diffLines(a?.body ?? null, b?.body ?? null),
    details: a && b ? detailsChanged(inside(a.prefix), inside(b.prefix)) : [],
  };
}
