// The AI actions offered in the panel: those the editor can run on what is
// here (a selection or not, a page that belongs to a project or not). An
// action that needs sources, a PDF or highlights is not offered here: it is
// run from the chat or the reader. A vault file that could not be used as an
// action is said, so a mistake in it is not a silent gap.

import { useEffect, useState } from "react";

import { Icon } from "../../../../ui/Icon";
import { ICONS, type IconName } from "../../../../ui/icons";
import { useChat } from "../../../chat/store";
import type { ActionCatalog, ActionNeed, AiAction } from "../../../chat/types";

/** What the editor has to give an action. */
export interface Have {
  selection: boolean;
  project: boolean;
}

/** Whether the editor can run `action` with `have`. */
export function runnable(action: AiAction, have: Have): boolean {
  if (!action.where.includes("editor")) return false;
  const available: Record<ActionNeed, boolean> = { selection: have.selection, page: true, nearby: true, sources: false, pdf: false, highlights: false, project: have.project, journal: true };
  return action.needs.every((need) => available[need]);
}

export const iconOf = (action: AiAction): IconName => (action.icon in ICONS ? (action.icon as IconName) : "sparkle");

export function ActionRow({ have, onPick }: { have: Have; onPick(action: AiAction): void }) {
  const [catalog, setCatalog] = useState<ActionCatalog | null>(null);
  useEffect(() => {
    let live = true;
    useChat
      .getState()
      .ensure()
      .aiActions()
      .then(
        (found) => live && setCatalog(found),
        () => live && setCatalog({ actions: [], problems: [] }),
      );
    return () => {
      live = false;
    };
  }, []);
  const offered = catalog?.actions.filter((action) => runnable(action, have)) ?? [];
  const problem = catalog?.problems[0];
  if (offered.length === 0 && !problem) return null;
  return (
    <>
      {offered.length > 0 && (
        <div className="kasten-ai-actions" role="group" aria-label="AI actions">
          <span className="kasten-ai-actions-label">Actions</span>
          {offered.map((action) => (
            <button key={action.slug} type="button" className="kasten-ai-chip" title={action.instruction} onClick={() => onPick(action)}>
              <Icon name={iconOf(action)} className="size-3.5" />
              {action.title}
            </button>
          ))}
        </div>
      )}
      {problem && (
        <p className="kasten-ai-note" role="status">
          {catalog!.problems.length === 1 ? "One AI action file could not be used" : `${catalog!.problems.length} AI action files could not be used`}: {problem.path}: {problem.message}
        </p>
      )}
    </>
  );
}
