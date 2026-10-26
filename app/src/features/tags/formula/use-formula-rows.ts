// The calculated cells of a tag database: asked of the core with this
// window's own day whenever the notes or the formulas change, laid over the
// rows, and the reasons for empty cells kept for the views to show. The
// previous answer stays on screen while a new one is worked out.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { isoDay } from "../../../lib/dates";
import type { FormulaFill, NoteMeta, TagSchema } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { formulaDefs, NO_PROBLEMS, withFormulas, type CellProblems } from "./rows";

export interface FormulaRows {
  /** The rows, formulas filled in. */
  notes: NoteMeta[];
  problems: CellProblems;
}

/** Calculates a tag's formulas for `notes`; a tag with none costs nothing. */
export function useFormulaRows(tag: string, schema: TagSchema | null, notes: NoteMeta[]): FormulaRows {
  const client = useWorkspace((s) => s.client);
  const formulas = useMemo(() => formulaDefs(schema), [schema]);
  // A new formula or a changed one means new answers.
  const signature = formulas.map((d) => `${d.key}=${d.formula ?? ""}`).join("\n");
  const [fill, setFill] = useState<{ for: string; answer: FormulaFill } | null>(null);
  useEffect(() => {
    if (!client || signature === "") return;
    let current = true;
    client.tagFormulas(tag, isoDay(new Date())).then(
      (answer) => current && setFill({ for: `${tag}\n${signature}`, answer }),
      () => current && setFill(null),
    );
    return () => {
      current = false;
    };
  }, [client, tag, signature, notes]);
  const answer = signature !== "" && fill?.for === `${tag}\n${signature}` ? fill.answer : null;
  return useMemo(() => (signature === "" ? { notes, problems: NO_PROBLEMS } : { notes: withFormulas(notes, answer), problems: answer?.problems ?? NO_PROBLEMS }), [notes, answer, signature]);
}

const Problems = createContext<CellProblems>(NO_PROBLEMS);

/** Gives the views of one database the reasons for its empty calculated cells. */
export const FormulaProblems = Problems.Provider;

/** Why this note's calculated cell has no value, or null. */
export function useCellProblem(path: string, key: string): string | null {
  return useContext(Problems)[path]?.[key] ?? null;
}

/** Why each of this note's calculated cells has no value, if any. */
export function useRowProblems(path: string): Record<string, string> | undefined {
  return useContext(Problems)[path];
}
