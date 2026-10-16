// What each thread's message box held when it was left, and a way to put
// words in a thread's box before it is shown (a chat opened from an answer).

/** The unsent words of each thread, by thread. */
export const drafts = new Map<string, string>();

/** Puts `text` in the message box the thread will show. */
export function prefillMessage(thread: string, text: string): void {
  if (text) drafts.set(thread, text);
  else drafts.delete(thread);
}
