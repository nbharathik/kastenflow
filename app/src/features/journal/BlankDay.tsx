// A day nobody wrote in: its date, and a way to start. The page is made only
// then, so looking back through days (in the journal, or at a day picked on
// the calendar) leaves no empty files.

import "./blank-day.css";

import { longDay } from "../../lib/dates";
import { Button } from "../../ui/Button";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";

/** The day a journal page's path names (`journal/2026/2026-10-02.md`). */
export const journalDayOf = (path: string) => /^journal\/\d{4}\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1] ?? null;

/** `onMade` hears where the page was made, once it is. */
export function BlankDay({ day, onMade }: { day: string; onMade?: (path: string) => void }) {
  // Laid out like the page it will become: the width preference decides the column.
  const width = usePrefs((s) => s.pageWidth);
  return (
    <div className={`kasten-journal-blank${width === "full" ? " is-full-width" : width === "wide" ? " is-wide" : ""}`}>
      <div className="kasten-page-column">
        <h1>{longDay(day)}</h1>
        <p>Nothing was written on this day.</p>
        <Button
          icon="compose"
          onClick={() =>
            void useWorkspace
              .getState()
              .ensureJournal(day)
              .then((path) => path && onMade?.(path))
          }
        >
          Write in this day
        </Button>
      </div>
    </div>
  );
}
