// Copying what the chat said: an answer as plain words or as its Markdown, a
// question as typed.

import { useWorkspace } from "../workspace/store";
import { plainText } from "./markdown/plain";
import { answerText, type Answer, type Thread } from "./thread";

/** Puts `text` on the clipboard; whether it did. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return Boolean(navigator.clipboard);
  } catch {
    return false;
  }
}

/** An answer's words without the Markdown marks. */
export const plainAnswer = (answer: Answer): string => plainText(answerText(answer));

/** The newest answer of a thread that has something to copy. */
export function lastAnswer(thread: Thread | undefined): Answer | undefined {
  for (let i = (thread?.messages.length ?? 0) - 1; i >= 0; i--) {
    const m = thread!.messages[i]!;
    if (m.role === "assistant" && answerText(m)) return m;
  }
  return undefined;
}

/** Copies the newest answer of `thread` (as Markdown or plain) and says so. */
export async function copyLastAnswer(thread: Thread | undefined, markdown = false): Promise<boolean> {
  const answer = lastAnswer(thread);
  const toast = useWorkspace.getState().toast;
  if (!answer) {
    toast("No answer to copy yet");
    return false;
  }
  const went = await copyToClipboard(markdown ? answerText(answer) : plainAnswer(answer));
  toast(went ? "Copied the last answer" : "Could not copy");
  return went;
}
