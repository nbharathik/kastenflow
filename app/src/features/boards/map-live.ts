// An open page map following its page: it reads the page, works out what
// would change on the board, brings the board in step when it opens, and
// tells the bar above it (a "Sync with page" chip) what it found. One sync
// is one step to undo. Nothing here writes on every keystroke: the page is
// read again when its note changes, and the board is written only when
// opened or asked.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create, useStore } from "zustand";

import type { BoardInfo, NoteMeta } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import type { BoardController } from "./canvas/state/controller";
import { applySync, describe, planSync } from "./map-sync";
import type { OutlineNode } from "./outline";
import { mapsOf, readPage } from "./page-map";
import { useBoards } from "./store";

/** What the bar shows about an open map. */
export interface MapStatus {
  /** The page the map follows; null when it is not in the vault. */
  page: NoteMeta | null;
  /** Lines of the page the map would take on: new, reworded, gone or back. */
  changes: number;
  busy: boolean;
  /** The page's map to open instead, when this board is a copy of it. */
  primary: string | null;
  /** Other maps of the page, when this board is its map. */
  copies: BoardInfo[];
  /** Brings the map in step with the page now. */
  sync(): Promise<void>;
}

export const useMapStatus = create<{ by: Record<string, MapStatus> }>(() => ({ by: {} }));

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The note a map's source names: by its id, else by its path. */
function noteOf(notes: readonly NoteMeta[], page: string | undefined): NoteMeta | null {
  if (!page) return null;
  return notes.find((n) => n.id === page) ?? notes.find((n) => n.path === page) ?? null;
}

/** Makes an open page map follow its page. `active` is false for a board
 * shown inside a page, which leaves its map as it is. */
export function useMapSync(board: BoardController, active = true): void {
  const doc = useStore(board.store, (s) => s.doc);
  const source = doc.source;
  const notes = useWorkspace((s) => s.notes);
  const client = useWorkspace((s) => s.client);
  const boards = useBoards((s) => s.list);
  const note = useMemo(() => noteOf(notes, source?.page), [notes, source?.page]);
  const notePath = note?.path;
  const modified = note?.modified;
  const noteId = note?.id ?? null;
  const noteTitle = note?.title;
  const [outline, setOutline] = useState<{ tree: OutlineNode[]; cut: boolean } | null>(null);
  const [maps, setMaps] = useState<BoardInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const opened = useRef(false);
  const tracked = Boolean(active && source);

  // The page's lines, read again when its note changes.
  useEffect(() => {
    if (!tracked || !client || notePath === undefined) {
      setOutline(null);
      return;
    }
    let live = true;
    readPage(client, { path: notePath }).then(
      (read) => live && setOutline(read),
      () => live && setOutline(null),
    );
    return () => {
      live = false;
    };
  }, [tracked, client, notePath, modified]);

  // Its other maps, when the boards change.
  useEffect(() => {
    if (!tracked || !client || notePath === undefined) {
      setMaps(null);
      return;
    }
    let live = true;
    mapsOf(client, { id: noteId, path: notePath, title: noteTitle ?? "" }, boards).then(
      (found) => live && setMaps(found),
      () => live && setMaps(null),
    );
    return () => {
      live = false;
    };
  }, [tracked, client, noteId, notePath, noteTitle, boards]);

  const plan = useMemo(() => (note && outline ? planSync(doc, note, outline) : null), [doc, note, outline]);
  const changes = plan ? plan.added.length + plan.retexts.length + plan.stale.length + plan.revived.length : 0;

  const sync = useCallback(
    async (auto: boolean) => {
      const { client: vault, toast } = useWorkspace.getState();
      if (!vault || !note || running.current) return;
      running.current = true;
      setBusy(true);
      try {
        const now = planSync(board.doc, note, await readPage(vault, note));
        if (!now) {
          if (!auto) toast(`The card for “${note.title}” is not on this map any more`);
          return;
        }
        const group = `sync:${Date.now()}`;
        const result = await applySync(board.doc, now, async (batch) => (await board.commit(batch, { group }))?.made ?? null);
        if (!result) return;
        const moved = result.added + result.updated + result.stale + result.revived;
        if (moved > 0) toast(`Mind map updated from “${note.title}”: ${describe(result)}`);
        else if (!auto) toast(`The map already follows “${note.title}”`);
        if (result.cut && (moved > 0 || !auto)) toast("The page has more lines than a map follows: the map shows the first 80");
      } catch (err) {
        toast(message(err));
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [board, note],
  );

  // Brought in step when it opens, once.
  useEffect(() => {
    if (!tracked || opened.current || !plan) return;
    opened.current = true;
    if (plan.changed) void sync(true);
  }, [tracked, plan, sync]);

  const primary = maps?.[0]?.path ?? null;
  const copies = useMemo(() => (maps && primary === board.path ? maps.slice(1) : []), [maps, primary, board.path]);
  const path = board.path;
  useEffect(() => {
    if (!tracked) return;
    const status: MapStatus = { page: note, changes, busy, primary, copies, sync: () => sync(false) };
    useMapStatus.setState((s) => ({ by: { ...s.by, [path]: status } }));
  }, [tracked, path, note, changes, busy, primary, copies, sync]);
  useEffect(
    () => () =>
      useMapStatus.setState((s) => {
        const by = { ...s.by };
        delete by[path];
        return { by };
      }),
    [path],
  );
}
