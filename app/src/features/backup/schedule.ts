// "When to back up" as three plain choices, and the two numbers in the vault's
// settings each one stands for. The engine pushes when changes have been quiet
// for `push_delay_seconds`, or when the last push is older than
// `push_interval_minutes`; "only by hand" makes both a year.

export type When = "work" | "hourly" | "hand";

export interface PushTimes {
  push_delay_seconds: number;
  push_interval_minutes: number;
}

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export const WHEN: Record<When, PushTimes> = {
  work: { push_delay_seconds: 120, push_interval_minutes: 60 },
  hourly: { push_delay_seconds: 3600, push_interval_minutes: 60 },
  hand: { push_delay_seconds: YEAR_SECONDS, push_interval_minutes: YEAR_SECONDS / 60 },
};

/** Which choice the numbers are. Odd numbers (set by hand in the file) read as the nearest: quick is "as I work". */
export function whenOf(git: PushTimes): When {
  if (git.push_delay_seconds >= YEAR_SECONDS / 2) return "hand";
  if (git.push_delay_seconds >= 1800) return "hourly";
  return "work";
}

export const WHEN_WORDS: Record<When, string> = {
  work: "2 minutes after you stop changing things, and at least once an hour.",
  hourly: "Once an hour, when something has changed.",
  hand: "Only when you close KastenFlow or choose Back up now.",
};
