// Moving dated notes between days: shown on the new days at once, written
// through the core's `update_props` op (one commit, both of a range's dates
// together), rolled back if the write fails, and undone from the toast.
// Keyboard moves wait for the keys to pause, so a run of Alt+→ makes one
// commit and one Undo.

import { useCallback, useEffect, useRef, useState } from "react";

import { dayFrom } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { movedValue, propOf } from "../panel/properties/values";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { asDay, type DateItem } from "./dates";
import { dayLabel, itemId, rangeLabel, type Pending } from "./layout";
import { rangeId, type DateRange } from "./ranges";
import { writeProps } from "./write";

/** How long keyboard moves wait for the next key before writing. */
export const KEY_PAUSE = 600;

/** What a move changes: one note's date properties, each to a day. */
export interface MoveTarget {
  /** The item's or range's id: its writes run in order, and it shows where it is going. */
  id: string;
  path: string;
  note: NoteMeta;
  /** One key for a single day; a range's start and end keys. */
  keys: readonly string[];
  /** The days they show now. */
  days: readonly string[];
}

export const itemTarget = (item: DateItem): MoveTarget => ({ id: itemId(item), path: item.path, note: item.note, keys: [item.key], days: [item.day] });

export const rangeTarget = (range: DateRange): MoveTarget => ({ id: rangeId(range), path: range.path, note: range.note, keys: [range.startKey, range.endKey], days: [range.start, range.end] });

interface Waiting {
  target: MoveTarget;
  /** The values before this move (or run of key moves), for Undo. */
  from: readonly unknown[];
  fromDays: readonly string[];
  to: readonly string[];
  timer?: ReturnType<typeof setTimeout>;
}

export interface Moves {
  /** Days things are moving to, by id, until the vault has them. */
  pending: Pending;
  /** Moves a target to `days`: written now, or once keys pause (`later`). */
  move(target: MoveTarget, days: readonly string[], later?: boolean): void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const NONE: Pending = new Map();
const same = (a: readonly string[] | undefined, b: readonly string[] | undefined) => a?.join() === b?.join();

/** The toast after a move, and after its Undo. */
function said(target: MoveTarget, from: readonly string[], to: readonly string[]): { done: string; undone: string } {
  const title = titleOf(target.note);
  const today = dayFrom(0);
  if (target.keys.length === 1) return { done: `Moved “${title}” to ${dayLabel(to[0]!, today)}`, undone: `Moved “${title}” back to ${dayLabel(from[0]!, today)}` };
  const was = rangeLabel(from[0]!, from[1]!, today);
  const now = rangeLabel(to[0]!, to[1]!, today);
  if (from[0] === to[0]) return { done: `“${title}” now runs ${now}`, undone: `“${title}” runs ${was} again` };
  return { done: `Moved “${title}” to ${now}`, undone: `Moved “${title}” back to ${was}` };
}

/** Resolves once the next frame has been painted, so a moved chip shows on
 * its new day before the write starts, however quick or slow the vault. A
 * hidden window paints no frames; the timer lets the write go anyway. */
const afterPaint = () =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 100);
    if (typeof requestAnimationFrame === "function")
      requestAnimationFrame(() =>
        setTimeout(() => {
          clearTimeout(timer);
          resolve();
        }, 0),
      );
  });

export function useMoves(): Moves {
  const [pending, setPending] = useState<Pending>(NONE);
  const waiting = useRef(new Map<string, Waiting>());
  // Writes to one item or range run one after another, in the order asked.
  const queues = useRef(new Map<string, { last: Promise<unknown>; count: number }>());

  const show = useCallback((id: string, days: readonly string[] | null, only?: readonly string[]) => {
    setPending((current) => {
      if (only !== undefined && !same(current.get(id), only)) return current;
      if (days !== null && same(current.get(id), days)) return current;
      const next = new Map(current);
      if (days === null) next.delete(id);
      else next.set(id, days);
      return next.size === 0 ? NONE : next;
    });
  }, []);

  /** Writes `values` to the target's keys in one op; true when the vault took
   * it. Only keys whose value differs from the note's by then are sent, so
   * dragging a range's end leaves its start as written, while a move back
   * after one still on its way writes everything the first one changed. */
  const write = useCallback(
    (target: MoveTarget, values: readonly unknown[], days: readonly string[]): Promise<boolean> => {
      const { id } = target;
      const queue = queues.current.get(id) ?? { last: Promise.resolve(), count: 0 };
      const run = async () => {
        const { client, noteChanged, toast, notes } = useWorkspace.getState();
        try {
          if (!client) return false;
          const now = notes.find((note) => note.path === target.path)?.props;
          const props: Record<string, unknown> = {};
          target.keys.forEach((key, i) => {
            if (!now || now[key] !== values[i]) props[key] = values[i];
          });
          if (Object.keys(props).length === 0) return true;
          const saved = await writeProps(client, target.path, props);
          noteChanged(saved.meta);
          return true;
        } catch (err) {
          toast(message(err));
          return false;
        } finally {
          // Unless another move took over meanwhile, the notes say where it is now.
          show(id, null, days);
          if (--queue.count === 0) queues.current.delete(id);
        }
      };
      queue.count++;
      const done = queue.last.then(afterPaint).then(run);
      queue.last = done;
      queues.current.set(id, queue);
      return done;
    },
    [show],
  );

  const commit = useCallback(
    async ({ target, from, fromDays, to }: Waiting) => {
      if (!(await write(target, target.keys.map((_, i) => movedValue(from[i], to[i]!)), to))) return;
      // A note that had no date gets one (the timeline's "Set dates"): Undo takes it off again.
      const given = from.some((value) => value === null);
      const title = titleOf(target.note);
      const words = given ? { done: `Set the dates of “${title}”`, undone: `Took the dates off “${title}”` } : said(target, fromDays, to);
      useWorkspace.getState().toast(words.done, {
        label: "Undo",
        run: () => {
          show(target.id, fromDays);
          void write(target, from, fromDays).then((ok) => ok && useWorkspace.getState().toast(words.undone));
        },
      });
    },
    [show, write],
  );

  const move = useCallback(
    (target: MoveTarget, days: readonly string[], later = false) => {
      const { id } = target;
      const known = waiting.current.get(id);
      clearTimeout(known?.timer);
      waiting.current.delete(id);
      // A date the note does not have yet is null, so Undo clears it again.
      const from = known ? known.from : target.keys.map((key) => propOf(target.note.props, key) ?? null);
      const entry: Waiting = { target: known?.target ?? target, from, fromDays: known?.fromDays ?? from.map((value, i) => asDay(value) ?? target.days[i]!), to: days };
      if (same(entry.to, entry.fromDays) && !from.some((value) => value === null) && !queues.current.has(id)) {
        // Back where it started, with nothing on its way: nothing to write.
        show(id, null);
        return;
      }
      show(id, days);
      if (!later) return void commit(entry);
      entry.timer = setTimeout(() => {
        waiting.current.delete(id);
        void commit(entry);
      }, KEY_PAUSE);
      waiting.current.set(id, entry);
    },
    [commit, show],
  );

  // Leaving the view, or the window going away, writes keyboard moves still
  // waiting for a pause.
  useEffect(() => {
    const queued = waiting.current;
    const flush = () => {
      for (const entry of queued.values()) {
        clearTimeout(entry.timer);
        void commit(entry);
      }
      queued.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commit]);

  return { pending, move };
}
