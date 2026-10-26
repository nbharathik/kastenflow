// Live checking of the formulas in the schema editor: each formula is sent to
// the core a moment after typing stops, and the core's own sentence and
// position come back. The core is the only judge; nothing is parsed here.

import { useEffect, useState } from "react";

import type { FormulaIssue, PropDef } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";

/** What a draft property is, for checking the names a formula uses. */
export interface DraftProp {
  key: string;
  type: string;
  formula: string;
}

/** How long typing must rest before a formula is checked. */
export const CHECK_DELAY = 300;

/** The core's verdict on each draft (null for a fine one or one that is no formula), after a short rest. */
export function useFormulaChecks(drafts: readonly DraftProp[]): (FormulaIssue | null)[] {
  const client = useWorkspace((s) => s.client);
  const [issues, setIssues] = useState<(FormulaIssue | null)[]>([]);
  const wanted = JSON.stringify(drafts.map((d) => [d.key.trim(), d.type, d.type === "formula" ? d.formula : ""]));
  useEffect(() => {
    if (!client) return;
    let current = true;
    const properties: PropDef[] = drafts.map((d) => ({ key: d.key.trim(), type: d.type, options: [] }));
    const timer = setTimeout(() => {
      void Promise.all(
        drafts.map((d) => (d.type === "formula" ? client.checkFormula(d.formula, d.key.trim(), properties).catch(() => null) : Promise.resolve(null))),
      ).then((found) => current && setIssues(found));
    }, CHECK_DELAY);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `wanted` stands for the drafts' relevant parts.
  }, [client, wanted]);
  return drafts.map((_, i) => issues[i] ?? null);
}

/** The issue as one sentence with its place: "… (at position 12)". */
export const issueText = (issue: FormulaIssue): string => `${issue.message} (at position ${issue.position})`;
