// How a chat's writes reach the vault, as the person chose it for the thread:
// "Ask first" holds every write as staged changes (and proposals) to decide
// on in the chat; "Apply directly" makes them at once, each with its undo;
// "Auto" applies small writes to the page being worked on when the turn ends
// and holds the rest. The agent mode comes first: Review everything always
// holds, Autonomous never does, and a locked note stays read-only whatever
// is chosen here (the core refuses it).

import { useAgentMode } from "../agents/store";
import type { Thread } from "./thread";

export type WriteChoice = "ask" | "direct" | "auto";

export const WRITE_CHOICES: readonly { choice: WriteChoice; label: string; says: string }[] = [
  { choice: "ask", label: "Ask first", says: "Every change waits for you in the chat." },
  { choice: "direct", label: "Apply directly", says: "Changes are saved as the chat makes them; each can be undone." },
  { choice: "auto", label: "Auto", says: "Small changes to the page you are on are saved; the rest waits for you." },
];

/** The thread's choice. */
export const writeChoiceOf = (thread: Pick<Thread, "direct" | "auto">): WriteChoice => (thread.auto ? "auto" : thread.direct ? "direct" : "ask");

/** What the thread's fields are for a choice. */
export const fieldsOf = (choice: WriteChoice): Pick<Thread, "direct" | "auto"> => ({ direct: choice === "direct", auto: choice === "auto" });

/** What the agent mode says about this chat's writes, when it decides them. A
 * chat may write anywhere, so one project on Review holds the whole chat's. */
export function heldByMode(): "review" | "autonomous" | null {
  const view = useAgentMode.getState().view;
  if (view?.active === "review" || Object.values(view?.projects ?? {}).includes("review")) return "review";
  return view?.active === "autonomous" ? "autonomous" : null;
}

/** The words for the thread's header: nothing for the default, which is not announced. The agent mode
 * is named when it decides, since the thread's choice then changes nothing. */
export function writeLabel(thread: Pick<Thread, "direct" | "auto">, held: "review" | "autonomous" | null): string | null {
  if (held) return held === "review" ? "Review everything" : "Autonomous agents";
  const choice = writeChoiceOf(thread);
  return choice === "ask" ? null : choice === "direct" ? "Applies directly" : "Auto";
}
