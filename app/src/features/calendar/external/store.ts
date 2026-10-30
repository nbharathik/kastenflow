// The subscribed calendars this window knows, and their events for the days
// a view shows. One store, so Settings, the Calendar's Show menu, Home and the
// journal agree, and the desktop app's "calendars-changed" reaches them all.

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import * as api from "./api";
import { shownEvents } from "./external";
import type { CalendarChange, CalendarInfo, ExternalEvent } from "./types";

/** A calendar not asked for in this long is refreshed when the Calendar opens. */
export const STALE_MINUTES = 5;

interface FeedsState {
  /** Null until the desktop app has answered. */
  list: CalendarInfo[] | null;
  /** Counts every change, so event lists are asked for again. */
  version: number;
  /** Asks the desktop app for the list; one already being asked for is
   * waited for, unless `force`d. */
  load(force?: boolean): Promise<void>;
  /** Refreshes the shown calendars not asked for in `maxAgeMinutes`, or
   * all of them without it; with `id`, only that one, now. Never rejects: a
   * calendar that could not be reached says so in its own `error`. */
  refresh(maxAgeMinutes?: number | null, id?: string | null): Promise<void>;
  add(name: string, url: string, color: string): Promise<CalendarInfo>;
  edit(id: string, change: CalendarChange): Promise<CalendarInfo>;
  remove(id: string): Promise<void>;
}

let listening = false;
/** The list being asked for now, so views that mount together ask once. */
let asking: Promise<void> | null = null;

export const useFeeds = create<FeedsState>((set, get) => {
  const take = (list: CalendarInfo[]) => set((s) => ({ list, version: s.version + 1 }));
  return {
    list: null,
    version: 0,
    load(force = false) {
      if (!listening) {
        listening = true;
        // A change the desktop app announces is always asked for afresh.
        void api.onCalendarsChanged(() => void get().load(true));
      }
      if (asking && !force) return asking;
      const now = (async () => {
        try {
          take(await api.calendarsList());
        } catch {
          set((s) => ({ list: s.list ?? [] }));
        }
      })().finally(() => {
        if (asking === now) asking = null;
      });
      asking = now;
      return now;
    },
    async refresh(maxAgeMinutes = null, id = null) {
      try {
        take(await api.calendarRefresh(id, id ? null : maxAgeMinutes));
      } catch {
        // The list as it was; each calendar keeps its own error.
      }
    },
    async add(name, url, color) {
      const made = await api.calendarAdd(name, url, color);
      await get().load(true);
      return made;
    },
    async edit(id, change) {
      const changed = await api.calendarEdit(id, change);
      set((s) => ({ list: (s.list ?? []).map((c) => (c.id === id ? changed : c)), version: s.version + 1 }));
      return changed;
    },
    async remove(id) {
      try {
        take(await api.calendarRemove(id));
      } catch (error) {
        // Removed from the list even when the keychain would not answer.
        await get().load(true);
        throw error;
      }
    },
  };
});

/** The subscriptions, asked for once per window; null until known. */
export function useCalendars(): CalendarInfo[] | null {
  const list = useFeeds((s) => s.list);
  useEffect(() => {
    if (api.canSubscribe() && useFeeds.getState().list === null) void useFeeds.getState().load();
  }, []);
  return list;
}

const NONE: readonly ExternalEvent[] = [];

/** The events of the shown calendars on the days from `first` to `last`:
 * nothing while `enabled` is off, there are none, or in the browser preview. */
export function useExternalEvents(first: string, last: string, enabled = true): readonly ExternalEvent[] {
  return useExternalFeed(first, last, enabled).events;
}

/** `useExternalEvents` that also says when the events could not be read
 * (`failed`, so a card can say so instead of "nothing on"), with `retry`. */
export function useExternalFeed(first: string, last: string, enabled = true): { events: readonly ExternalEvent[]; failed: boolean; retry(): void } {
  const calendars = useCalendars();
  const version = useFeeds((s) => s.version);
  const [events, setEvents] = useState<readonly ExternalEvent[]>(NONE);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const anyShown = calendars?.some((c) => c.shown) ?? false;
  useEffect(() => {
    if (!enabled || !anyShown) return;
    let live = true;
    api.calendarEvents(first, last).then(
      (found) => {
        if (!live) return;
        setEvents(found.events);
        setFailed(false);
      },
      () => {
        if (!live) return;
        setEvents(NONE);
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, anyShown, first, last, version, tries]);
  const shown = useMemo(() => (enabled && anyShown ? shownEvents(events, calendars) : NONE), [enabled, anyShown, events, calendars]);
  return { events: shown, failed: enabled && anyShown && failed, retry: () => setTries((n) => n + 1) };
}
