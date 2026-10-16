// The store's actions on notes: making, filling, trashing, restoring,
// renaming, moving and converting them. Each goes through the vault client
// and then takes the result into the note list, the tabs and the notices.

import { isoDay } from "../../lib/dates";
import { localStamp } from "../templates/template-vars";
import type { NoteMeta, VaultClient } from "../../lib/vault/types";
import { boardTitle, useBoards } from "../boards/store";
import { deckTitle, useDecks } from "../slides/store";
import { titleOfPath } from "../diagrams/names";
import { useDiagrams } from "../diagrams/store";
import { dropDraft, isDraft, madeOf, newDraft, nowAt } from "./drafts";
import { titleOf } from "./names";
import { putBack, spotOf } from "./placing";
import { saveRecent } from "./recent";
import { flushOpenPage, reloadOpenPage } from "./page/open-page";
import { usePrefs } from "./prefs";
import type { WorkspaceState } from "./store-types";
import * as tabs from "./tabs";
import type { Layout } from "./tabs";
import { noteAt, withSubPages } from "./tree";

type SetState = (partial: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) => void;
type GetState = () => WorkspaceState;

/** What the actions share with the rest of the store. */
export interface NoteContext {
  /** Runs a vault call, showing its error instead of throwing. */
  attempt<T>(run: (client: VaultClient) => Promise<T>): Promise<T | null>;
  /** Takes a note the client just returned into the list. */
  upsert(meta: NoteMeta): void;
  /** Shows a new layout of tabs and panes, and keeps it. */
  apply(layout: Layout): void;
  /** Counts a change the window made to the note list. */
  edited(): void;
}

export type NoteActions = Pick<
  WorkspaceState,
  "create" | "newPage" | "ensureJournal" | "applyTemplate" | "takeTour" | "trash" | "restore" | "noteChanged" | "rename" | "duplicate" | "move" | "convert" | "renamed"
>;

/** A notice's Undo, which runs the op that takes the change back. */
const undo = (run: () => Promise<unknown>) => ({ label: "Undo", run: () => void run() });

