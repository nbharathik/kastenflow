// Agent work in words: what a proposed op does, the description the core
// wrote for it, and a steady colour for each agent client.

import type { AgentOp, Proposal } from "../../lib/vault/types";

const quote = (value: unknown) => `“${String(value ?? "")}”`;
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

/** "1 change", "3 changes". */
export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "a", "a and b", "a, b and c". */
function joinAnd(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function tagWords(add: string[], remove: string[]): string {
  const tags = (list: string[]) => list.map((t) => `#${t.replace(/^#/, "")}`).join(", ");
  if (add.length && remove.length) return `Add ${tags(add)}, remove ${tags(remove)}`;
  if (add.length) return `Add ${add.length === 1 ? "tag" : "tags"} ${tags(add)}`;
  if (remove.length) return `Remove ${remove.length === 1 ? "tag" : "tags"} ${tags(remove)}`;
  return "Change tags";
}

/** "replace_section" as "Replace section". */
const sentence = (name: string) => {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** What an op does, e.g. "Replace section “Method”" or "Move to trash".
 * Takes the op as a proposal stores it (`kind` and its arguments); the
 * names in commit trailers (`trash_note`, …) work too. */
export function opWords(op: AgentOp): string {
  switch (op.kind) {
    case "capture":
      return "Capture a new card";
    case "create_note": {
      const made = `Create ${op.type === "card" ? "card" : "page"} ${quote(op.title)}`;
      return op.template ? `${made} from the template ${quote(op.template)}` : made;
    }
    case "template":
    case "create_template":
    case "update_template":
      return `${op.base || op.kind === "update_template" ? "Change" : "Create"} the template ${quote(op.name)}`;
    case "append":
      return op.heading ? `Add to section ${quote(op.heading)}` : "Add to the end";
    case "replace_section":
      return `Replace section ${quote(op.heading)}`;
    case "update_props": {
      const keys = Object.keys((op.props as Record<string, unknown> | undefined) ?? {});
      return keys.length ? `Set ${joinAnd(keys)}` : "Set properties";
    }
    case "tags":
      return tagWords(strings(op.add), strings(op.remove));
    case "rename":
    case "rename_note":
      return `Rename to ${quote(op.title)}`;
    case "move":
    case "move_note":
      return op.project ? `Move to project ${quote(op.project)}` : "Move to the library";
    case "journal_append":
      return `Add to the journal for ${String(op.date ?? "today")}`;
    case "trash":
    case "trash_note": {
      const path = String(op.path ?? "");
      return path.endsWith(".canvas") ? "Move board to trash" : path.endsWith(".deck") ? "Move deck to trash" : path.endsWith(".drawio") ? "Move diagram to trash" : "Move to trash";
    }
    case "create_diagram":
      return `Create the diagram ${quote(op.title)}`;
    case "update_diagram":
      return "Rewrite the diagram";
    case "edit_diagram":
      return sentence(String(op.summary ?? "")) || "Change the diagram";
    case "edit_deck":
      return sentence(String(op.summary ?? "")) || "Change the deck";
    case "create_deck":
      return `Create the deck ${quote(op.title)}`;
    case "edit":
    case "propose_edit":
      return "Rewrite the whole note";
    case "tag_schema":
    case "update_tag_schema":
      return `Change the schema of #${String(op.tag ?? "")}`;
    case "create_board":
      return `Create board ${quote(op.title)}`;
    case "add_to_board": {
      const n = strings(op.notes).length;
      return `Put ${count(n, "note")} on the board`;
    }
    case "connect":
      return `Connect ${String(op.from ?? "")} → ${String(op.to ?? "")}`;
    case "group":
    case "group_on_board":
      return `Make a section ${quote(op.label)}`;
    default:
      return sentence(op.kind);
  }
}

/** The core's description of a change, without the unified diff it may
 * add after it (creates carry both). Empty when the diff is all there is. */
export function descriptionOf(diff: string): string {
  if (diff.startsWith("--- ")) return "";
  const cut = diff.indexOf("\n\n--- ");
  return (cut >= 0 ? diff.slice(0, cut) : diff).trim();
}

/** A commit summary such as "edit: Paper draft" as its verb and the rest. */
export function splitSummary(summary: string): { verb: string | null; text: string } {
  const m = /^([a-z][a-z_]*): (.+)$/s.exec(summary);
  return m ? { verb: m[1]!, text: m[2]! } : { verb: null, text: summary };
}

/** An agent's client name from a commit author such as `agent:claude-code`. */
export const clientOf = (author: string) => author.replace(/^agent:/, "");

/** One line for toasts: the note, then what changes. */
export function proposalLine(p: Proposal): string {
  return p.target ? `“${p.target.title}”: ${opWords(p.op)}` : opWords(p.op);
}

/** Hues far enough apart to tell a handful of clients apart. */
const HUES = [212, 266, 152, 24, 328, 188, 44, 0];

/** A steady hue for an agent client's badge. */
export function clientHue(client: string): number {
  let hash = 0;
  for (const ch of client) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return HUES[hash % HUES.length]!;
}
