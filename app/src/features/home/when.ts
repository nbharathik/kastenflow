// A time in as few characters as a list row can spare: "now", "12m", "3h",
// "Yesterday", "4d", then the day itself. The full words are on the row's tooltip.

import { relativeTime } from "../../lib/dates";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function ago(millis: number, now = Date.now()): string {
  const passed = Math.max(0, now - millis);
  if (passed < 45_000) return "now";
  if (passed < HOUR) return `${Math.max(1, Math.floor(passed / MINUTE))}m`;
  if (passed < DAY) return `${Math.floor(passed / HOUR)}h`;
  const days = Math.round(passed / DAY);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  return new Date(millis).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The row's tooltip: the long form of the same time. */
export const agoLong = (millis: number): string => relativeTime(millis);
