// Asking before going on. An export or a presentation first has the deck checked; when the check finds nothing to look at it goes on at
// once and the person sees nothing, and when it finds something the preflight dialog says what, with a way to go on anyway.

import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { runPreflight } from "./preflight.ts";
import type { PreflightFormat, PreflightOptions, PreflightReport } from "./types.ts";

/** What the preflight dialog is asked: what was found, and what to do if the person goes on. */
export interface Ask {
  format: PreflightFormat;
  report: PreflightReport;
  /** What the person is about to do, in a word: "Export", "Present". */
  verb: string;
  proceed(): void;
}

const asks = new WeakMap<EditorUi, Ask>();

/** The question the preflight dialog is open on, if any. */
export const askOf = (ui: EditorUi): Ask | undefined => asks.get(ui);

/** Forgets the question: the dialog closed. */
export function dropAsk(ui: EditorUi): void {
  asks.delete(ui);
}

/** What a check before a presentation looks at: what the host holds. The lint of the whole deck is left to the Lint dialog and to exports. */
const FOR_PRESENTING: PreflightOptions = { lint: false };

/**
 * Checks the deck for `format`, then goes on (`go`) at once when there is nothing to look at, or opens the preflight dialog when there is. A
 * check that itself fails never stops the person: it goes on.
 */
export async function checkThen(session: EditorSession, ui: EditorUi, format: PreflightFormat, verb: string, go: () => void): Promise<void> {
  let report: PreflightReport;
  try {
    report = await runPreflight(session, session.host, format, format === "present" ? FOR_PRESENTING : {});
  } catch {
    go();
    return;
  }
  if (report.errors.length === 0 && report.warnings.length === 0) {
    go();
    return;
  }
  asks.set(ui, { format, report, verb, proceed: go });
  ui.openDialog("preflight");
}
