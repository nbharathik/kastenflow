// One thing to look at on the health page: what it is, where it opens, and, if
// there is a repair, a preview of what it would do before it does anything.

import { useState } from "react";

import { Button } from "../../ui/Button";
import { useWorkspace } from "../workspace/store";
import { openSettingsAt } from "../workspace/views/settings/jump";
import type { Goto, Issue } from "./health-sections";
import { planRepair, type RepairContext } from "./repairs";

/** Opens what an issue points at: a file, the Review view, or a place in Settings. */
export function open(to: Goto): void {
  if ("path" in to) useWorkspace.getState().openPath(to.path, "tab");
  else if ("view" in to) useWorkspace.getState().go({ view: to.view });
  else openSettingsAt({ group: to.settings, ...(to.row ? { row: to.row } : {}) });
}

const wordsOf = (to: Goto): string => ("path" in to ? "Open" : "view" in to ? "Open Review" : "Open settings");

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  issue: Issue;
  context: RepairContext;
  /** Called after a repair was done, so the report can be read again. */
  onRepaired(): void;
}

export function IssueRow({ issue, context, onRepaired }: Props) {
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const plan = issue.repair ? planRepair(issue.repair, context) : null;

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setProblem(null);
    try {
      await plan.apply();
      setPreviewing(false);
      onRepaired();
    } catch (err) {
      setProblem(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="kasten-health-issue" data-issue={issue.id}>
      <div className="kasten-health-issue-line">
        <div className="kasten-health-issue-text">
          <span>{issue.text}</span>
          {issue.detail && <span className="kasten-health-issue-detail">{issue.detail}</span>}
        </div>
        {issue.go && (
          <Button size="sm" tone="quiet" icon="open" aria-label={`${wordsOf(issue.go)}: ${issue.text}`} onClick={() => open(issue.go!)}>
            {wordsOf(issue.go)}
          </Button>
        )}
        {plan && (
          <Button size="sm" aria-expanded={previewing} aria-label={`Preview the fix: ${issue.text}`} onClick={() => setPreviewing(!previewing)}>
            {previewing ? "Hide" : "Preview fix"}
          </Button>
        )}
      </div>
      {plan && previewing && (
        <div className="kasten-health-preview" role="group" aria-label="What the fix would do">
          <ul>
            {plan.will.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{plan.leaves}</p>
          <p className="kasten-health-issue-detail">{plan.undo}</p>
          {plan.blocked && (
            <p role="status" className="kasten-health-blocked">
              {plan.blocked}
            </p>
          )}
          {problem && (
            <p role="alert" className="kasten-health-blocked">
              {problem}
            </p>
          )}
          <div className="kasten-health-preview-actions">
            <Button size="sm" tone="primary" disabled={busy || plan.blocked !== null} onClick={() => void apply()}>
              {busy ? "Working…" : "Do it"}
            </Button>
            <Button size="sm" tone="quiet" onClick={() => setPreviewing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
