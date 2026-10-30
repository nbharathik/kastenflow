// A collection in words, for headers, cards and the save dialog.

import type { Collection, CollectionWhen, WhenField, WhenToken } from "../../lib/vault/collection-types";

const SPANS: Record<WhenToken, string> = {
  today: "today",
  yesterday: "yesterday",
  "this-week": "this week",
  "last-7-days": "in the last 7 days",
  "last-30-days": "in the last 30 days",
  "this-month": "this month",
  "last-month": "last month",
  "this-year": "this year",
  "next-7-days": "in the next 7 days",
};

const FIELDS: Record<WhenField, string> = { updated: "changed", created: "made", on: "made or changed" };

/** "changed in the last 30 days"; empty for no days. */
export function describeWhen(when: CollectionWhen | null): string {
  if (!when) return "";
  const parts = (Object.entries(when) as [WhenField, WhenToken | undefined][]).filter((entry): entry is [WhenField, WhenToken] => entry[1] !== undefined).map(([field, token]) => `${FIELDS[field]} ${SPANS[token]}`);
  return parts.join(" and ");
}

const KINDS = { table: "a table", kanban: "a board", list: "a list", calendar: "a calendar", gallery: "a gallery", timeline: "a timeline" } as const;

/** "a table of up to 500 notes". */
export function describeDisplay(collection: Pick<Collection, "display">): string {
  const display = collection.display;
  const kind = display?.type ? KINDS[display.type] : "a table";
  return display?.limit ? `${kind} of up to ${display.limit.toLocaleString()} notes` : kind;
}
