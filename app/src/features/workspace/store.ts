// The open workspace: the vault client, its notes, where the window is and
// the way back. Every change to a note goes through the client, and so
// through kasten-core inside the app.

import { create } from "zustand";

import { reportStartup } from "../../lib/api";
import { isDay, isoDay } from "../../lib/dates";
import { useShell } from "../../lib/store";
import type { NoteMeta, VaultClient } from "../../lib/vault/types";
import { isDraft } from "./drafts";
import { wayToOpen } from "./go-how";
import { directoryOf } from "./links";
import { openKind } from "./open-kind";
import { loadRecent, MAX_RECENT, saveRecent } from "./recent";
import { merged, patched, sameMeta, settled, upserted } from "./note-list";
import { dropStats, holdStats } from "./note-stats";
import { usePeek } from "../peek/store";
import { usePrefs } from "./prefs";
import { derive, layoutSlice, loadLayout } from "./store-layout";
import { noteActions } from "./store-notes";
import * as tabs from "./tabs";
import { findByTitle, noteAt } from "./tree";
import { withDrafts } from "./with-drafts";

export type { Place, ViewId } from "./tabs";
export type { OpenHow } from "./store-layout";
export { howFrom, howFromName, howFromView } from "./store-layout";

import type { WorkspaceState } from "./store-types";
export type { Draft, Toast, WorkspaceState } from "./store-types";

/** A journal day's page: `journal/2026/2026-09-24.md`. */
const JOURNAL_DAY = /^journal\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
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

  /** The waiting counts of typed pages, taken into the list. */
  function takeStats(metas: NoteMeta[]) {
    let notes = get().notes;
    for (const meta of metas) notes = settled(notes, meta);
    if (notes === get().notes) return;
    edits++;
    set({ notes });
  }

  /** A save's counts alone do not change the list (so nothing drawn from it
   * draws again for each one): the page's details show them from
   * note-stats.ts and the list takes them in when the typing pauses. */
  function upsert(meta: NoteMeta) {
    const notes = upserted(get().notes, meta);
    if (notes === get().notes) {
      const had = noteAt(notes, meta.path);
      if (had && !sameMeta(had, meta)) holdStats(meta, takeStats);
      return;
    }
    dropStats(meta.path);
    edits++;
    set({ notes });
  }

  const saved = loadLayout();
  const { apply, actions } = layoutSlice(set as never, get);
  const noteOps = noteActions(set, get, {
    attempt,
    upsert,
    apply,
    edited: () => {
      edits++;
    },
  });
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
    ...noteOps,

    async connect({ client: vault, problem, choose }) {
      // New pages are drafts until written in: the client makes them then,
      // and the tabs follow each to its page.
      const client = vault ? withDrafts(vault, { onMade: (draft, note) => void get().renamed(draft, { note, relinked: [] }) }) : null;
      set({ client, problem: problem ?? null, choosing: Boolean(choose), ready: false });
      // Choosing another vault starts again: marks of an earlier connection are not this start's time.
      performance.clearMarks?.("kasten:connected");
      performance.clearMarks?.("kasten:listed");
      performance.mark?.("kasten:connected");
      if (client) await get().refresh();
      performance.mark?.("kasten:listed");
      if (client) reportStartup();
      // Tabs and stack cards for notes that are gone (deleted meanwhile) close.
      if (client) {
        const known = new Set(get().notes.map((n) => n.path));
        const openAtStart = new Set(tabs.openPaths(get().layout));
        const stack = get().stack.filter((p) => known.has(p));
        if (stack.length !== get().stack.length) set({ stack, stackOpen: get().stackOpen && stack.length > 0 });
        // Boards, decks and diagrams are listed together, and after the window is ready: their tabs close
        // when their file is gone, and while the lists are on their way they stay open. A list that cannot
        // be read leaves its tabs open.
        void Promise.all([attempt((c) => c.boards()), attempt((c) => c.decks()), attempt((c) => c.diagrams())]).then(([boards, decks, diagrams]) => {
          if (get().client !== client) return;
          // A tag's database (`#tag`) stays open too.
          // So does a journal day, written in or not.
          // Only what was open when the window began is judged: a page made meanwhile is not in these lists yet.
          const current = new Set(get().notes.map((n) => n.path));
          const kept = (path: string) =>
            !openAtStart.has(path) ||
            known.has(path) ||
            current.has(path) ||
            path.startsWith("#") ||
            JOURNAL_DAY.test(path) ||
            (path.endsWith(".canvas") && (!boards || boards.some((b) => b.path === path))) ||
            (path.endsWith(".deck") && (!decks || decks.some((d) => d.path === path))) ||
            (path.endsWith(".drawio") && (!diagrams || diagrams.some((d) => d.path === path)));
          let layout = get().layout;
          for (const path of tabs.openPaths(layout)) if (!kept(path)) layout = tabs.forgetPath(layout, path);
          if (layout !== get().layout) apply(layout);
        });
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
        dropStats();
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
      // A change made elsewhere brings its counts like a save does.
      for (const meta of found) {
        const had = noteAt(notes, meta.path);
        if (had && !sameMeta(had, meta)) holdStats(meta, takeStats);
      }
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
      const kind = openKind(path);
      get().go({ view: kind === "page" && JOURNAL_DAY.test(path) ? "journal" : kind, path }, how);
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

    async openJournal(date = isoDay(new Date()), how) {
      // The page is made on writing, not on looking (JournalView).
      get().go({ view: "journal", path: `journal/${date.slice(0, 4)}/${date}.md` }, how);
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
