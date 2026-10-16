// The daily and weekly review: one screen over what the window already knows.
// It lists what is waiting (captures, what is overdue and due, projects whose
// review has come, decisions, completed work and a few highlights to revisit)
// and changes nothing by being open. "Mark reviewed" notes the day in this
// window; "Save as note" writes a normal page, and only when pressed. A review
// not done is a date, "No weekly review since 3 Oct", never a failure.

import "../dashboard/dashboard.css";
import "./review.css";

import { useId } from "react";

import { longDay } from "../../lib/dates";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Segmented } from "../../ui/Segmented";
import { useWorkspace } from "../workspace/store";
import { periodWords, type ReviewKind } from "./assemble";
import { CapturesCard, DueCard, NotesCard, ProjectsCard } from "./ReviewCards";
import { lastLine } from "./reminder";
import { saveReviewAsNote } from "./review-note";
import { markDone, useVaultReview } from "./review-prefs";
import { useReview } from "./use-review";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `path` is the kind of review: "weekly", else the daily one. */
export function ReviewScreens({ path }: { path?: string }) {
  const kind: ReviewKind = path === "weekly" ? "weekly" : "daily";
  const { review, period, loading } = useReview(kind);
  const [prefs, change] = useVaultReview();
  const today = period.today;
  const weekly = kind === "weekly";
  const done = prefs.last[kind] === today;

  const markReviewed = () => {
    const before = markDone(kind, today);
    useWorkspace.getState().toast(`Marked the ${kind} review done for today`, { label: "Undo", run: () => void markDone(kind, before) });
  };

  return (
    <div className="kasten-review">
      <header className="kasten-review-head">
        <h1>
          <Icon name="calendar-check" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
          {weekly ? "Weekly review" : "Daily review"}
        </h1>
        <Segmented
          label="Kind of review"
          value={kind}
          onChange={(next) => useWorkspace.getState().go({ view: "reviews", path: next })}
          choices={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ]}
        />
      </header>
      <p className="kasten-review-sub">
        {weekly ? periodWords(period) : longDay(today)}. Opening a review changes nothing: it only looks. <span className="kasten-review-last">{lastLine(kind, prefs.last[kind], today)}.</span>
      </p>

      {weekly && <Reminder />}

      {review.empty && !loading ? (
        <div className="kasten-review-quiet">
          <Icon name="sparkle" className="size-6 text-muted" />
          <p className="text-14 font-medium">Nothing needs a look.</p>
          <p className="text-13 text-muted">No capture is waiting, nothing is overdue or due, and no project is up for review.</p>
        </div>
      ) : (
        <div className="kasten-review-cards">
          <CapturesCard review={review} />
          <DueCard title="Overdue" icon="alert" items={review.overdue} today={today} empty="Nothing is overdue." loading={loading} />
          <DueCard title={weekly ? "Due in the next 7 days" : "Due today"} icon="calendar" items={review.due} today={today} empty={weekly ? "Nothing is due this week." : "Nothing is due today."} loading={loading} />
          <ProjectsCard projects={review.projects} today={today} loading={loading} />
          <NotesCard title="Decisions" icon="bulb" notes={review.decisions} empty={weekly ? "No decision was noted this week. Tag a page #decision to see it here." : "No decision was noted today."} />
          <NotesCard title="Completed" icon="circle-check" notes={review.completed} empty={weekly ? "No task note was finished this week." : "No task note was finished today."} />
          {prefs.highlights && (
            <NotesCard
              title="Highlights to revisit"
              icon="highlight"
              notes={review.highlights}
              empty="Nothing saved has waited long enough to come back."
              actions={
                <button type="button" className="kasten-dash-action" onClick={() => change({ highlights: false })}>
                  Hide
                </button>
              }
            />
          )}
        </div>
      )}
      {!prefs.highlights && (
        <button type="button" className="kasten-review-link" onClick={() => change({ highlights: true })}>
          Show highlights to revisit
        </button>
      )}

      <footer className="kasten-review-foot">
        <Button tone="primary" disabled={done} onClick={markReviewed}>
          {done ? "Marked done today" : `Mark the ${kind} review done`}
        </Button>
        <Button onClick={() => void saveReviewAsNote(review, period, prefs.highlights)}>Save as note</Button>
        <span className="kasten-review-foot-note">Saving writes a normal page. Marking only notes the day in this window.</span>
      </footer>
    </div>
  );
}

/** The weekly reminder: a banner on Home, off until switched on here or in Settings. */
function Reminder() {
  const [prefs, change] = useVaultReview();
  const id = useId();
  return (
    <div className="kasten-review-remind" role="group" aria-label="Weekly reminder">
      <label className="kasten-review-check">
        <input type="checkbox" checked={prefs.remind} onChange={(event) => change({ remind: event.target.checked, snoozed: null })} />
        Remind me to do the weekly review
      </label>
      <label htmlFor={`${id}-day`} className="text-13 text-muted">
        on
      </label>
      <select id={`${id}-day`} aria-label="Reminder day" disabled={!prefs.remind} value={prefs.weekday} onChange={(event) => change({ weekday: Number(event.target.value) })} className="h-7 rounded-[4px] bg-well px-1.5 text-13">
        {WEEKDAYS.map((name, day) => (
          <option key={name} value={day}>
            {name}
          </option>
        ))}
      </select>
      <span className="text-12 text-muted">A banner on Home, nothing more.</span>
    </div>
  );
}
