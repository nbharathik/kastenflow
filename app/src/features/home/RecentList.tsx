// Home's Recent: one short list of what you opened and changed last, with
// chips for the kind of thing, a project, and a field that narrows the list as
// you type. The choices are remembered; "/" goes to the field, the arrows move
// through the list, Enter opens and Ctrl+Enter opens to the right.

import "./recent.css";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useShell } from "../../lib/store";
import { useBoards } from "../boards/store";
import { useDiagrams } from "../diagrams/store";
import type { DropdownOption } from "../library/Dropdown";
import { useDecks } from "../slides/store";
import { titleOf } from "../workspace/names";
import { usePrefs } from "../workspace/prefs";
import { useProjectLists } from "../workspace/project-actions";
import { useWorkspace } from "../workspace/store";
import { FilterBar } from "./FilterBar";
import { countTypes, FILTERS, isFilter, NO_PROJECT, pick, type FilterId } from "./recent-items";
import { RecentRow, SkeletonRow } from "./RecentRow";

/** Rows drawn; the last two give way on a short window (home.css). */
const ROWS = 10;

/** Whether keys typed at `target` belong to a field or an editor. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"));
}

export function RecentList() {
  const ready = useWorkspace((s) => s.ready);
  const notes = useWorkspace((s) => s.notes);
  const opened = useWorkspace((s) => s.recent);
  const boards = useBoards((s) => s.list);
  const decks = useDecks((s) => s.list);
  const diagrams = useDiagrams((s) => s.list);
  const saved = usePrefs((s) => s.homeFilter);
  const savedProject = usePrefs((s) => s.homeProject);
  const layout = usePrefs((s) => s.homeLayout);
  const { active, archived } = useProjectLists();
  const [typed, setTyped] = useState("");
  const text = useDeferredValue(typed);
  const [at, setAt] = useState(0);
  const root = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Until the vault has answered there is nothing to say yet: rows hold their places.
  const loading = !ready && notes.length === 0;
  const type: FilterId = isFilter(saved) ? saved : "all";
  const titles = useMemo(() => new Map([...active, ...archived].filter((p) => p.project).map((p) => [p.project!, titleOf(p)])), [active, archived]);
  // A remembered project that is gone no longer narrows the list.
  const project = savedProject !== null && (savedProject === NO_PROJECT || titles.has(savedProject)) ? savedProject : null;
  const projects = useMemo<DropdownOption[]>(
    () => (active.length === 0 ? [] : [{ value: "all", label: "All projects" }, ...active.filter((p) => p.project).map((p) => ({ value: p.project!, label: titleOf(p) })), { value: NO_PROJECT, label: "No project" }]),
    [active],
  );

  const counts = useMemo(() => (loading ? null : countTypes({ notes, boards, decks, diagrams, opened: [] })), [loading, notes, boards, decks, diagrams]);
  const picked = useMemo(() => pick({ notes, boards, decks, diagrams, opened }, { type, project, text }, ROWS), [notes, boards, decks, diagrams, opened, type, project, text]);
  const everything = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0;

  const set = usePrefs.getState().set;
  const reset = () => {
    setTyped("");
    set({ homeFilter: "all", homeProject: null });
  };

  // "/" goes to the field, from anywhere in the window that is not a field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      // With several panes, only the one that has the focus answers.
      const pane = root.current?.closest(".kasten-pane");
      if (!root.current?.isConnected || (pane && document.querySelectorAll(".kasten-pane").length > 1 && !pane.classList.contains("is-focused"))) return;
      event.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = () => [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    const all = rows();
    const now = all.indexOf(document.activeElement as HTMLElement);
    if (now < 0) return;
    const to = event.key === "ArrowDown" ? now + 1 : event.key === "ArrowUp" ? now - 1 : event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0) field.current?.focus();
    else all[Math.min(to, all.length - 1)]?.focus();
  };

  const empty = !loading && picked.items.length === 0;
  const projectTitle = (folder: string | null) => (folder ? (titles.get(folder) ?? null) : null);
  return (
    <section ref={root} className="kasten-home-recent" aria-label="Recent">
      <FilterBar
        ref={field}
        type={type}
        onType={(next) => set({ homeFilter: next })}
        counts={counts}
        project={project}
        projects={projects}
        onProject={(next) => set({ homeProject: next })}
        text={typed}
        onText={setTyped}
        layout={layout}
        onLayout={(next) => set({ homeLayout: next })}
        onDown={() => rows()[0]?.focus()}
        onEnter={(right) => picked.items[0] && useWorkspace.getState().openPath(picked.items[0].path, right ? "right" : "here")}
      />
      {empty ? (
        <Nothing everything={everything} typed={text} type={type} project={project} onReset={reset} />
      ) : (
        <ul ref={list} role="list" className="kasten-home-rows" data-layout={layout} aria-label="Recent items" aria-busy={loading} onKeyDown={move}>
          {loading
            ? Array.from({ length: ROWS }, (_, i) => <SkeletonRow key={i} />)
            : picked.items.map((item, i) => <RecentRow key={item.path} item={item} project={projectTitle(item.project)} tab={i === Math.min(at, picked.items.length - 1)} onFocus={() => setAt(i)} />)}
        </ul>
      )}
      {picked.total > picked.items.length && (
        <p className="kasten-home-foot">
          <span>
            {picked.items.length} of {picked.total}
          </span>
          <button type="button" className="kasten-home-link" onClick={() => useShell.getState().setPalette(true, typed.trim())}>
            Search everywhere
          </button>
        </p>
      )}
    </section>
  );
}

/** One sentence and one way on, when the list has nothing to show. */
function Nothing({ everything, typed, type, project, onReset }: { everything: number; typed: string; type: FilterId; project: string | null; onReset(): void }) {
  const kind = FILTERS.find((f) => f.id === type)?.label.toLowerCase() ?? "things";
  const words = typed.trim();
  const narrowed = words !== "" || type !== "all" || project !== null;
  const sentence = words
    ? `Nothing matches “${words}”.`
    : project !== null
      ? `No ${type === "all" ? "notes" : kind} in this project yet.`
      : type !== "all"
        ? `No ${kind} yet.`
        : everything === 0
          ? "Nothing here yet."
          : "Nothing to show.";
  return (
    <div className="kasten-home-nothing" role="status">
      <p>{sentence}</p>
      {narrowed && (
        <button type="button" className="ui-btn is-sm" onClick={onReset}>
          Show everything
        </button>
      )}
    </div>
  );
}