/** The note actions, for the workspace store. */
export function noteActions(set: SetState, get: GetState, { attempt, upsert, apply, edited }: NoteContext): NoteActions {
  return {
    async create(draft, open = true) {
      const note = await attempt((c) => c.create({ date: localStamp(), ...draft }));
      if (!note) return null;
      upsert(note.meta);
      if (open) get().openPath(note.meta.path);
      return note;
    },

    newPage(spec = {}, how) {
      get().go({ view: "page", path: newDraft({ kind: "page", title: "", ...spec }) }, how);
    },

    async ensureJournal(date = isoDay(new Date())) {
      const day = await attempt((c) => c.journal(date));
      if (!day) return null;
      upsert(day.meta);
      return day.meta.path;
    },

    async applyTemplate(path, template) {
      const note = await attempt((c) => c.applyTemplate(path, template, localStamp()));
      if (note) upsert(note.meta);
      return note;
    },

    async takeTour() {
      const path = await attempt((c) => c.addTour());
      if (!path) return;
      const found = await attempt((c) => c.notesAt([path]));
      if (found?.[0]) upsert(found[0]);
      get().openPath(path);
    },

    async trash(path, quiet = false) {
      // A draft never written in just closes; one that was goes as its page.
      if (isDraft(path)) {
        if (!madeOf(path)) {
          dropDraft(path);
          apply(tabs.forgetPath(get().layout, path));
          return null;
        }
        path = nowAt(path);
      }
      const board = path.endsWith(".canvas");
      const deck = path.endsWith(".deck");
      // A diagram goes with its picture, which is not a page of its own.
      const diagram = path.endsWith(".drawio");
      const title = board ? boardTitle(useBoards.getState().list, path) : deck ? deckTitle(useDecks.getState().list, path) : diagram ? titleOfPath(path) : (noteAt(get().notes, path)?.title ?? path);
      // Its sub-pages go with it, as in the core.
      const going = board || deck || diagram ? [path] : withSubPages(get().notes, path);
      // Typing waiting to be written goes into the note before it goes.
      await flushOpenPage();
      const trashed = await attempt((c) => c.trash(path));
      if (!trashed) return null;
      const gone = new Set(going);
      going.forEach((p) => usePrefs.getState().moveFavourite(p, null));
      edited();
      set((s) => ({
        notes: s.notes.filter((n) => !gone.has(n.path)),
        recent: s.recent.filter((p) => !gone.has(p)),
      }));
      apply(going.reduce((layout, p) => tabs.forgetPath(layout, p), get().layout));
      for (const p of going) if (get().stack.includes(p)) get().closeInStack(p);
      if (board) void useBoards.getState().load();
      if (deck) void useDecks.getState().load();
      if (diagram) void useDiagrams.getState().load();
      const along = going.length === 2 ? " and its sub-page" : going.length > 2 ? ` and ${going.length - 1} sub-pages` : "";
      if (!quiet) get().toast(`Moved “${title}”${along} to the trash`, { label: "Undo", run: () => void get().restore(trashed) });
      return trashed;
    },

    async restore(trashed) {
      if (trashed.endsWith(".deck")) {
        const path = await attempt((c) => c.restoreDeck(trashed));
        if (!path) return;
        await useDecks.getState().load();
        get().toast(`Restored “${deckTitle(useDecks.getState().list, path)}”`, { label: "Open", run: () => get().openPath(path) });
        return;
      }
      if (trashed.endsWith(".drawio") || trashed.endsWith(".drawio.svg")) {
        const path = await attempt((c) => c.restoreDiagram(trashed));
        if (!path) return;
        await useDiagrams.getState().load();
        get().toast(`Restored “${titleOfPath(path)}”`, { label: "Open", run: () => get().openPath(path) });
        return;
      }
      if (trashed.endsWith(".canvas")) {
        const path = await attempt((c) => c.restoreBoard(trashed));
        if (!path) return;
        await useBoards.getState().load();
        get().toast(`Restored “${boardTitle(useBoards.getState().list, path)}”`, { label: "Open", run: () => get().openPath(path) });
        return;
      }
      if (trashed.endsWith(".yaml")) {
        // Only a saved collection (`views/*.yaml`) is trashed as a YAML file.
        const found = await attempt((c) => c.restoreCollection(trashed));
        if (!found) return;
        get().toast(`Restored the collection “${found.name}”`, { label: "Open", run: () => get().go({ view: "collections", path: found.path }) });
        return;
      }
      const note = await attempt((c) => c.restore(trashed));
      if (!note) return;
      upsert(note.meta);
      // Sub-pages that went with it came back too.
      await get().refresh();
      get().toast(`Restored “${note.meta.title}”`, { label: "Open", run: () => get().openPath(note.meta.path) });
    },

    noteChanged(meta) {
      upsert(meta);
    },

    async rename(path, title) {
      const was = noteAt(get().notes, path)?.title;
      await flushOpenPage();
      const renamed = await attempt((c) => c.rename(path, title));
      if (!renamed) return;
      await get().renamed(path, renamed);
      if (was !== undefined) get().toast(`Renamed “${was || "Untitled"}” to “${title}”`, undo(() => get().rename(renamed.note.meta.path, was)));
    },

    async duplicate(path) {
      await flushOpenPage();
      const note = await attempt((c) => c.duplicate(path));
      if (!note) return;
      upsert(note.meta);
      get().openPath(note.meta.path);
      get().toast(`Made “${titleOf(note.meta)}”`, undo(() => get().trash(note.meta.path)));
    },

    async move(path, project, quiet = false) {
      const spot = spotOf(get().notes, path);
      await flushOpenPage();
      const note = await attempt((c) => c.move(path, project));
      if (!note) return null;
      await get().renamed(path, { note, relinked: note.relinked }, note.moves);
      if (quiet) return note.meta.path;
      const where = project ? (get().notes.find((n) => n.kind === "project" && n.project === project)?.title ?? project) : "Pages";
      get().toast(`Moved “${titleOf(note.meta)}” to ${where}`, spot ? { label: "Undo", run: () => void putBack(note.meta.path, spot) } : undefined);
      return note.meta.path;
    },

    async convert(path, kind) {
      const was = noteAt(get().notes, path)?.kind;
      await flushOpenPage();
      const note = await attempt((c) => c.convert(path, kind));
      if (!note) return;
      if (note.moves.length > 0) await get().renamed(path, { note, relinked: note.relinked }, note.moves);
      else upsert(note.meta);
      const back = was === "card" || was === "page" ? was : null;
      get().toast(`“${note.meta.title}” is a ${kind} now`, back ? undo(() => get().convert(note.meta.path, back)) : undefined);
    },

    async renamed(from, { note, relinked }, moves = []) {
      // The note and every sub-page that moved with it, by path.
      const moved = new Map<string, string>(moves);
      moved.set(from, note.meta.path);
      for (const [path, to] of moved) usePrefs.getState().moveFavourite(path, to);
      const recent = get().recent.map((p) => moved.get(p) ?? p);
      saveRecent(recent);
      edited();
      set((s) => ({ notes: s.notes.filter((n) => !moved.has(n.path)), recent }));
      get().followMoves(moved);
      upsert(note.meta);
      // Pages open on notes whose links the op rewrote show the new text.
      for (const path of relinked) reloadOpenPage(path);
      await get().refresh();
    },
  };
}
