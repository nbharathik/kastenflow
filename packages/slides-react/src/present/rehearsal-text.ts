// The words and numbers a rehearsal shows.

const two = (n: number): string => String(n).padStart(2, "0");

/** `0:05`, `12:03` or `1:12:03`: how long, to the second. */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(total % 60)}` : `${m}:${two(total % 60)}`;
}

/** `+0:10`, `−1:05` or `±0:00`: how much longer or shorter this time was than the last. */
export function deltaText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds === 0) return "±0:00";
  return `${seconds > 0 ? "+" : "−"}${durationText(Math.abs(seconds) * 1000)}`;
}

/** What a person says of a run in a list: the day and the time of day it ended. */
export function whenText(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
