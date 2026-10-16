import "../pages/editor/styles/tokens.css";
import "./calendar.css";
import "./grid.css";
import "./chips.css";
import "./bars.css";
import "./days.css";
import "./external/external.css";
import "./external/hours.css";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { dayFrom } from "../../lib/dates";
import { freeKey, inFocusedPane } from "../../lib/keys";
import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import { useNoteHome } from "../tags/home";
import { notesWith } from "../tags/model";
import { CALENDAR_SHOW, usePrefs } from "../workspace/prefs";
import { howFromView, useWorkspace } from "../workspace/store";
import { ActionsContext, type Adding, type CalendarActions, type Dragged } from "./actions";
import { addOnDay } from "./add";
import { AgendaList } from "./AgendaList";
import { addDays, byDay, dateItems, dateRanges, type DateItem } from "./dates";
import { canSubscribe } from "./external/api";
import { EventPopoverProvider } from "./external/EventPopoverProvider";
import { partsByDay } from "./external/external";
import { HourWeek } from "./external/HourWeek";
import { useHoursPref } from "./external/hours-pref";
import { makeEventNote } from "./external/meeting-note";
import { STALE_MINUTES, useExternalEvents, useFeeds } from "./external/store";
import { EmptyState, Header } from "./Header";
import { calendarKey, clampEnd, itemId, landing, periodDays, periodTitle, shiftAnchor, withMoves, withRangeMoves, type Mode } from "./layout";
import { MonthGrid } from "./MonthGrid";
import { rangeId, rangesBetween, type DateRange } from "./ranges";
import { useDatedTasks, useDayMentions, useJournalPages, useMadeByDay, useSchemas, useTagColors } from "./use-data";
import { useDrag, type Carried } from "./use-drag";
import { itemTarget, rangeTarget, useMoves } from "./use-moves";
import { WeekGrid } from "./WeekGrid";

const MODE_KEY = "kasten.calendar";
const NO_TASKS: TaskRow[] = [];
const NO_ITEMS: DateItem[] = [];
const NO_RANGES: DateRange[] = [];
const NO_JOURNALS = new Map<string, never>();
const SCOPED_SHOW = { ...CALENDAR_SHOW, journal: false, tasks: false, mentions: false, made: false };

/** A tag database's calendar: only this tag's notes, placed by one of its
 * date properties, with no to-dos or journal days. */
export interface CalendarScope {
  tag: string;
  date?: string;
  /** The notes its view shows, its filters applied; else every note
   * carrying the tag. */
  notes?: readonly NoteMeta[];
}

const MODES: readonly Mode[] = ["month", "week", "agenda"];

function loadMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY) as Mode;
    return MODES.includes(saved) ? saved : "month";
  } catch {
    return "month";
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // The view is a convenience; losing it is fine.
  }
}

/** The Calendar: the whole
 * app by day. A month, a week or an agenda of every note with a date
 * property, every to-do that names a day, each day's journal, the notes
 * that mention a day and, if asked, the notes made on it; Show chooses.
 * Dragging a note to another day, or Alt+arrows on it, changes that
 * property through the core. A click on a day shows its journal; its "+"
 * adds a to-do, a task, a note or a page on it. */
