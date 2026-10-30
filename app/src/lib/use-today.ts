// "Today" for a view that stays open past midnight. `useToday` is the local
// day (YYYY-MM-DD) and moves on by itself: a timer is set for the next
// midnight, and the day is looked at again when the window gets focus or
// becomes visible (a sleeping laptop misses timers). `useNow` is the clock, for
// things said in minutes ("in 12 min").

import { useEffect, useState } from "react";

import { dayFrom } from "./dates";
import { startInterval } from "./use-interval";
import { onWake } from "./wake";

/** Milliseconds until the next local midnight (at least one second, so a timer never spins). */
export function msToMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function useToday(): string {
  const [day, setDay] = useState(() => dayFrom(0));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      setDay(dayFrom(0));
      clearTimeout(timer);
      // A little past midnight, so the clock has certainly turned.
      timer = setTimeout(look, msToMidnight() + 50);
    };
    const onVisible = () => {
      if (document.visibilityState !== "hidden") look();
    };
    look();
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", onVisible);
    // A sleep or a clock change: the timer set for midnight may be hours off.
    const stopWake = onWake(look);
    return () => {
      stopWake();
      clearTimeout(timer);
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return day;
}

/** The time of day, drawn again every `ms` while the window is visible (and at once when it returns). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const stop = startInterval(() => setNow(new Date()), ms);
    return stop;
  }, [ms]);
  return now;
}

/** Minutes since local midnight. */
export const minutesSinceMidnight = (now: Date): number => now.getHours() * 60 + now.getMinutes();
