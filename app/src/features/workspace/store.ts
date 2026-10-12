// The open workspace: the vault client, its notes, where the window is and
// the way back. Every change to a note goes through the client, and so
// through kasten-core inside the app.

import { create } from "zustand";

import { reportStartup } from "../../lib/api";
import { isDay, isoDay } from "../../lib/dates";
import { localStamp } from "../templates/template-vars";
import { useShell } from "../../lib/store";
import type { NoteMeta, VaultClient } from "../../lib/vault/types";
import { boardTitle, useBoards } from "../boards/store";
import { deckTitle, useDecks } from "../slides/store";
import { titleOfPath } from "../diagrams/names";
import { useDiagrams } from "../diagrams/store";
import { dropDraft, isDraft, madeOf, newDraft, nowAt } from "./drafts";
import { wayToOpen } from "./go-how";
import { directoryOf } from "./links";
import { titleOf } from "./names";
import { putBack, spotOf } from "./placing";
import { loadRecent, MAX_RECENT, saveRecent } from "./recent";
import { merged, patched, upserted } from "./note-list";
import { flushOpenPage, reloadOpenPage } from "./page/open-page";
import { usePeek } from "../peek/store";
import { usePrefs } from "./prefs";
import { derive, layoutSlice, loadLayout } from "./store-layout";
import * as tabs from "./tabs";
import { findByTitle, noteAt, withSubPages } from "./tree";
import { withDrafts } from "./with-drafts";

export type { Place, ViewId } from "./tabs";
export type { OpenHow } from "./store-layout";
export { howFrom, howFromName, howFromView } from "./store-layout";

import type { WorkspaceState } from "./store-types";
export type { Draft, Toast, WorkspaceState } from "./store-types";

