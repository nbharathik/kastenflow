// A thread as a readable note for chats/ ("Save chat"), and an answer as a
// card ("Pin as card"). Pure, so both are easy to test.

import type { BoardInfo, NoteMeta } from "../../lib/vault/types";
import { linkFor } from "../workspace/links";
import { readable, titleOf } from "../workspace/names";
import { noteAt } from "../workspace/tree";
import { answerText, type Answer, type Part, type Thread } from "./thread";
import type { ContextChip } from "./types";

export interface Names {
  notes: readonly NoteMeta[];
  boards: readonly BoardInfo[];
}

/** A note by its current title, as a wiki link; a board or other file by its name. */
function linkTo(path: string, names: Names): string {
  const note = path.endsWith(".md") ? noteAt(names.notes, path) : undefined;
  if (note) return linkFor(note, names.notes);
  const board = names.boards.find((b) => b.path === path);
  return board ? `board “${board.title}”` : `\`${path}\``;
}

function chipText(chip: ContextChip, names: Names): string {
  switch (chip.kind) {
    case "note":
    case "cards":
      return chip.ref.map((path) => linkTo(path, names)).join(", ");
    case "board":
      return linkTo(chip.ref[0] ?? "", names);
    case "tag":
      return `tag view \`#${chip.ref[0] ?? ""}\`${chip.ref[1] ? ` · ${chip.ref[1]}` : ""}`;
    case "search":
      return `search “${chip.ref[0] ?? ""}”`;
    case "attachment":
      return chip.ref[1] ?? chip.label;
    default:
      return chip.label;
  }
}

const contextLine = (context: readonly ContextChip[], names: Names) => (context.length ? `Context: ${context.map((c) => chipText(c, names)).join(", ")}` : "");

/** "Create note" for `create_note`, with the title it names when it names one. */
export function describeCall(name: string, input: unknown): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  const what = words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
  const title = input && typeof input === "object" ? (input as Record<string, unknown>).title : undefined;
  return typeof title === "string" && title.trim() ? `${what} “${title.trim()}”` : what;
}

function toolLine(part: Extract<Part, { kind: "tool" }>, names: Names): string {
  const { call, result } = part;
  if (!result) return `- ${describeCall(call.name, call.input)} (did not finish)`;
  const links = result.paths.map((path) => linkTo(path, names)).join(", ");
  const summary = result.summary.trim() || describeCall(call.name, call.input);
  return `- ${result.ok ? "" : "Failed: "}${summary}${links ? `: ${links}` : ""}`;
}

function answerMarkdown(answer: Answer, names: Names): string {
  const out: string[] = [];
  let tools: string[] = [];
  const endTools = () => {
    if (tools.length) out.push(tools.join("\n"));
    tools = [];
  };
  for (const part of answer.parts) {
    if (part.kind === "tool") tools.push(toolLine(part, names));
    else if (part.kind === "steer") {
      // Something said while it worked.
      endTools();
      out.push(`> **You, meanwhile:** ${part.text.trim().replace(/\n/g, "\n> ")}`);
    } else if (part.text.trim()) {
      endTools();
      out.push(part.text.trim());
    }
  }
  endTools();
  if (answer.status === "stopped") out.push("*Stopped.*");
  if (answer.status === "paused") out.push("*Paused: it stopped short and can be continued.*");
  if (answer.status === "error") out.push(`*The answer stopped with an error: ${answer.error ?? "unknown"}*`);
  return out.join("\n\n");
}

const SAVED = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The thread as Markdown: when and with what, then a heading per turn. */
export function transcript(thread: Thread, names: Names, now = new Date()): string {
  const lines = [`- Saved: ${SAVED.format(now)}`];
  const models = [...new Set(thread.messages.flatMap((m) => (m.role === "assistant" ? [`${m.provider} · ${m.model}`] : [])))];
  if (models.length) lines.push(`- Model: ${models.join(", ")}`);
  const blocks = [lines.join("\n")];
  let context = "";
  for (const message of thread.messages) {
    if (message.role === "user") {
      // The context shows where it starts or changes.
      const grounded = contextLine(message.context, names);
      blocks.push("## You");
      if (grounded && grounded !== context) blocks.push(`*${grounded}*`);
      context = grounded;
      if (message.attachments?.length) blocks.push(`*Attached: ${message.attachments.map((a) => a.name).join(", ")}*`);
      blocks.push(message.text.trim());
    } else {
      blocks.push(`## ${message.provider}`);
      const body = answerMarkdown(message, names);
      if (body) blocks.push(body);
    }
  }
  return `${blocks.join("\n\n")}\n`;
}

/** A card for an answer: its first line (a heading's text when it opens
 * with one) as the title, its text as the body. */
export function cardFrom(answer: Answer): { title: string; body: string } {
  const text = answerText(answer);
  const first = text.split("\n").find((line) => line.trim()) ?? "";
  let title = readable(first).replace(/[[\]|#]/g, "").trim();
  if (title.length > 60) title = `${title.slice(0, 60).replace(/\s+\S*$/, "")}…`;
  return { title: title || "Chat answer", body: text ? `${text}\n` : "" };
}

/** A path's name for a row: the note's title or the board's, else its file name. */
export function nameOf(path: string, names: Names): string {
  const note = path.endsWith(".md") ? noteAt(names.notes, path) : undefined;
  if (note) return titleOf(note);
  return names.boards.find((b) => b.path === path)?.title ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|canvas|deck)$/, "");
}
