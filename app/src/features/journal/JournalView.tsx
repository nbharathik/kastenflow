import "./journal.css";

import { useEffect, useMemo, useState } from "react";

import { useToday } from "../../lib/use-today";
import type { TagSchema } from "../../lib/vault/types";
import { dateItems, dateRanges } from "../calendar/dates";
import { useEventDrop } from "../calendar/external/use-event-drop";
import { useSchemas } from "../calendar/use-data";
import { LazyNotePage } from "../workspace/page/LazyNotePage";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { journalDays } from "../workspace/tree";
import { BlankDay } from "./BlankDay";
import { DayList } from "./DayList";
import { dayMarks, dayOfPath } from "./feed";
import { pickDay } from "./JournalBar";

const NO_SCHEMAS: readonly TagSchema[] = [];

/** The journal: one day as a full page,
 * today unless another is picked, and beside it every earlier day to
 * scroll through. Days are places, so Back returns to the day before. */
export function JournalView({ path }: { path?: string }) {
  const notes = useWorkspace((s) => s.notes);
  const client = useWorkspace((s) => s.client);
  const schemas = useSchemas(client) ?? NO_SCHEMAS;
  const today = useToday();
  // Opened on today, it stays on that day past midnight: the page being
  // written never changes under the writer.
  const [openedOn] = useState(today);
  const day = dayOfPath(path, openedOn);
  const pages = useMemo(() => new Map(journalDays(notes).map((n) => [n.title, n])), [notes]);
  const marks = useMemo(() => dayMarks(notes, dateItems(notes, schemas), dateRanges(notes, schemas)), [notes, schemas]);
  const note = pages.get(day);
  const listOpen = usePrefs((s) => s.journalDays);
  // An event of a subscribed calendar dropped on the page makes a note for its day.
  const drop = useEventDrop(day);

  // Today's page exists as soon as the journal opens; other days only
  // once someone writes in them.
  useEffect(() => {
    if (day === today) void useWorkspace.getState().ensureJournal(today);
  }, [day, today]);


  return (
    <div className="kasten-journal">
      <div className="kasten-journal-main">
        <div className={`kasten-journal-page${drop.over ? " is-event-over" : ""}`} {...drop.props}>
          {note && client ? (
            <LazyNotePage key={note.path} client={client} path={note.path} />
          ) : day === today ? (
            <p className="kasten-note-message">Opening today…</p>
          ) : (
            <BlankDay day={day} />
          )}
        </div>
      </div>
      {listOpen && <DayList today={today} current={day} pages={pages} marks={marks} onPick={pickDay} />}
    </div>
  );
}
