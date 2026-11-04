import { type JSX, type KeyboardEvent } from "react";

import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";
import { useEditor } from "../useEditor.ts";
import { jumpTo } from "./step-log.ts";
import "./history.css";

/** Up and down walk the rows; Home and End go to the newest and the oldest. */
function walk(event: KeyboardEvent<HTMLElement>): void {
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(".ks-hist-row")];
  const at = rows.findIndex((row) => row === document.activeElement);
  if (at < 0) return;
  const to = { ArrowDown: Math.min(at + 1, rows.length - 1), ArrowUp: Math.max(at - 1, 0), Home: 0, End: rows.length - 1 }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  rows[to]?.focus();
}

/**
 * The steps of undo as a list, newest first: a click stands the deck where it was after that step, by undoing (or, for a step that
 * was undone, redoing) as many steps as it takes, so Undo and Redo go on from there and nothing is lost until a new change is made.
 */
export function HistoryPanel({ session }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  useEditor(session);
  const log = session.stepLog;
  const rows = log.rows();
  if (rows.length === 1) {
    return (
      <div className="ks-hist">
        <p className="ks-hist-note">Nothing to undo yet. Each change you make is listed here, and a click goes back to it.</p>
      </div>
    );
  }
  return (
    <div className="ks-hist">
      <p className="ks-hist-note">Click a step to go back to how the deck was after it. Steps that are dimmed were undone; a new change drops them.</p>
      <ol className="ks-hist-list" aria-label="Steps of undo, newest first" onKeyDown={walk}>
        {rows.map((row) => (
          <li key={row.position}>
            <button
              type="button"
              className={`ks-btn ks-hist-row${row.current ? " is-current" : ""}${row.undone ? " is-undone" : ""}`}
              aria-current={row.current ? "step" : undefined}
              tabIndex={row.current ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => jumpTo(log, session, row.position)}
            >
              <span className="ks-hist-mark" aria-hidden="true">
                {row.current ? <Icon name="check" size={13} /> : null}
              </span>
              <span className="ks-hist-label">{row.label}</span>
              {row.undone ? <span className="ks-hist-tag">undone</span> : null}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
