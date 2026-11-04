import type { Issue } from "@kasten-slides/wasm";
import type { JSX } from "react";
import { useEffect, useMemo } from "react";

import { lintOf } from "../lint/service.ts";
import { useLintSnapshot } from "../lint/use-lint.ts";
import { Empty } from "../panels/Placeholders.tsx";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditor } from "../useEditor.ts";
import { ACCESS_RULES, checkAccess } from "./check.ts";
import { ProblemRow } from "./ProblemRow.tsx";
import { ReadingOrder } from "./ReadingOrder.tsx";
import "./access.css";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The problems and the reading order, drawn from what lint found (`issues`, by slide). */
export function AccessView({ session, issues, checking }: { session: EditorSession; issues: ReadonlyMap<string, readonly Issue[]>; checking: boolean }): JSX.Element {
  const state = useEditor(session);
  const problems = useMemo(() => checkAccess(state.deck, issues), [state.deck, issues]);
  return (
    <div className="ks-ac">
      <p className="ks-ac-summary" role="status">
        {checking && problems.length === 0 ? "Checking the slides…" : problems.length === 0 ? "No accessibility problems found." : `${plural(problems.length, "problem")} to look at.`}
      </p>
      {problems.length === 0 && !checking ? (
        <Empty icon="circle-check" title="Nothing to fix">
          Every picture has words or is marked as decoration, every slide has a title, and the tables and videos are ready.
        </Empty>
      ) : (
        ACCESS_RULES.map(({ rule, name }) => {
          const here = problems.filter((problem) => problem.rule === rule);
          if (here.length === 0) return null;
          return (
            <section key={rule} className="ks-ac-group" aria-label={name}>
              <h4>
                {name} <span className="ks-ac-count">{here.length}</span>
              </h4>
              <ul className="ks-ac-list">
                {here.map((problem) => (
                  <ProblemRow key={problem.key} session={session} problem={problem} />
                ))}
              </ul>
            </section>
          );
        })
      )}
      <ReadingOrder session={session} />
    </div>
  );
}

/**
 * The accessibility check: pictures with no words, slides with no title, text that is hard to read, tables with no header row and videos
 * with no captions, each with a way to see it and the fix that suits it, and the reading order of the slide shown. Pictures and contrast are
 * lint's own rules, read from what lint found; the rest are looked for on the deck.
 */
export function AccessPanel({ session }: { session: EditorSession; ui?: EditorUi }): JSX.Element {
  const lint = useMemo(() => lintOf(session), [session]);
  const snapshot = useLintSnapshot(lint);
  // The panel is open, so lint looks at the deck as it changes, and once now.
  useEffect(() => lint.retain(), [lint]);
  useEffect(() => {
    void lint.checkAll();
  }, [lint]);
  return <AccessView session={session} issues={snapshot.issues} checking={snapshot.checking} />;
}
