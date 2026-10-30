// What a wait looks like, by how long it is (the rule the app follows):
//   - under about a second: nothing, so a quick read never flashes;
//   - a whole view: a skeleton of its shape (`view`);
//   - one to ten seconds, for a part of a view: a spinner with its words;
//   - longer, and known: a progress bar with a time estimate (a <progress>,
//     as the downloads have), not this.
// Screen readers hear the words at once; only the picture waits.

import "./wait.css";

import { useEffect, useState } from "react";

/** How long a wait shows nothing. */
export const WAIT_MS = 1000;

/** Whether `ms` have passed since this mounted. */
export function useAfter(ms: number): boolean {
  const [late, setLate] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return late;
}

interface WaitProps {
  /** What is being waited for, in words: "Opening the board". */
  label: string;
  /** The whole view is waiting: a skeleton, not a spinner. */
  view?: boolean;
  /** Nothing shows for this long; tests set 0. */
  delay?: number;
  className?: string;
}

export function Wait({ label, view = false, delay = WAIT_MS, className = "" }: WaitProps) {
  const late = useAfter(delay);
  return (
    <div role="status" aria-busy="true" className={`ui-wait${view ? " is-view" : ""} ${className}`}>
      <span className="sr-only">{label}…</span>
      {late &&
        (view ? (
          <div className="ui-bones" aria-hidden="true">
            <span className="ui-bone is-title" />
            <span className="ui-bone" />
            <span className="ui-bone is-short" />
            <span className="ui-bone" />
          </div>
        ) : (
          <span className="ui-wait-note" aria-hidden="true">
            <span className="ui-spinner" />
            {label}…
          </span>
        ))}
    </div>
  );
}
