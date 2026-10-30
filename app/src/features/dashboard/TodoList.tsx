// To-dos on a dashboard: the open ones that match, overdue first, with a
// field that adds one to a page. Ticking writes the page through the core.

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { isDay, shortDay } from "../../lib/dates";
import { useToday } from "../../lib/use-today";
import type { TaskRow } from "../../lib/vault/types";
import { howFromView, useWorkspace } from "../workspace/store";
import { DashEmpty, MoreToggle } from "./DashCard";
import { byUrgency, useTaskList } from "./task-rows";
import { addTodo, tickTask } from "./todo-actions";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { lineIcon } from "../../ui/glyph";

interface TodoListProps {
  /** Which of the vault's to-dos to show. Keep it the same function between renders. */
  filter(row: TaskRow): boolean;
  /** The page "Add a to-do" writes to, if any, or how to find it (made on first use). */
  addTo?: AddTarget | null;
  /** Rows of this page leave out the page's name. */
  home?: string;
  limit?: number;
  empty: ReactNode;
  /** A short list: no "Show done", and what does not fit is a link that goes
   * to the whole list instead of growing this one. */
  onMore?: () => void;
}

export function TodoList({ filter, addTo = null, home, limit = 7, empty, onMore }: TodoListProps) {
  const rows = useTaskList();
  const [showDone, setShowDone] = useState(false);
  const [all, setAll] = useState(false);
  const today = useToday();
  const mine = useMemo(() => (rows ?? []).filter(filter).sort(byUrgency), [rows, filter]);
  const open = mine.filter((r) => !r.done);
  const done = mine.filter((r) => r.done);
  const short = onMore !== undefined;
  const list = showDone && !short ? [...open, ...done] : open;
  const shown = all && !short ? list : list.slice(0, limit);
  return (
    <div className="kasten-todos">
      {addTo && <AddTodo target={addTo} />}
      {rows === null ? (
        short ? (
          <Skeleton rows={Math.min(3, limit)} />
        ) : (
          <DashEmpty>Gathering to-dos…</DashEmpty>
        )
      ) : list.length === 0 ? (
        <DashEmpty>{empty}</DashEmpty>
      ) : (
        <ul className="kasten-todo-list">
          {shown.map((row) => (
            <TodoRow key={`${row.path}:${row.line}`} row={row} today={today} showPage={row.path !== home} />
          ))}
        </ul>
      )}
      <div className="kasten-todo-foot">
        {short ? (
          list.length > limit && (
            <button type="button" className="kasten-dash-more" onClick={onMore}>
              {list.length - limit} more
            </button>
          )
        ) : (
          <>
            <MoreToggle total={list.length} shown={limit} open={all} onToggle={() => setAll((a) => !a)} />
            {done.length > 0 && (
              <button type="button" className="kasten-dash-more" onClick={() => setShowDone((s) => !s)}>
                {showDone ? "Hide done" : `Show ${done.length} done`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Lines that hold a list's place while it is read, so the card keeps its height. */
function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="kasten-todo-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="kasten-todo-bone" />
      ))}
    </div>
  );
}

interface TodoRowProps {
  row: TaskRow;
  today: string;
  showPage: boolean;
  /** In a list of today's things: the time leads the line and the day is left out. */
  timed?: boolean;
}

export function TodoRow({ row, today, showPage, timed = false }: TodoRowProps) {
  const late = !row.done && row.due !== null && row.due < today;
  return (
    <li className={`kasten-todo${row.done ? " is-done" : ""}`}>
      <input type="checkbox" data-rove="" checked={row.done} aria-label={row.text} onChange={() => void tickTask(row)} />
      {timed && row.at && <span className="kasten-todo-time">{row.at}</span>}
      <span className="kasten-todo-text" title={showPage ? `${row.text} · ${isDay(row.title) ? shortDay(row.title) : row.title}` : row.text}>
        {row.text}
      </span>
      {!timed && row.due && <span className={`kasten-todo-due${late ? " is-late" : row.due === today ? " is-today" : ""}`}>{row.due === today ? "Today" : late ? `Late · ${row.due}` : row.due}</span>}
      {showPage && (
        <button type="button" className="kasten-todo-page" title={`Open ${row.title}`} onClick={(e) => useWorkspace.getState().openPath(row.path, howFromView(e))}>
          <IconOrEmoji icon={isDay(row.title) ? lineIcon("journal") : row.icon || lineIcon("page")} /> {isDay(row.title) ? shortDay(row.title) : row.title}
        </button>
      )}
    </li>
  );
}

export type AddTarget = string | { key: string; find(): Promise<string | null> };

/** A field that stays focused when the page it writes to reloads. */
let refocus: { path: string; until: number } | null = null;

/** "Add a to-do…": writes a to-do to the target page. */
export function AddTodo({ target }: { target: AddTarget }) {
  const path = typeof target === "string" ? target : target.key;
  const [text, setText] = useState("");
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (refocus && refocus.path === path && Date.now() < refocus.until) input.current?.focus();
    refocus = null;
  }, [path]);
  return (
    <form
      className="kasten-todo-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || busy.current) return;
        busy.current = true;
        refocus = { path, until: Date.now() + 4000 };
        void (async () => {
          const page = typeof target === "string" ? target : await target.find();
          const added = page !== null && (await addTodo(page, text));
          busy.current = false;
          if (added) setText("");
        })();
      }}
    >
      <span className="kasten-todo-box" aria-hidden="true" />
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a to-do…" aria-label="Add a to-do" />
    </form>
  );
}
