// The table's picked rows. `drawn` is the rows as drawn (group by group, open
// groups only): ranges and Shift+arrows follow it. `universe` is every row the
// table lists, shut groups too: what a bar action acts on, so folding a group
// does not quietly drop its rows from the selection.

import { useMemo, useState } from "react";

import type { NoteMeta } from "../../../../lib/vault/types";
import { useLatest } from "./context";
import { extend, NOTHING, rangeTo, selectAll, setGroup, toggleRow, visibleOf, type Picked } from "./rows-select";

const NO_ROWS: readonly NoteMeta[] = [];

export interface Selection {
  picked: Picked;
  /** The picked rows, in table order. */
  chosen: readonly NoteMeta[];
  api: {
    pick(path: string, shift: boolean): void;
    /** A group's checkbox: all of its rows, or none when all were picked. */
    group(paths: readonly string[]): void;
    /** Shift+↑/↓ from the active row. */
    extend(path: string, delta: 1 | -1): void;
    selectAll(): void;
    clear(): void;
    keepFirst(n: number): void;
  };
}

/**
 * `matching` are the universe's rows that match the view: "Select all" takes
 * those, not a parent shown greyed only because a sub-item of it matches (it
 * can still be ticked by hand).
 */
export function useSelection(universe: readonly NoteMeta[], drawn: readonly NoteMeta[], matching: readonly NoteMeta[] = universe): Selection {
  const [picked, setPicked] = useState<Picked>(NOTHING);
  const latest = useLatest({ universe, drawn, matching });
  const api = useMemo(() => {
    const drawnPaths = () => latest.current.drawn.map((n) => n.path);
    const universePaths = () => latest.current.universe.map((n) => n.path);
    const matchingPaths = () => latest.current.matching.map((n) => n.path);
    return {
      pick: (path: string, shift: boolean) => setPicked((p) => (shift ? rangeTo(p, drawnPaths(), path) : toggleRow(p, path))),
      group: (paths: readonly string[]) => setPicked((p) => setGroup(p, paths)),
      extend: (path: string, delta: 1 | -1) => setPicked((p) => extend(p, drawnPaths(), path, delta)),
      selectAll: () => setPicked(selectAll(matchingPaths())),
      clear: () => setPicked(NOTHING),
      keepFirst: (n: number) => setPicked((p) => ({ paths: new Set(visibleOf(p, universePaths()).slice(0, n)), anchor: null, head: null })),
    };
  }, [latest]);
  const chosen = useMemo(() => (picked.paths.size === 0 ? NO_ROWS : universe.filter((n) => picked.paths.has(n.path))), [picked, universe]);
  return { picked, chosen, api };
}
