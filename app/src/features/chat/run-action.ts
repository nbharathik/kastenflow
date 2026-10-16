// Running an AI action in the chat: a new chat in the dock grounded in
// `chips` (the PDF pages or the highlight the action is about, or the page an
// action that proposes a change works on), asked what the action says. The
// answer, and whatever follows it, are the chat's: a chat previews its
// changes, so what a `propose` action changes waits as staged changes for the
// person to review.

import { useShell } from "../../lib/store";
import { useWorkspace } from "../workspace/store";
import { prefillMessage } from "./message-drafts";
import { useChat } from "./store";
import type { Chip } from "./thread";

/** The most of a passage that goes into the message. */
const PASSAGE_MOST = 1_200;

/** `passage` as a quotation, cut when long. */
const quoted = (passage: string) =>
  (passage.length > PASSAGE_MOST ? `${passage.slice(0, PASSAGE_MOST).trimEnd()}…` : passage)
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");

/** Whether the action was found and the chat started. Without a provider to
 * ask, the chat opens with what the action says in its message box. The
 * passage the action is about, when there is one, goes with its words. */
export async function runInChat(slug: string, chips: Chip[], passage = ""): Promise<boolean> {
  const chat = useChat.getState();
  const action = (await chat.ensure().aiActions().catch(() => null))?.actions.find((a) => a.slug === slug);
  if (!action) {
    useWorkspace.getState().toast(`There is no AI action called “${slug}”`);
    return false;
  }
  const words = passage.trim() ? `${action.instruction}\n\nThe passage I mean:\n\n${quoted(passage.trim())}` : action.instruction;
  const id = chat.start({ context: chips, open: true, follow: false });
  useShell.getState().toggleChat(true);
  if (useChat.getState().providers === null) await useChat.getState().loadProviders();
  if (!(await useChat.getState().send(id, words))) prefillMessage(id, words);
  return true;
}
