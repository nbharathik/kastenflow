import type { Issue } from "@kasten-slides/wasm";
import { type JSX, useEffect, useMemo } from "react";

import { runCommand } from "../commands/index.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";
import { lintOf } from "./service.ts";
import { useLintSnapshot } from "./use-lint.ts";
import "./lint.css";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** How many errors and warnings lint found in the whole deck; what is merely worth a look (info) is in the Lint dialog only. */
export function countProblems(issues: ReadonlyMap<string, readonly Issue[]>): { error: number; warning: number } {
  const counts = { error: 0, warning: 0 };
  for (const list of issues.values()) {
    for (const issue of list) if (issue.severity === "error" || issue.severity === "warning") counts[issue.severity] += 1;
  }
  return counts;
}

/**
 * The problems of the whole deck, as a small count in the title bar beside where the deck is saved: in the colour of the worst, with
 * the errors and warnings said in words when it is pointed at. It is not there while the deck has none. Pressing it opens the Lint dialog,
 * the list of them. The count follows the deck as it changes, whoever changes it (the person, the assistant, an import), through the
 * lint service, which checks the slides that changed once the editing pauses and only in the browser's idle time.
 */
export function LintCount({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element | null {
  const lint = useMemo(() => lintOf(session), [session]);
  // The service does nothing of its own until a view asks for the answer; this one does, for as long as it is on the screen.
  useEffect(() => lint.retain(), [lint]);
  const snapshot = useLintSnapshot(lint);
  const { error, warning } = useMemo(() => countProblems(snapshot.issues), [snapshot.issues]);
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  const total = error + warning;
  if (total === 0) return null;
  const said = [error > 0 ? plural(error, "error", "errors") : "", warning > 0 ? plural(warning, "warning", "warnings") : ""].filter(Boolean).join(" and ");
  return (
    <button
      type="button"
      className={`ks-btn ks-lint-pill is-${error > 0 ? "error" : "warning"}`}
      aria-label={`${said} in this deck. Show the list`}
      data-tip={`${said}: show the list`}
      data-ks-keep-focus=""
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void runCommand("lint.open", ctx)}
    >
      <Icon name={error > 0 ? "circle-x" : "triangle-alert"} size={13} />
      <span aria-hidden="true">{total}</span>
    </button>
  );
}
