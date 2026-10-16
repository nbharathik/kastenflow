// A project's review actions as menu items, and as a small menu of their own
// on the project page and the overview: the task it does next, marking it
// reviewed (and when to review it again), and a new update.

import { useMemo, useState } from "react";

import { stampDay } from "../../../lib/dates";
import type { NoteMeta } from "../../../lib/vault/types";
import { Menu, type MenuItem } from "../../../shell/Menu";
import { Icon, type IconName } from "../../../ui/Icon";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { NextActionDialog } from "./NextActionDialog";
import { clearReviewDay, markReviewed, newProjectUpdate, setNextAction } from "./pieces";
import { refOfNote, type ProjectRef } from "./refs";

const icon = (name: IconName) => <Icon name={name} className="size-4" />;

/** The items: pin the next task, mark reviewed, review again later, clear the review day, new update. `onNext` opens the dialog that lists the tasks. */
export function reviewItems(project: ProjectRef, onNext: () => void): (MenuItem | "divider")[] {
  return [
    { label: "Next action…", icon: icon("arrow-up-right"), onSelect: onNext },
    ...(project.nextActionId ? [{ label: "Clear the next action", icon: icon("close"), onSelect: () => void setNextAction(project, null) }] : []),
    "divider",
    { label: "Mark reviewed today", icon: icon("calendar-check"), onSelect: () => void markReviewed(project) },
    { label: "Reviewed; review again in a week", icon: icon("clock"), onSelect: () => void markReviewed(project, "week") },
    { label: "Reviewed; review again in a month", icon: icon("clock"), onSelect: () => void markReviewed(project, "month") },
    ...(project.reviewAfter ? [{ label: "Clear the review day", icon: icon("close"), onSelect: () => void clearReviewDay(project) }] : []),
    "divider",
    { label: "New update", icon: icon("compose"), onSelect: () => void newProjectUpdate(project) },
  ];
}

/** "Review" on a project page and its overview: a button that names the last review and opens the actions. */
export function ProjectReviewMenu({ project }: { project: Pick<NoteMeta, "path" | "title" | "props" | "project"> }) {
  const ref = useMemo(() => refOfNote(project), [project]);
  const [choosing, setChoosing] = useState(false);
  const next = useWorkspace((s) => (ref.nextActionId ? s.notes.find((n) => n.id === ref.nextActionId) : undefined));
  return (
    <>
      <Menu
        label={`Review of ${ref.title}`}
        align="left"
        float
        buttonClass="kasten-state-button"
        items={reviewItems(ref, () => setChoosing(true))}
        header={
          <p className="px-2 py-1 text-12 text-muted">
            {next ? `Next: ${titleOf(next)}` : "No next action"}
            {ref.reviewAfter ? ` · review ${stampDay(ref.reviewAfter)}` : ""}
          </p>
        }
      >
        <Icon name="calendar-check" className="size-3.5 text-muted" />
        <span>{ref.lastReview ? `Reviewed ${stampDay(ref.lastReview)}` : "Review"}</span>
        <Icon name="chevron-down" className="size-3 text-faint" />
      </Menu>
      {choosing && <NextActionDialog project={ref} onClose={() => setChoosing(false)} />}
    </>
  );
}