export function CalendarView({ scope }: { scope?: CalendarScope }) {
  const client = useWorkspace((s) => s.client);
  const everything = useWorkspace((s) => s.notes);
  const scopeTag = scope?.tag;
  const scopeDate = scope?.date;
  const scopeNotes = scope?.notes;
  // A tag database's calendar shows its notes by date, and nothing else.
  const chosen = usePrefs((s) => s.calendarShow);
  const show = scopeTag ? SCOPED_SHOW : chosen;
  const notes = useMemo(() => scopeNotes ?? (scopeTag ? notesWith(everything, scopeTag) : everything), [everything, scopeTag, scopeNotes]);
  const schemas = useSchemas(client);
  const colors = useTagColors(schemas);
  const allTasks = useDatedTasks(client, notes);
  const allJournals = useJournalPages(notes);
  const tasks = show.tasks ? allTasks : allTasks && NO_TASKS;
  const journals = show.journal ? allJournals : NO_JOURNALS;
  const moves = useMoves();
  const home = useNoteHome();
  const today = dayFrom(0);

  const [chosenMode, setMode] = useState<Mode>(loadMode);
  // A tag database's calendar has no agenda of its own.
  const mode: Mode = scope && chosenMode === "agenda" ? "month" : chosenMode;
  const [anchor, setAnchor] = useState(today);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);

  const items = useMemo(() => {
    const found = schemas && show.dated ? dateItems(notes, schemas) : NO_ITEMS;
    return scopeDate ? found.filter((item) => item.key === scopeDate) : found;
  }, [notes, schemas, scopeDate, show.dated]);
  const ranges = useMemo(() => {
    const found = schemas && show.dated ? dateRanges(notes, schemas) : NO_RANGES;
    return scopeDate ? found.filter((range) => range.startKey === scopeDate || range.endKey === scopeDate) : found;
  }, [notes, schemas, scopeDate, show.dated]);
  const shown = useMemo(() => withMoves(items, moves.pending), [items, moves.pending]);
  const shownRanges = useMemo(() => withRangeMoves(ranges, moves.pending), [ranges, moves.pending]);
  const itemsByDay = useMemo(() => byDay(shown), [shown]);
  const tasksByDay = useMemo(() => byDay((tasks ?? NO_TASKS).map((task) => ({ ...task, day: task.due! }))), [tasks]);
  const weekStart = usePrefs((s) => s.weekStart);
  const days = useMemo(() => periodDays(anchor, mode, weekStart), [anchor, mode, weekStart]);
  const first = days[0]![0]!;
  const last = days.at(-1)!.at(-1)!;
  const periodRanges = useMemo(() => rangesBetween(shownRanges, first, last), [shownRanges, first, last]);
  const mentions = useDayMentions(client, first, last, notes, show.mentions);
  const made = useMadeByDay(notes, first, last, show.made);
  // Events of the subscribed calendars: read-only, not in a tag database's calendar.
  const externalEvents = useExternalEvents(first, last, !scopeTag);
  const events = useMemo(() => partsByDay(externalEvents, first, last), [externalEvents, first, last]);
  const [hours, toggleHours] = useHoursPref();
  const count = useMemo(() => {
    const paths = new Set<string>();
    for (const item of items) paths.add(item.path);
    for (const range of ranges) paths.add(range.path);
    return paths.size;
  }, [items, ranges]);
  const loading = schemas === null || tasks === null;
  // Nothing on any day, whatever Show hides: the empty state explains.
  const anyDated = useMemo(() => schemas !== null && (dateItems(notes, schemas).length > 0 || dateRanges(notes, schemas).length > 0), [notes, schemas]);
  const empty = !loading && (scopeTag ? items.length === 0 && ranges.length === 0 : !anyDated && (allTasks?.length ?? 0) === 0 && allJournals.size === 0 && externalEvents.length === 0);

  // Opening the Calendar looks at the subscribed calendars not asked for lately.
  useEffect(() => {
    if (!scopeTag && canSubscribe()) void useFeeds.getState().refresh(STALE_MINUTES);
  }, [scopeTag]);

  // Handlers read the latest state from here, so `actions` never changes.
  const latest = useRef({ shown, shownRanges, days, schemas, move: moves.move, mode, scope, journals: allJournals, home });
  useLayoutEffect(() => {
    latest.current = { shown, shownRanges, days, schemas, move: moves.move, mode, scope, journals: allJournals, home };
  });

  // Going to another period or view; a field or popover left open belongs to the old one.
  const nav = useMemo(() => {
    const show = (next: string | ((current: string) => string)) => {
      setAnchor(next);
      setAdding(null);
      setExpanded(null);
    };
    return {
      show,
      turn: (step: 1 | -1) => show((current) => shiftAnchor(current, latest.current.mode, step, dayFrom(0))),
      setMode: (next: Mode) => {
        setMode(next);
        saveMode(next);
        setAdding(null);
        setExpanded(null);
      },
    };
  }, []);

  const drag = useDrag({
    find: (carried: Carried): Dragged | undefined => {
      if (carried.kind === "item") {
        const item = latest.current.shown.find((i) => itemId(i) === carried.id);
        return item && { kind: "item", item };
      }
      const range = latest.current.shownRanges.find((r) => rangeId(r) === carried.id);
      if (!range) return undefined;
      return carried.kind === "end" ? { kind: "end", range } : { kind: "range", range, from: carried.from ?? range.start };
    },
    drop: (dragged, day) => {
      setExpanded(null);
      if (dragged.kind === "item") return latest.current.move(itemTarget(dragged.item), [day]);
      const { start, end } = landing(dragged, day);
      latest.current.move(rangeTarget(dragged.range), [start, end]);
    },
    // An event of a subscribed calendar makes a note for the day; the calendar is never written.
    event: (dropped, day) => {
      setExpanded(null);
      void makeEventNote(dropped, day);
    },
    turn: nav.turn,
  });

  // A chip moved by keyboard lands in another cell: focus follows it there.
  useLayoutEffect(() => {
    const id = focusNext.current;
    if (!id || !root.current) return;
    const chip = [...root.current.querySelectorAll<HTMLElement>("[data-chip]")].find((el) => el.dataset.chip === id);
    if (!chip) return;
    focusNext.current = null;
    if (document.activeElement !== chip) chip.focus();
  });

  const actions = useMemo<CalendarActions>(() => {
    const ws = () => useWorkspace.getState();
    return {
      ...drag.actions,
      // A page from the calendar peeks over it (Settings: where pages open).
      open: (path, how) => ws().openPath(path, typeof how === "string" ? how : howFromView(how)),
      // The day's journal peeks too; a day nobody wrote in offers to start.
      openDay: (day, event) => {
        const page = latest.current.journals.get(day);
        if (page) ws().openPath(page.path, howFromView(event));
        else void ws().openJournal(day, howFromView(event));
      },
      writeDay: async (day) => {
        const path = await ws().ensureJournal(day);
        if (path) ws().openPath(path, "peek");
      },
      addOn: (day, kind = "task") => {
        setAdding(day ? { day, kind } : null);
        if (day) setExpanded(null);
      },
      add: async (day, kind, title) => {
        const { scope: within, schemas: known, home: where } = latest.current;
        const added = await addOnDay(kind, day, title, { scope: within, schemas: known, home: where });
        // A page opens to be written in; its field has done its work.
        if (added && kind === "page" && !within) setAdding(null);
        return added;
      },
      expand: (day) => setExpanded(day),
      nudge: (item, days) => {
        const to = addDays(item.day, days);
        const id = itemId(item);
        latest.current.move(itemTarget(item), [to], true);
        setPinned(id);
        focusNext.current = id;
        if (!latest.current.days.some((week) => week.includes(to))) nav.show(to);
      },
      nudgeRange: (range, days, end) => {
        const start = end ? range.start : addDays(range.start, days);
        const last = end ? clampEnd(range.start, addDays(range.end, days)) : addDays(range.end, days);
        const id = rangeId(range);
        latest.current.move(rangeTarget(range), [start, last], true);
        setPinned(id);
        focusNext.current = id;
        // Follow it when it leaves the days shown altogether.
        const shownDays = latest.current.days;
        if (last < shownDays[0]![0]! || start > shownDays.at(-1)!.at(-1)!) nav.show(start);
      },
    };
  }, [drag.actions, nav]);

  // ←/→ a period, T today, M month, W week: outside fields, in the focused pane.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A dialog over the calendar, such as a peek, keeps its keys.
      const inDialog = Boolean((event.target as HTMLElement | null)?.closest?.('[role="dialog"]'));
      if (!freeKey(event) || inDialog || !inFocusedPane(root.current)) return;
      const key = calendarKey(event);
      if (!key) return;
      event.preventDefault();
      if (key === "prev" || key === "next") nav.turn(key === "prev" ? -1 : 1);
      else if (key === "today") nav.show(dayFrom(0));
      else if (key === "hours") {
        if (latest.current.mode === "week") toggleHours();
      } else if (key !== "agenda" || !latest.current.scope) nav.setMode(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, toggleHours]);

  const grid = {
    days,
    today,
    items: itemsByDay,
    tasks: tasksByDay,
    ranges: periodRanges,
    journals,
    mentions,
    made,
    events,
    colors,
    lit: drag.lit,
    adding,
    expanded,
    dragging: drag.dragging,
    pinned,
    scopeTag: scopeTag ?? null,
  };
  return (
    <ActionsContext.Provider value={actions}>
      <EventPopoverProvider>
        <div ref={root} className={`kasten-cal${scope ? " is-embedded" : ""}`} aria-busy={loading} data-dragging={drag.dragging ? "" : undefined}>
          <Header title={periodTitle(anchor, mode, weekStart)} count={count} mode={mode} scoped={Boolean(scope)} hours={hours} onHours={toggleHours} onMode={nav.setMode} onStep={nav.turn} onToday={() => nav.show(dayFrom(0))} />
          {empty && (
            <EmptyState
              scope={scope}
              onAdd={() => {
                setAnchor(today);
                setAdding({ day: today, kind: "task" });
              }}
            />
          )}
          {mode === "month" ? <MonthGrid {...grid} month={anchor.slice(0, 7)} /> : mode === "week" ? hours ? <HourWeek {...grid} /> : <WeekGrid {...grid} /> : <AgendaList key={anchor.slice(0, 7)} {...grid} />}
        </div>
      </EventPopoverProvider>
    </ActionsContext.Provider>
  );
}
