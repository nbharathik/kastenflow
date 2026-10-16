// The pieces a project's card and its row in the list share: the status
// marks, the to-do figures, the next action and the "…" button.

import type { MouseEvent } from "react";

import type { ProjectSummary } from "../../../lib/vault/project-types";
import { stampDay } from "../../../lib/dates";
import { Icon } from "../../../ui/Icon";
import { howFrom, useWorkspace } from "../../workspace/store";
import { HealthMark, StatusChip } from "../state/StateChips";
import { openOverviewOf } from "./hub-actions";
import { openOf, overdueOf, progressOf } from "./hub-model";

/** What a card or row asks of the list it is in. */
export interface CardActions {
  /** Opens the card's "…" menu at a point, from the button `anchor` when it was that. */
  menu(s: ProjectSummary, at: { x: number; y: number }, anchor: HTMLElement | null): void;
}

/** Status, health and the small flags (review due, archived), in one line. */
export function Marks({ s }: { s: ProjectSummary }) {
  return (
    <span className="kasten-hub-marks">
      <StatusChip status={s.status} />
      {s.health && <HealthMark health={s.health} />}
      {s.reviewDue && (
        <span className="kasten-hub-flag is-review" title={s.reviewAfter ? `Review was due ${stampDay(s.reviewAfter)}` : "Review due"}>
          <Icon name="calendar-check" className="size-3" />
          Review due
        </span>
      )}
      {s.lastReview && !s.reviewDue && <span className="kasten-hub-flag" title={`Last reviewed ${stampDay(s.lastReview)}`}>Reviewed {stampDay(s.lastReview)}</span>}
      {s.archived && <span className="kasten-hub-flag">Archived</span>}
    </span>
  );
}

/** How far the to-dos are done: a thin bar and the numbers in words. */
export function Progress({ s }: { s: ProjectSummary }) {
  const { done, total, percent } = progressOf(s);
  return (
    <span className="kasten-hub-progress">
      <span className="kasten-hub-track" role="progressbar" aria-label="To-dos done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="kasten-hub-progress-text">{total === 0 ? "No to-dos" : `${done} of ${total} done`}</span>
    </span>
  );
}

/** Open to-dos, and how many of them are past their day. */
export function Counts({ s }: { s: ProjectSummary }) {
  const open = openOf(s);
  const overdue = overdueOf(s);
  return (
    <span className="kasten-hub-counts">
      <span title={`${open} open to-dos`}>{open} open</span>
      {overdue > 0 && (
        <span className="is-overdue" title={`${overdue} past their day`}>
          {overdue} overdue
        </span>
      )}
    </span>
  );
}

/** The to-do the project does next; a click opens it. */
export function NextAction({ s, tab }: { s: ProjectSummary; tab: boolean }) {
  const next = s.nextAction;
  if (!next) return null;
  return (
    <button
      type="button"
      className={`kasten-hub-next${next.done ? " is-done" : ""}`}
      tabIndex={tab ? 0 : -1}
      title={next.done ? "This next action is done: open it" : "Open the next action"}
      onClick={(event) => useWorkspace.getState().openPath(next.path, howFrom(event))}
    >
      <Icon name={next.done ? "circle-check" : "arrow-up-right"} className="size-3.5" />
      <span className="kasten-hub-next-label">
        <span>Next: </span>
        {next.title}
        {next.done && <span className="kasten-hub-sr"> (done)</span>}
      </span>
    </button>
  );
}

/** The "…" button over a card or row; it opens the card's menu. */
export function MoreButton({ s, tab, actions }: { s: ProjectSummary; tab: boolean; actions: CardActions }) {
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    actions.menu(s, { x: box.left, y: box.bottom + 4 }, event.currentTarget);
  };
  return (
    <button type="button" className="kasten-hub-more" aria-label={`More for ${s.title}`} title={`More for ${s.title}`} aria-haspopup="menu" tabIndex={tab ? 0 : -1} onClick={open}>
      <Icon name="more" className="size-4" />
    </button>
  );
}

/** Opens a project's overview the way the click or key asks. */
export function openFrom(s: ProjectSummary, event: Parameters<typeof howFrom>[0]): void {
  openOverviewOf(s, howFrom(event));
}
