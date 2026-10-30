// A failure that has no screen of its own is said in a toast, never dropped.
// `said("Could not open the link")` is a catch handler; `copyOrSay` copies and
// says so when the computer refuses. Work no one asked for (a backend told the
// window moved, a preview that failed to draw) keeps its own quiet catch with
// the reason written beside it.

import { useWorkspace } from "../features/workspace/store";

/** The reason in an error, when it is a short sentence worth showing. */
function reason(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const one = text.trim().split("\n")[0] ?? "";
  return one && one.length <= 120 ? `: ${one.replace(/[.\s]+$/, "")}` : "";
}

/** A catch handler that toasts `what` (and the reason, when short). */
export function said(what: string): (err: unknown) => void {
  return (err) => useWorkspace.getState().toast(`${what}${reason(err)}`);
}

/** Puts `text` on the clipboard; says "Could not copy …" when it cannot. */
export async function copyOrSay(text: string, what = "that"): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error("No clipboard here");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    useWorkspace.getState().toast(`Could not copy ${what}`);
    return false;
  }
}
