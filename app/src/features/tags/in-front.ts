// What the palette can reach in the database on screen. A view bar, a table
// and a timeline each say, while mounted, what they can do; a command asks for
// "the one in front": the first that is shown, the focused pane's before the
// others (a tab kept ready is display none and skipped).

import { useEffect, useRef, type RefObject } from "react";

import type { TagSchema, TagView } from "../../lib/vault/types";
import { firstVisible, isShown } from "../../shell/visible-dom";

/** What each part offers. A part leaves out what it cannot do right now. */
export interface FrontActions {
  /** The view bar: the saved view and the change that saves it. */
  bar: {
    view: TagView;
    schema: TagSchema | null;
    onChange(next: TagView): void;
    /** The properties a table can group by. */
    groups?: { key: string; label: string }[];
    /** Opens or shuts every sub-item; absent without sub-items. */
    expandAll?(): void;
    collapseAll?(): void;
  };
  table: {
    selectAll(): void;
    /** Picks every row of the active row's group; absent when the table is not grouped. */
    selectGroup?(): void;
    /** Moves the active row one place; absent when the rows are not in a hand-kept order. */
    moveRow?(delta: 1 | -1): void;
  };
  timeline: {
    today(): void;
    setScale(scale: string): void;
  };
}

type Kind = keyof FrontActions;

interface Entry {
  kind: Kind;
  el: Element;
  actions: { current: FrontActions[Kind] };
}

const entries = new Set<Entry>();

/** The actions of the part in front, or null when none is shown. */
export function inFront<K extends Kind>(kind: K): FrontActions[K] | null {
  const mine = [...entries].filter((e) => e.kind === kind && isShown(e.el));
  if (mine.length === 0) return null;
  const focused = firstVisible(".kasten-pane.is-focused");
  const pick = mine.find((e) => focused?.contains(e.el)) ?? mine[0]!;
  return pick.actions.current as FrontActions[K];
}

/** Offers `actions` to the palette while the element is mounted; the latest object is always used. */
export function useFrontActions<K extends Kind>(kind: K, ref: RefObject<Element | null>, actions: FrontActions[K]): void {
  const latest = useRef<FrontActions[K]>(actions);
  latest.current = actions;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const entry: Entry = { kind, el, actions: latest };
    entries.add(entry);
    return () => void entries.delete(entry);
  }, [kind, ref]);
}
