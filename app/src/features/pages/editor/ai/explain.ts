// What can be done with an answer that is only read (an explanation, or an
// AI action that writes nothing): copy it, or carry on with it in the chat.

import { useShell } from "../../../../lib/store";
import { isoDay } from "../../../../lib/dates";
import { noteChip } from "../../../chat/context";
import { prefillMessage } from "../../../chat/message-drafts";
import { activePath } from "../../../chat/open-pages";
import { useChat } from "../../../chat/store";
import type { Chip } from "../../../chat/thread";
import { useWorkspace } from "../../../workspace/store";
import { noteAt } from "../../../workspace/tree";

/** The most of the passage and of the answer carried into the chat's message box. */
const PASSAGE_MOST = 600;
const ANSWER_MOST = 3_000;

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most).trimEnd()}…` : text);
const quoted = (text: string) =>
  cut(text.trim(), PASSAGE_MOST)
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");

/** The message a chat opened from an answer starts with: where the passage
 * is from, the passage, what was said about it, and room to ask more. */
export function carryOn(parts: { title: string; passage: string; answer: string }): string {
  const where = parts.title.trim() ? ` in “${parts.title.trim()}”` : "";
  const about = parts.passage.trim() ? `About this passage${where}:\n\n${quoted(parts.passage)}\n\n` : `About my page${where}:\n\n`;
  return `${about}You said:\n\n${cut(parts.answer.trim(), ANSWER_MOST)}\n\nMy question: `;
}

/** Opens a new chat in the dock about the page in front, with the passage
 * and the answer in the message box for the person to add to. */
export function continueInChat(parts: { title: string; passage: string; answer: string }): void {
  const id = useChat.getState().start({ open: true });
  prefillMessage(id, carryOn(parts));
  useShell.getState().toggleChat(true);
}

/** Copies the answer; says so. */
export async function copyAnswer(text: string): Promise<void> {
  const { toast } = useWorkspace.getState();
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied the answer");
  } catch {
    toast("The answer could not be copied");
  }
}

/** The page in front as a chip, for a chat about it; none when no page is open. */
export function pageChip(): Chip | null {
  const path = activePath();
  const note = path ? noteAt(useWorkspace.getState().notes, path) : undefined;
  return note ? noteChip(note) : null;
}

/** The project folder and the day an action works from, for the page in front. */
export function pageFacts(): { project: string | null; date: string } {
  const path = activePath();
  const note = path ? noteAt(useWorkspace.getState().notes, path) : undefined;
  return { project: note?.project ?? null, date: isoDay(new Date()) };
}
