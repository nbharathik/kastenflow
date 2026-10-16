// The cards of a review screen: captures, what is overdue and due, projects
// whose review has come, decisions, completed work and highlights to revisit.
// Each says plainly when it has nothing, and none of them changes anything
// unless a button on it is pressed.

import type { ReactNode } from "react";

import { relativeTime } from "../../lib/dates";
import type { ProjectSummary } from "../../lib/vault/project-types";
import type { NoteMeta } from "../../lib/vault/types";
import { openMenuHandlers } from "../../shell/open-menu";
import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { DashCard, DashEmpty } from "../dashboard/DashCard";
import { SeeAll } from "../dashboard/Minis";
import { NoteRow, openOnClick } from "../dashboard/NoteRow";
import { openOverview } from "../projects/overview/open";
import { useWorkspace } from "../workspace/store";
import { dayWords, type DueItem, type Review } from "./assemble";
import { markReviewed } from "./project/pieces";
import { refOfSummary } from "./project/refs";

const goTriage = () => useWorkspace.getState().go({ view: "inbox", path: "triage" });

export function CapturesCard({ review }: { review: Review }) {
  const { count, items } = review.captures;
  return (
    <DashCard title="Captures to triage" icon="inbox" count={count} actions={count > 0 ? <SeeAll label="Triage" run={goTriage} /> : undefined}>
      {count === 0 ? (
        <DashEmpty>Nothing is waiting in the Inbox or among the captures.</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {items.map((note) => (
            <NoteRow key={note.path} note={note} detail={relativeTime(note.modified)} />
          ))}
          {count > items.length && <p className="kasten-review-more">and {count - items.length} more</p>}
        </div>
      )}
    </DashCard>
  );
}

function DueRow({ item, today }: { item: DueItem; today: string }) {
  const late = item.due < today;
  return (
    <button type="button" className="kasten-dash-row" onClick={openOnClick(item.path)} {...openMenuHandlers(item.path)}>
      <span className="kasten-dash-row-icon" aria-hidden="true">
        <Icon name={item.kind === "task" ? "tasks" : "todo"} className="size-4 text-muted" />
      </span>
      <span className="kasten-dash-row-title">{item.text}</span>
      <span className={`kasten-dash-row-detail${late ? " is-late" : ""}`}>
        {dayWords(item.due, today)}
        {item.where ? ` · ${item.where}` : ""}
      </span>
    </button>
  );
}

export function DueCard({ title, icon, items, today, empty, loading }: { title: string; icon: IconName; items: readonly DueItem[]; today: string; empty: string; loading: boolean }) {
  return (
    <DashCard title={title} icon={icon} count={items.length} actions={<SeeAll label="Tasks" run={() => useWorkspace.getState().go({ view: "tasks" })} />}>
      {items.length === 0 ? (
        <DashEmpty>{loading ? "Gathering to-dos…" : empty}</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {items.slice(0, 12).map((item) => (
            <DueRow key={item.key} item={item} today={today} />
          ))}
          {items.length > 12 && <p className="kasten-review-more">and {items.length - 12} more, in Tasks</p>}
        </div>
      )}
    </DashCard>
  );
}

function ProjectRow({ project, today }: { project: ProjectSummary; today: string }) {
  return (
    <div className="kasten-review-project">
      <button type="button" className="kasten-dash-row" onClick={() => openOverview(project)}>
        <span className="kasten-dash-row-icon" aria-hidden="true">
          <Icon name="project" className="size-4 text-muted" />
        </span>
        <span className="kasten-dash-row-title">{project.title}</span>
        <span className="kasten-dash-row-detail">{project.reviewAfter ? `review ${dayWords(project.reviewAfter, today)}` : "review due"}</span>
      </button>
      <Button size="sm" aria-label={`Mark ${project.title} reviewed`} onClick={() => void markReviewed(refOfSummary(project))}>
        Reviewed
      </Button>
    </div>
  );
}

export function ProjectsCard({ projects, today, loading }: { projects: readonly ProjectSummary[]; today: string; loading: boolean }) {
  return (
    <DashCard title="Projects due for review" icon="calendar-check" count={projects.length} actions={<SeeAll label="Projects" run={() => useWorkspace.getState().go({ view: "projects" })} />}>
      {projects.length === 0 ? (
        <DashEmpty>{loading ? "Reading the projects…" : "No project is waiting for a review."}</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {projects.map((project) => (
            <ProjectRow key={project.folder} project={project} today={today} />
          ))}
        </div>
      )}
    </DashCard>
  );
}

/** Notes with a day beside each: decisions, completed work, highlights. */
export function NotesCard({ title, icon, notes, empty, actions, detail }: { title: string; icon: IconName; notes: readonly NoteMeta[]; empty: string; actions?: ReactNode; detail?: (note: NoteMeta) => string }) {
  return (
    <DashCard title={title} icon={icon} count={notes.length} actions={actions}>
      {notes.length === 0 ? (
        <DashEmpty>{empty}</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {notes.slice(0, 12).map((note) => (
            <NoteRow key={note.path} note={note} detail={detail ? detail(note) : relativeTime(note.modified)} />
          ))}
          {notes.length > 12 && <p className="kasten-review-more">and {notes.length - 12} more</p>}
        </div>
      )}
    </DashCard>
  );
}
