// What a project page says about how the project is going, read from its
// properties: the status (Active until it says otherwise), and the health
// when one is set. The Projects hub, the sidebar's rows and the project's own
// page all read it the same way. Pure.

import { PROJECT_HEALTHS, PROJECT_STATUSES, type ProjectHealth, type ProjectStatus } from "../../../lib/vault/project-types";

/** A status the page names that the app does not know. */
export type StatusOrOther = ProjectStatus | "Other";
export type HealthOrOther = ProjectHealth | "Other";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The status a project's properties name: Active when none is named, `Other` when it is a word the app does not know. */
export function statusOfProps(props: Readonly<Record<string, unknown>>): StatusOrOther {
  const value = text(props.status);
  if (value === null) return "Active";
  return PROJECT_STATUSES.find((s) => s.toLowerCase() === value.toLowerCase()) ?? "Other";
}

/** The health a project's properties name; null when none is set. */
export function healthOfProps(props: Readonly<Record<string, unknown>>): HealthOrOther | null {
  const value = text(props.health);
  if (value === null) return null;
  return PROJECT_HEALTHS.find((h) => h.toLowerCase() === value.toLowerCase()) ?? "Other";
}

/** Whether a project is set aside (Paused) or finished (Done): rows and cards show it quietly. */
export const isDormant = (status: StatusOrOther): boolean => status === "Paused" || status === "Done";
