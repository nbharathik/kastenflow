// The words for the errors a smart page's code ran into (the kit catches
// them and the app keeps the last 50 per page).

import type { ErrorRecord } from "../../lib/vault/smart-types";

/** "1 error", "2 errors". */
export function countWords(count: number): string {
  return `${count} ${count === 1 ? "error" : "errors"}`;
}

/** The time of an error as the person reads it; the text as it is when it is not a time. */
export function whenWords(time: string): string {
  const at = new Date(time);
  return Number.isNaN(at.getTime()) ? time : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Where in the page's code it happened, if the page said: "app.js, line 12". */
export function placeWords(record: ErrorRecord): string {
  if (!record.source) return "";
  const file = record.source.split(/[/\\]/).pop() || record.source;
  return record.line ? `${file}, line ${record.line}` : file;
}

/** The newest first, for a list. */
export function newestFirst(records: ErrorRecord[]): ErrorRecord[] {
  return [...records].reverse();
}
