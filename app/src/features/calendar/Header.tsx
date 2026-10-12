// The Calendar's header: the period shown and how many notes have a date,
// then Show, Today, previous and next, and Month, Week or Agenda.

import { Icon } from "../../ui/Icon";
import { useCalendarActions } from "./actions";
import type { Mode } from "./layout";
import { ShowMenu } from "./ShowMenu";

interface HeaderProps {
  title: string;
  /** Notes placed by a date: the vault's, or a tag database's. */
  count: number;
  mode: Mode;
  /** A tag database's calendar: no Show menu and no agenda. */
  scoped?: boolean;
  /** The week shows its hour grid; the button that switches it is in the week view. */
  hours?: boolean;
  onHours?(): void;
  onMode(mode: Mode): void;
  onStep(step: 1 | -1): void;
  onToday(): void;
}

const MODES: { id: Mode; label: string; key: string }[] = [
  { id: "month", label: "Month", key: "M" },
  { id: "week", label: "Week", key: "W" },
  { id: "agenda", label: "Agenda", key: "A" },
];

export function Header({ title, count, mode, scoped = false, hours = false, onHours, onMode, onStep, onToday }: HeaderProps) {
  const unit = mode === "week" ? "week" : "month";
  return (
    <header className="kasten-cal-head">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="kasten-cal-title" aria-live="polite">
          {title}
        </h1>
        {count > 0 && (
          <span className="kasten-cal-count" title="Notes with a date property, such as a task's due day">
            {count.toLocaleString()} dated {count === 1 ? "note" : "notes"}
          </span>
        )}
      </div>
      <div className="kasten-cal-controls">
        {!scoped && <ShowMenu />}
        {mode === "week" && !scoped && onHours && (
          <button type="button" className="kasten-cal-today kasten-cal-hours-toggle" aria-pressed={hours} title="Show the week by the hour (H)" onClick={onHours}>
            <Icon name="clock" className="size-4" />
            Hours
          </button>
        )}
        <button type="button" className="kasten-cal-today" title="Today (T)" onClick={onToday}>
          Today
        </button>
        <div className="flex items-center">
          <StepButton step={-1} label={`Previous ${unit}`} onStep={onStep} />
          <StepButton step={1} label={`Next ${unit}`} onStep={onStep} />
        </div>
        <div role="group" aria-label="Show" className="kasten-cal-modes">
          {MODES.filter((m) => !scoped || m.id !== "agenda").map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} title={`${m.label} (${m.key})`} onClick={() => onMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

/** ‹ or ›: a click turns the page, and so does a chip held over it. */
function StepButton({ step, label, onStep }: { step: 1 | -1; label: string; onStep(step: 1 | -1): void }) {
  const actions = useCalendarActions();
  return (
    <button
      type="button"
      className="kasten-cal-step"
      aria-label={label}
      title={`${label} (${step < 0 ? "←" : "→"})`}
      onClick={() => onStep(step)}
      onDragEnter={(event) => actions.dragStep(step, event)}
      onDragOver={(event) => actions.dragStep(step, event)}
      onDragLeave={actions.dragStepEnd}
      onDrop={(event) => {
        event.preventDefault();
        actions.dragEnd();
      }}
    >
      <Icon name={step < 0 ? "back" : "forward"} className="size-4" />
    </button>
  );
}

/** Shown while no note has a date: what the Calendar is for, and a start.
 * `scope` names the tag and date property a tag database's calendar shows. */
export function EmptyState({ onAdd, scope }: { onAdd(): void; scope?: { tag: string; date?: string } }) {
  if (scope) {
    return (
      <section className="kasten-cal-empty" aria-label="Nothing dated yet">
        <span className="kasten-cal-empty-icon" aria-hidden="true">
          <Icon name="calendar" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-14 font-semibold">
            No #{scope.tag} notes with {scope.date ? `a ${scope.date}` : "a date"} yet
          </h2>
          <p className="mt-0.5 text-13 leading-relaxed text-muted">Add one here, or double-click a day. Drag a note to another day to change its date.</p>
        </div>
        <button type="button" className="kasten-cal-empty-add" onClick={onAdd}>
          <Icon name="plus" className="size-4" />
          New #{scope.tag} today
        </button>
      </section>
    );
  }
  return (
    <section className="kasten-cal-empty" aria-label="Nothing dated yet">
      <span className="kasten-cal-empty-icon" aria-hidden="true">
        <Icon name="calendar" className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-14 font-semibold">Nothing on the calendar yet</h2>
        <p className="mt-0.5 text-13 leading-relaxed text-muted">
          Everything with a day shows up here: journal pages, notes with a date property (a task’s due date, a trip from its start to its end), to-dos that name a day, such as “call
          Ana @2026-10-02”, and pages that link a day. Click a day to open its journal; its + adds a to-do, a task, a note or a page. Drag a note to another day to reschedule it.
        </p>
      </div>
      <button type="button" className="kasten-cal-empty-add" onClick={onAdd}>
        <Icon name="plus" className="size-4" />
        New task today
      </button>
    </section>
  );
}
