// Where a video starts and stops, and how loud it is, as the show plays it. A video that names a start and an end plays only that part;
// every number is checked, because a deck may have been written by a person, an agent or a newer build.

export interface Trim {
  /** Seconds into the file where playing starts. */
  start: number;
  /** Seconds into the file where it stops; null for the end of the file. */
  end: number | null;
}

interface Trimmed {
  start?: number | null | undefined;
  end?: number | null | undefined;
}

const seconds = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e6 ? value : null);

/** The part of the file to play. An end at or before the start is no end at all. */
export function trimOf(video: Trimmed): Trim {
  const start = seconds(video.start) ?? 0;
  const end = seconds(video.end);
  return { start, end: end !== null && end > start ? end : null };
}

/** Whether the video has played past its end, so that it is time to stop (or go back to the start). */
export const pastEnd = (trim: Trim, time: number): boolean => trim.end !== null && time >= trim.end;

/** The place to pick up from: `time` kept inside the trimmed part. */
export function inside(trim: Trim, time: number): number {
  const low = Math.max(time, trim.start);
  return trim.end === null ? low : Math.min(low, trim.end);
}

/** The volume of a player, 0 to 1; 1 when the deck names none or something that is not a volume. */
export function volumeOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** `1:05` for 65 seconds, `0:07.5` with a fraction: how a place in a video reads in the format options. */
export function clock(time: number): string {
  const whole = Math.floor(time);
  const tenths = Math.round((time - whole) * 10);
  const base = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  return tenths > 0 && tenths < 10 ? `${base}.${tenths}` : base;
}
