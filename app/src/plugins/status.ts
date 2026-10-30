// What a plugin's card says: one plain status word, worked out from whether it
// is on and how far its download is.

import type { PayloadState } from "./registry";

export type StatusKind = "off" | "on" | "downloading" | "needs" | "update" | "failed";

export interface Status {
  kind: StatusKind;
  /** "Off", "On", "Downloading 43 %", "Needs download", "Update available" or "Failed". */
  text: string;
  /** 0 to 100 while a download runs and its size is known; null when not known. */
  percent: number | null;
}

/** "48 MB" for a download's size. */
export const megabytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

const RUNNING = ["downloading", "verifying", "installing"];

export function statusOf(on: boolean, hasPayload: boolean, payload: PayloadState | undefined): Status {
  const phase = payload?.phase ?? "idle";
  if (RUNNING.includes(phase)) {
    const total = payload?.total ?? 0;
    const percent = total > 0 ? Math.min(100, Math.floor(((payload?.done ?? 0) / total) * 100)) : null;
    const text = phase === "verifying" ? "Checking the download" : phase === "installing" ? "Installing" : percent === null ? "Downloading" : `Downloading ${percent} %`;
    return { kind: "downloading", text, percent };
  }
  if (!on) return { kind: "off", text: "Off", percent: null };
  if (phase === "failed") return { kind: "failed", text: "Failed", percent: null };
  if (hasPayload && !payload?.installed) {
    // An older download still works while the app waits for the new one.
    if (payload?.older) return { kind: "update", text: "Update available", percent: null };
    return { kind: "needs", text: "Needs download", percent: null };
  }
  return { kind: "on", text: "On", percent: null };
}

/** A line that is true of a plugin while it is on or off, shown on its card. */
export const NOTES: Record<string, string> = {
  latex: "The first build downloads TeX packages; later builds work offline.",
};

/** What turning a plugin off leaves: everything the person made. */
export const offLine = (id: string, name: string): string => `Your files stay; ${id === "diagrams" ? "the editor" : name} is off.`;