/** A journal day's page: `journal/2026/2026-09-24.md`. */
const JOURNAL_DAY = /^journal\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** A notice's Undo, which runs the op that takes the change back. */
const undo = (run: () => Promise<unknown>) => ({ label: "Undo", run: () => void run() });
let nextToast = 1;

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  /** Runs a vault call, showing its error instead of throwing. */
  async function attempt<T>(run: (client: VaultClient) => Promise<T>): Promise<T | null> {
    const { client } = get();
    if (!client) return null;
    try {
      return await run(client);
    } catch (err) {
      get().toast(message(err));
      return null;
    }
  }

  /** Changes the window made to the note list, so a list asked for before
   * one of them is known to be out of date. */
  let edits = 0;

  function upsert(meta: NoteMeta) {
    const notes = upserted(get().notes, meta);
    if (notes === get().notes) return;
    edits++;
    set({ notes });
  }

  const saved = loadLayout();
  const { apply, actions } = layoutSlice(set as never, get);
  return {
    client: null,
    problem: null,
    choosing: false,
    ready: false,
    notes: [],
    ...derive(saved.layout),
    stack: saved.stack,
    stackOpen: saved.stackOpen,
    recent: loadRecent(),
    navigated: false,
    toasts: [],
    ...actions,

    async connect({ client: vault, problem, choose }) {
      // New pages are drafts until written in: the client makes them then,
      // and the tabs follow each to its page.
      const client = vault ? withDrafts(vault, { onMade: (draft, note) => void get().renamed(draft, { note, relinked: [] }) }) : null;
      set({ client, problem: problem ?? null, choosing: Boolean(choose), ready: false });
      performance.mark?.("kasten:connected");
      if (client) await get().refresh();
      performance.mark?.("kasten:listed");
      if (client) reportStartup();
      // Tabs and stack cards for notes that are gone (deleted meanwhile) close.
      if (client) {
        const known = new Set(get().notes.map((n) => n.path));
        // Boards stay open while their file does; if the list cannot be
        // read, they stay open.
        const boards = await attempt((c) => c.boards());
        const decks = await attempt((c) => c.decks());
        const diagrams = await attempt((c) => c.diagrams());
        // A tag's database (`#tag`) stays open too.
        // So does a journal day, written in or not.
        const kept = (path: string) =>
          known.has(path) ||
          path.startsWith("#") ||
          JOURNAL_DAY.test(path) ||
          (path.endsWith(".canvas") && (!boards || boards.some((b) => b.path === path))) ||
          (path.endsWith(".deck") && (!decks || decks.some((d) => d.path === path))) ||
          (path.endsWith(".drawio") && (!diagrams || diagrams.some((d) => d.path === path)));
        let layout = get().layout;
        for (const path of tabs.openPaths(layout)) if (!kept(path)) layout = tabs.forgetPath(layout, path);
        if (layout !== get().layout) apply(layout);
        const stack = get().stack.filter((p) => known.has(p));
        if (stack.length !== get().stack.length) set({ stack, stackOpen: get().stackOpen && stack.length > 0 });
      }
      set({ ready: true });
      // The very first time, open the guide when the vault has one, unless
      // the person went somewhere while the window was opening.
      // Vaults made before the KastenFlow name have the guide by its old title.
      const welcome = findByTitle(get().notes, "Welcome to KastenFlow") ?? findByTitle(get().notes, "Welcome to Kasten");
      if (welcome && !get().navigated && get().recent.length === 0 && get().place.view === "home") get().openPath(welcome.path);
    },

    async refresh() {
      // A list asked for before a page was made or trashed here would undo
      // that change, and close its tab: ask again.
      for (let tries = 1; ; tries++) {
        const before = edits;
        const fresh = await attempt((c) => c.list());
        if (!fresh) return;
        if (edits !== before && tries < 3) continue;
        const notes = merged(get().notes, fresh);
        if (notes !== get().notes) set({ notes });
        return;
      }
    },

    async filesChanged(paths) {
      // A big change (a pull, a bulk edit) or a folder moved as a whole
      // (reported without its files) reloads everything at once.
      const folder = paths.some((p) => !/\.[a-z0-9]+$/i.test(p.slice(p.lastIndexOf("/") + 1)));
      if (paths.length > 200 || folder) return get().refresh();
      const wanted = paths.filter((p) => p.endsWith(".md"));
      if (wanted.length === 0) return;
      const found = await attempt((c) => c.notesAt(wanted));
      if (!found) return;
      const notes = patched(get().notes, wanted, found);
      if (notes === get().notes) return;
      edits++;
      set({ notes });
    },

    go(place, how = "here") {
      if (!get().navigated) set({ navigated: true });
      const { newTabs, peekMode } = usePrefs.getState();
      const way = wayToOpen(how, place, { current: get().place, layout: get().layout, newTabs, peekMode, peekOpen: usePeek.getState().peek?.mode ?? null });
      if ("peek" in way) return usePeek.getState().open(place.path!, way.peek ?? undefined);
      if (way.how === "tab") return get().openTab(place);
      if (way.how === "split") return get().splitRight(place);
      if (way.how === "right") return get().openRight(place);
      if (way.how === "stack" && place.path) return get().openInStack(place.path);
      apply(tabs.navigate(get().layout, place));
      get().recentVisit(place);
    },

    recentVisit(place) {
      if (!place.path || place.path.startsWith("#") || isDraft(place.path)) return;
      const recent = [place.path, ...get().recent.filter((p) => p !== place.path)].slice(0, MAX_RECENT);
      saveRecent(recent);
      set({ recent });
    },

    goBack() {
      apply(tabs.goBack(get().layout));
    },

    goForward() {
      apply(tabs.goForward(get().layout));
    },

    openPath(path, how) {
      // A journal day opens in the journal, beside the other days.
      const view = path.endsWith(".canvas") ? "boards" : path.endsWith(".deck") ? "slides" : path.endsWith(".drawio") ? "diagrams" : /\.pdf$/i.test(path) ? "highlights" : JOURNAL_DAY.test(path) ? "journal" : "page";
      get().go({ view, path }, how);
    },

    async openTitle(title, how) {
      const target = title.trim();
      if (isDay(target)) return get().openJournal(target, how);
      const found = directoryOf(get().notes).resolve(target, { path: "", project: null });
      if (found && "note" in found) return get().openPath(found.note.path, how);
      // Several pages have the title: the palette lists them, each with where it lives.
      if (found) return useShell.getState().setPalette(true, target);
      get().toast(`No page called “${target}” yet`, { label: "Create it", run: () => void get().create({ kind: "page", title: target }) });
    },

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

    async openJournal(date = isoDay(new Date()), how) {
      // The page is made on writing, not on looking (JournalView).
      get().go({ view: "journal", path: `journal/${date.slice(0, 4)}/${date}.md` }, how);
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
      edits++;
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
      edits++;
      set((s) => ({ notes: s.notes.filter((n) => !moved.has(n.path)), recent }));
      get().followMoves(moved);
      upsert(note.meta);
      // Pages open on notes whose links the op rewrote show the new text.
      for (const path of relinked) reloadOpenPage(path);
      await get().refresh();
    },

    toast(text, action) {
      const id = nextToast++;
      // The Toasts overlay dismisses it after a while (overlays/Toasts.tsx).
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action }] }));
    },

    dismiss(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});

/** The note at `path` in the current list, if any. */
export const useNote = (path: string | undefined) => useWorkspace((s) => (path ? noteAt(s.notes, path) : undefined));
