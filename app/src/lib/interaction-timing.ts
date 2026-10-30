// Dev builds only (main.tsx loads this under import.meta.env.DEV): logs any
// long task and any event handler that kept the page busy over 100 ms, with
// the element it ran on, so a slow interaction shows in the console while
// the app is used. Release builds never load it.

/** Handlers and tasks at least this long (ms) are logged. */
export const SLOW_MS = 100;

interface TimingEntry {
  entryType: string;
  name: string;
  duration: number;
  target?: unknown;
}

/** A short name for the element an event ran on: tag, test id or label, first classes. */
export function describeTarget(target: unknown): string {
  const el = target as { tagName?: string; getAttribute?: (n: string) => string | null; className?: unknown } | null;
  if (!el || typeof el.tagName !== "string") return "unknown element";
  const tag = el.tagName.toLowerCase();
  const label = el.getAttribute?.("data-testid") ?? el.getAttribute?.("aria-label");
  if (label) return `${tag}[${label}]`;
  const classes = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
  return classes.length ? `${tag}.${classes.join(".")}` : tag;
}

/** The console line for a slow entry, or null when it was quick enough. */
export function slowLine(entry: TimingEntry, limit = SLOW_MS): string | null {
  if (entry.duration < limit) return null;
  const ms = Math.round(entry.duration);
  if (entry.entryType === "event") return `[kasten:slow-event] ${entry.name} on ${describeTarget(entry.target)} took ${ms} ms`;
  return `[kasten:long-task] ${ms} ms on the main thread`;
}

/** Starts the observers; returns a function that stops them. Does nothing where the browser lacks them. */
export function watchInteractions(log: (line: string) => void = (line) => console.warn(line)): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  const observers: PerformanceObserver[] = [];
  const watch = (type: string, options: PerformanceObserverInit) => {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const line = slowLine(entry as unknown as TimingEntry);
          if (line) log(line);
        }
      });
      observer.observe({ type, buffered: true, ...options });
      observers.push(observer);
    } catch {
      // This engine does not report that kind of entry.
    }
  };
  watch("longtask", {});
  // Event timing reports from 16 ms by default; the line itself filters to 100.
  watch("event", { durationThreshold: SLOW_MS } as PerformanceObserverInit);
  return () => observers.forEach((o) => o.disconnect());
}
