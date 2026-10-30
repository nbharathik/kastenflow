// Home's "Today", for the whole day on a small card. All-day events are a row
// of chips. "Meetings" are the timed events: the ones that are over fold into
// "3 earlier", the one on now or next is marked, a thin line is the present.
// "Due today" is the to-dos with that day. Each group shows a few and opens
// the rest in place; "Calendar" is the link to the whole thing. A click on an
// event shows its details; events are read-only. A quiet day says so in one
// line, and a calendar that could not be read says that instead.

import "../calendar/external/external.css";

import { useMemo, useState } from "react";

import { minutesSinceMidnight, useNow, useToday } from "../../lib/use-today";
import { DashCard, DashEmpty } from "../dashboard/DashCard";
import { SeeAll } from "../dashboard/Minis";
import { useTaskList } from "../dashboard/task-rows";
import { TodoRow } from "../dashboard/TodoList";
import { canSubscribe } from "../calendar/external/api";
import { partsByDay } from "../calendar/external/external";
import { useExternalFeed, useFeeds } from "../calendar/external/store";
import { useWorkspace } from "../workspace/store";
import { Fold, FoldToggle } from "./Fold";
import { roveKeys } from "./roving";
import { AllDayChip, EventRow } from "./ScheduleRows";
import { buildToday, GROUP_LIMIT, inWords, namesOf, type Meeting } from "./today-model";

export { dueOn } from "./today-model";

export function Schedule() {
  const today = useToday();
  const now = minutesSinceMidnight(useNow());
  const { events, failed, retry } = useExternalFeed(today, today, canSubscribe());
  const calendars = useFeeds((s) => s.list);
  const parts = useMemo(() => partsByDay(events, today, today).get(today) ?? [], [events, today]);
  const rows = useTaskList();
  const day = useMemo(() => buildToday(parts, rows, today, now), [parts, rows, today, now]);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const calendar = () => useWorkspace.getState().go({ view: "calendar" });

  const meetingRows = (list: readonly Meeting[], past = false) =>
    list.map((m) => {
      const here = m.start <= now && m.end > now && m.end !== m.start;
      const caption = here ? "Now" : day.next?.meeting === m ? `Next up · ${inWords(day.next.minutes)}` : null;
      return <EventRow key={m.part.key} meeting={m} past={past} caption={caption} />;
    });
  const todoRow = (t: (typeof day.due)[number]) => <TodoRow key={`${t.row.path}:${t.row.line}`} row={t.row} today={today} showPage={false} timed />;

  const upcomingNow = day.upcoming.slice(0, GROUP_LIMIT);
  const upcomingRest = day.upcoming.slice(GROUP_LIMIT);
  const dueNow = day.due.slice(0, GROUP_LIMIT);
  const dueRest = day.due.slice(GROUP_LIMIT);
  const empty = day.allDay.length + day.earlier.length + day.upcoming.length + day.due.length === 0;
  const over = day.allDay.length + day.upcoming.length + day.due.length === 0;
  const names = namesOf((calendars ?? []).filter((c) => c.shown).map((c) => c.name));

  return (
    <DashCard title="Today" icon="calendar" actions={<SeeAll label="Open calendar" run={calendar} />}>
      {failed && (
        <DashEmpty>
          Couldn't reach {names} —{" "}
          <button type="button" className="kasten-dash-link" onClick={retry}>
            Try again
          </button>
        </DashEmpty>
      )}
      {rows === null && empty ? (
        <div className="kasten-todo-skeleton" aria-hidden="true">
          <span className="kasten-todo-bone" />
          <span className="kasten-todo-bone" />
        </div>
      ) : empty ? (
        !failed && <DashEmpty>Nothing on today.</DashEmpty>
      ) : (
        <div className="kasten-today" onKeyDown={roveKeys}>
          {day.allDay.length > 0 && (
            <ul className="kasten-today-chips" aria-label="All day">
              {day.allDay.map((part) => (
                <AllDayChip key={part.key} part={part} />
              ))}
            </ul>
          )}
          {(day.earlier.length > 0 || day.upcoming.length > 0) && (
            <section className="kasten-today-group" aria-label="Meetings">
              <h4>Meetings</h4>
              {day.earlier.length > 0 && (
                <>
                  <button type="button" data-rove="" className="kasten-today-earlier" aria-expanded={earlierOpen} aria-controls="today-earlier" onClick={() => setEarlierOpen((o) => !o)}>
                    {day.earlier.length} earlier
                  </button>
                  <Fold open={earlierOpen} id="today-earlier">
                    <ul className="kasten-today-list">{meetingRows(day.earlier, true)}</ul>
                  </Fold>
                  {day.upcoming.length > 0 && <div role="separator" aria-label="Now" className="kasten-now-line" />}
                </>
              )}
              <ul className="kasten-today-list">{meetingRows(upcomingNow)}</ul>
              {upcomingRest.length > 0 && (
                <>
                  <Fold open={meetingsOpen} id="today-meetings">
                    <ul className="kasten-today-list">{meetingRows(upcomingRest)}</ul>
                  </Fold>
                  <FoldToggle open={meetingsOpen} label={`+${upcomingRest.length} more`} controls="today-meetings" onToggle={() => setMeetingsOpen((o) => !o)} />
                </>
              )}
            </section>
          )}
          {day.due.length > 0 && (
            <section className="kasten-today-group" aria-label="Due today">
              <h4>Due today</h4>
              <ul className="kasten-today-list">{dueNow.map(todoRow)}</ul>
              {dueRest.length > 0 && (
                <>
                  <Fold open={dueOpen} id="today-due">
                    <ul className="kasten-today-list">{dueRest.map(todoRow)}</ul>
                  </Fold>
                  <FoldToggle open={dueOpen} label={`+${dueRest.length} more`} controls="today-due" onToggle={() => setDueOpen((o) => !o)} />
                </>
              )}
            </section>
          )}
          {over && <DashEmpty>Nothing more today.</DashEmpty>}
        </div>
      )}
    </DashCard>
  );
}
