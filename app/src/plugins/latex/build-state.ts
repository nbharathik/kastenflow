// What a document's build is doing, worked out from the `latex-build` events.
// Pure: the view reads it, and tests feed it events. Events of another
// document and of older builds are dropped, so a late "cancelled" for a build
// that was replaced never undoes the one that replaced it.

import type { BuildError, BuildEvent, BuildPhase, Diagnostic } from "./types";

export interface BuildState {
  phase: "idle" | BuildPhase;
  /** The newest build heard of. */
  seq: number;
  ms: number;
  diagnostics: Diagnostic[];
  /** The build that made the PDF the preview shows (0 when none yet); a bigger number means a new PDF to load. */
  pdfSeq: number;
  error: BuildError | null;
  /** What a long build is doing ("Downloading TeX packages…"). */
  note: string | null;
}

export const IDLE: BuildState = { phase: "idle", seq: 0, ms: 0, diagnostics: [], pdfSeq: 0, error: null, note: null };

export function reduce(state: BuildState, event: BuildEvent, folder: string): BuildState {
  if (event.doc !== folder || event.seq < state.seq) return state;
  const pdfSeq = event.pdf ? event.seq : state.pdfSeq;
  switch (event.state) {
    case "queued":
      return { ...state, phase: "queued", seq: event.seq, note: null, error: null };
    case "running":
      return { ...state, phase: "running", seq: event.seq, note: event.note ?? null, error: null };
    case "done":
      return { phase: "done", seq: event.seq, ms: event.ms, diagnostics: event.diagnostics, pdfSeq, error: null, note: null };
    case "failed":
      return { phase: "failed", seq: event.seq, ms: event.ms, diagnostics: event.diagnostics, pdfSeq, error: event.error ?? null, note: null };
    case "cancelled":
      return { ...state, phase: "cancelled", seq: event.seq, note: null, error: null };
  }
}

/** The last build ended with errors, or could not run. */
export const hasProblem = (state: BuildState): boolean => state.phase === "failed";

export const errorCount = (state: BuildState): number => state.diagnostics.filter((d) => d.severity === "error").length;

const timeOf = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** One short phrase for the status line. */
export function statusText(state: BuildState): string {
  switch (state.phase) {
    case "idle":
      return "Not built yet";
    case "queued":
      return "Waiting to build…";
    case "running":
      return state.note ?? "Building…";
    case "cancelled":
      return "Build stopped";
    case "done":
      return `Built in ${timeOf(state.ms)}`;
    case "failed": {
      const errors = errorCount(state);
      if (errors > 0) return `${errors} ${errors === 1 ? "error" : "errors"}`;
      return state.error?.message ?? "The build did not work";
    }
  }
}
