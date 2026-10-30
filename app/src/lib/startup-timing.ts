// How long this window took to start, read from the page's own marks
// (`kasten:connected`, `kasten:listed`, `kasten:warm`, set while it starts),
// in milliseconds since the page began loading. Settings → About shows it.

export interface StartupMark {
  name: string;
  at: number;
}

/** The marks the page set, in the order reached. */
export function startupMarks(): StartupMark[] {
  const entries = performance.getEntriesByType?.("mark") ?? [];
  return entries
    .filter((m) => m.name.startsWith("kasten:"))
    .map((m) => ({ name: m.name.slice("kasten:".length), at: m.startTime }))
    .sort((a, b) => a.at - b.at);
}

/** "Startup: 640 ms" for the moment the sidebar was listed (else the vault was connected), or null before either. */
export function startupLine(marks: StartupMark[]): string | null {
  const ready = marks.find((m) => m.name === "listed") ?? marks.find((m) => m.name === "connected");
  return ready && Number.isFinite(ready.at) ? `Startup: ${Math.round(ready.at)} ms` : null;
}

/** Every mark on one line for a tooltip: "connected 410 ms · listed 640 ms". */
export function startupDetail(marks: StartupMark[]): string {
  return marks.map((m) => `${m.name} ${Math.round(m.at)} ms`).join(" · ");
}
