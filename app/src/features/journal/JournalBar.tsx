// The journal's controls, in the pane's top bar: which day, a step back or
// forward, today, the switch to the calendar and the list of days.

import { addDays, longDay } from "../../lib/dates";
import { useToday } from "../../lib/use-today";
import { Button, IconButton } from "../../ui/Button";
import { Segmented } from "../../ui/Segmented";
import { keyTitle } from "../shortcuts/store";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace, type OpenHow } from "../workspace/store";
import { dayOfPath, journalPath } from "./feed";

export function pickDay(day: string, how?: OpenHow): void {
  useWorkspace.getState().go({ view: "journal", path: journalPath(day) }, how);
}

/** "Journal › Friday, September 25, 2026", with ‹ › and Today. */
export function JournalCrumbs({ path }: { path?: string }) {
  const today = useToday();
  const day = dayOfPath(path, today);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate font-medium">Journal</span>
      <span aria-hidden="true" className="text-faint">
        ›
      </span>
      <span className="truncate text-muted">{longDay(day)}</span>
      <span className="ml-2 flex items-center">
        <IconButton icon="chevron-left" label="Previous day" title={keyTitle("Previous day", "prev-day")} size="sm" onClick={() => pickDay(addDays(day, -1))} />
        <IconButton icon="chevron" label="Next day" title={keyTitle("Next day", "next-day")} size="sm" onClick={() => pickDay(addDays(day, 1))} />
        <Button size="sm" tone="quiet" disabled={day === today} onClick={() => pickDay(today)}>
          Today
        </Button>
      </span>
    </span>
  );
}

/** The switch to the calendar, and the list of days beside the page. */
export function JournalActions() {
  const listOpen = usePrefs((s) => s.journalDays);
  return (
    <>
      <Segmented
        label="Journal or calendar"
        value="journal"
        className="mr-1"
        choices={[
          { value: "journal", label: "Journal" },
          { value: "calendar", label: "Calendar" },
        ]}
        onChange={(view) => view === "calendar" && useWorkspace.getState().go({ view: "calendar" })}
      />
      <IconButton
        icon={listOpen ? "peek-close" : "peek-side"}
        label={listOpen ? "Hide the days" : "Show the days"}
        onClick={() => usePrefs.getState().set({ journalDays: !listOpen })}
      />
    </>
  );
}
