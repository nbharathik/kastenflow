import { useEffect, useMemo, useState } from "react";

import type { TagSchema, TaskRow } from "../../lib/vault/types";
import { Disclosure } from "../../ui/Disclosure";
import { activityByDay, dateItems, dateRanges } from "../calendar/dates";
import { partsByDay } from "../calendar/external/external";
import { useExternalEvents } from "../calendar/external/store";
import { rangesBetween } from "../calendar/ranges";
import { useSchemas } from "../calendar/use-data";
import { useWorkspace } from "../workspace/store";
import { OnThisDay } from "./OnThisDay";

const NO_SCHEMAS: readonly TagSchema[] = [];
const NO_TASKS: readonly TaskRow[] = [];

/** Below a journal day, folded into one toggle:
 * what is under way, what is due, and the notes made or edited that day.
 * The toggle's title counts them, so a glance says whether to open it. */
export function DayActivity({ day }: { day: string }) {
  const notes = useWorkspace((s) => s.notes);
  const client = useWorkspace((s) => s.client);
  const schemas = useSchemas(client) ?? NO_SCHEMAS;
  const [tasks, setTasks] = useState<readonly TaskRow[]>(NO_TASKS);
  // Events of the subscribed calendars on this day (none in the browser preview).
  const happening = useExternalEvents(day, day, true);
  const events = useMemo(() => partsByDay(happening, day, day).get(day) ?? [], [happening, day]);

  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => client.tasks().then(setTasks, () => {}), 300);
    return () => clearTimeout(timer);
  }, [client, notes]);

  const found = useMemo(() => {
    const activity = activityByDay(notes).get(day);
    return {
      ongoing: rangesBetween(dateRanges(notes, schemas), day, day),
      due: dateItems(notes, schemas).filter((item) => item.day === day),
      tasks: tasks.filter((t) => t.due === day && !t.done),
      made: activity?.created ?? [],
      edited: activity?.edited ?? [],
    };
  }, [notes, schemas, tasks, day]);

  const parts = [
    [events.length, events.length === 1 ? "event" : "events"],
    [found.ongoing.length, "ongoing"],
    [found.due.length + found.tasks.length, "due"],
    [found.made.length, "made"],
    [found.edited.length, "edited"],
  ] as const;
  const summary = parts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  if (summary.length === 0) return null;
  return (
    <Disclosure id="journal.on-this-day" title="On this day" meta={summary.join(" · ")}>
      <OnThisDay day={day} {...found} events={events} />
    </Disclosure>
  );
}
