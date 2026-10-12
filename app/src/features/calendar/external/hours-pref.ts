// Whether the week shows its hour grid: a preference of this window, kept in
// its storage like the Calendar's month, week or agenda.

import { useCallback, useState } from "react";

const KEY = "kasten.calendar.hours";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function save(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // The view is a convenience; losing it is fine.
  }
}

/** Whether the hour grid is on, and the way to switch it. */
export function useHoursPref(): [boolean, () => void] {
  const [on, setOn] = useState(load);
  const toggle = useCallback(() => {
    setOn((now) => {
      save(!now);
      return !now;
    });
  }, []);
  return [on, toggle];
}
