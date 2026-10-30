// Asking the chat backend for one answer without tools, for the editor: the
// same call the page editor's AI panel makes (`runAction`), grounded in the
// open LaTeX file as a context chip. Nothing is saved here; the editor puts the
// answer in the text for the person to keep or undo.

import { latexChip } from "../../../features/chat/context";
import { modelFor } from "../../../features/chat/prefs";
import { useChat } from "../../../features/chat/store";
import type { Written } from "../../../features/chat/types";

/** The most of the text before and after the cursor that goes along. */
const AROUND = 1_500;

/** What an answer is asked from. */
export interface Ask {
  /** The slug of the action to run. */
  action: string;
  /** The request in words. */
  words: string;
  /** The open file (a vault path). */
  path: string;
  selection: string;
  before: string;
  after: string;
}

let runs = 0;

/** What is stopped by `stop`, and the answer being written. */
export interface Running {
  stop(): void;
  done: Promise<Written>;
}

/** Starts an answer, its text passed to `onText` as it comes. Rejects with a sentence when there is no provider to ask. */
export async function ask(request: Ask, onText: (text: string) => void): Promise<Running> {
  const chat = useChat.getState();
  if (chat.providers === null) await chat.loadProviders();
  const pick = modelFor({ provider: null, model: null }, useChat.getState().providers);
  if (!pick) throw new Error("Add an AI provider in Settings to write with AI.");
  const client = useChat.getState().ensure();
  const id = `write-latex-${Date.now().toString(36)}-${++runs}`;
  const nameOf = request.path.slice(request.path.lastIndexOf("/") + 1);
  const done = client.runAction(
    {
      id,
      action: request.action,
      provider: pick.provider,
      model: pick.model,
      title: nameOf,
      instruction: request.words,
      selection: request.selection,
      before: request.before.slice(-AROUND),
      after: request.after.slice(0, AROUND),
      context: [latexChip({ path: request.path, title: nameOf })],
    },
    onText,
  );
  return { stop: () => void client.stopWrite(id), done };
}
