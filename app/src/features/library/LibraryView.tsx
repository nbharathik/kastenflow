import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { Icon } from "../../ui/Icon";
import { savedSearch } from "../collections/from-search";
import { SaveCollectionDialog } from "../collections/SaveDialog";
import { useAgentMarked } from "../review/agent-marked";
import { titleOf } from "../workspace/names";
import { captureCard } from "../workspace/overlays/commands";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { projects } from "../workspace/tree";
import { BulkBar } from "./BulkBar";
import { searchedWords, usePageJump } from "../workspace/page/jump";
import { CardGrid, type OpenEvent } from "./CardGrid";
import { CardTable } from "./CardTable";
import { useLibraryRequests } from "./request";
import { useFullText, useNoteStats, useTagColors } from "./data";
import { FilterBar, GroupControl, SortControl } from "./FilterBar";
import { NO_FILTERS, buildRows, filterRows, firstDir, hasFilters, parseQuery, sortRows, tagCounts, type SortKey } from "./filters";
import { groupRows, limitGroups, shownRows } from "./groups";
import { isMac } from "../shortcuts/keymap";
import { useKeyLabel } from "../shortcuts/store";
import { Glyph, cards } from "./parts";
import { useLibraryPrefs, type Mode } from "./prefs";
import { clickAction, selectRange, toggle } from "./selection";

export type { OpenEvent };

/** Cards drawn at once; "Show more" adds as many again. */
const PAGE = 200;

export interface LibraryViewProps {
  /** Opens a card. The shell can pass one that sends Shift+click to a side
   * stack; by default the card opens in place. */
  onOpen?: (path: string, event: OpenEvent) => void;
}

/** The Card Library: every note as a card or a table row, found
 * as you type, filtered, sorted and organised in bulk. */
export function LibraryView({ onOpen }: LibraryViewProps) {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const [prefs, setPrefs] = useLibraryPrefs();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  // "Save as collection" asks for a name over the Library.
  const [saving, setSaving] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLElement>(null);
  const { filters, sort, mode, group } = prefs;
  // "This week" and the week groups start on the day Settings → Calendar says.
  const weekStart = usePrefs((s) => s.weekStart);
  // Groups folded away, by key; they keep their heading and count.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());

  // Typing stays instant; the list catches up a moment later if it must.
  const typed = useDeferredValue(query);
  const { stats, reload } = useNoteStats(client, notes);
  const hits = useFullText(client, typed, notes);
  const tagColors = useTagColors(client);

  const rows = useMemo(() => buildRows(notes), [notes]);
  // One question for every card's agent marks, asked again as notes change.
  const paths = useMemo(() => rows.map((r) => r.path), [rows]);
  const marked = useAgentMarked(client, paths);
  // Counts change the order only when sorting by them, and the list only
  // with the board toggles on.
  const sortStats = sort.key === "boards" || sort.key === "backlinks" ? stats : null;
  const filterStats = filters.noBoard || filters.orphans ? stats : null;
  const sorted = useMemo(() => sortRows(rows, sort, sortStats), [rows, sort, sortStats]);
  const parsed = useMemo(() => parseQuery(typed), [typed]);
  const matched = useMemo(() => filterRows(sorted, filters, { stats: filterStats, query: parsed, hits, now: Date.now(), weekStart }), [sorted, filters, filterStats, parsed, hits, weekStart]);
  // What is on show: the cards of the groups not folded, in the order drawn.
  const groups = useMemo(() => groupRows(matched, group, { sort, weekStart }, folded), [matched, group, sort, weekStart, folded]);
  const shown = useMemo(() => shownRows(groups), [groups]);
  const tags = useMemo(() => tagCounts(rows), [rows]);
  const places = useMemo(() => projects(notes).map((p) => ({ folder: p.project!, title: titleOf(p) })), [notes]);

  // Back to the first page whenever what is shown changes.
  const view = `${JSON.stringify(filters)}|${sort.key}|${sort.dir}|${group}|${typed}`;
  const [paging, setPaging] = useState({ view, limit: PAGE });
  const limit = paging.view === view ? paging.limit : PAGE;
  const drawn = useMemo(() => limitGroups(groups, limit), [groups, limit]);
  const visible = useMemo(() => shownRows(drawn), [drawn]);
  const onFold = useCallback((key: string) => setFolded((current) => toggle(current, key)), []);

  // Only shown cards count as selected, so an action never touches a hidden one.
  const chosen = useMemo(() => shown.filter((r) => selected.has(r.path)), [shown, selected]);
  const chosenPaths = useMemo(() => new Set(chosen.map((r) => r.path)), [chosen]);

  const open = useCallback(
    (path: string, event: OpenEvent) => {
      // A page found by search opens at the first match, with the words marked.
      const find = searchedWords(typed);
      if (find.length > 0) usePageJump.setState({ jump: { path, find, at: Date.now() } });
      if (onOpen) onOpen(path, event);
      else useWorkspace.getState().openPath(path);
    },
    [onOpen, typed],
  );
  const pick = useCallback(
    (path: string, range: boolean) => {
      setSelected((current) => (range ? selectRange(current, shown.map((r) => r.path), anchor, path) : toggle(current, path)));
      setAnchor(path);
    },
    [shown, anchor],
  );
  const onCardClick = useCallback(
    (path: string, event: MouseEvent<HTMLElement>) => {
      const action = clickAction(event, chosen.length > 0);
      if (action === "open") open(path, event);
      else pick(path, action === "range");
    },
    [chosen.length, open, pick],
  );
  const onCheck = useCallback((path: string, event: MouseEvent<HTMLElement>) => pick(path, event.shiftKey && anchor !== null), [pick, anchor]);
  const selectAll = useCallback(() => setSelected(new Set(shown.map((r) => r.path))), [shown]);
  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);
  const done = useCallback(() => {
    clear();
    reload();
  }, [clear, reload]);
  const sortBy = (key: SortKey) => setPrefs({ sort: sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) } });
  const clearAll = () => {
    setQuery("");
    setPrefs({ filters: NO_FILTERS });
  };

  // Ctrl+Shift+F, tags and the palette open the Library on a query.
  useLibraryRequests((text) => {
    setQuery(text);
    search.current?.focus();
  });

  // Ctrl+F (Cmd+F) finds a card instead of searching the window's text.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The search bar gets an edge once cards scroll under it.
  const [stuck, setStuck] = useState(false);
  const edge = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!edge.current) return;
    const watch = new IntersectionObserver(([entry]) => setStuck(entry ? !entry.isIntersecting : false));
    watch.observe(edge.current);
    return () => watch.disconnect();
  }, []);

  const filtering = typed.trim() !== "" || hasFilters(filters);
  // Until the full-text search answers, an empty list may not be the last word.
  const searching = typed.trim() !== "" && hits === null;

  return (
    <div className="flex min-h-full flex-col bg-panel">
      {/* In a narrow pane the controls go to a line of their own. */}
      <header className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-10 sm:px-10">
        <h1 className="text-28 font-bold tracking-tight">
          <Icon name="library" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
          Card Library
        </h1>
        <span className="rounded bg-well px-2 py-0.5 text-13 font-medium tabular-nums text-muted" title={cards(rows.length)} aria-label={cards(rows.length)}>
          {rows.length.toLocaleString()}
        </span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <SortControl sort={sort} onSort={(s) => setPrefs({ sort: s })} />
          <GroupControl group={group} onGroup={(next) => setPrefs({ group: next })} />
          <div role="group" aria-label="Show as" className="ui-seg is-lg">
            <ModeButton mode="grid" current={mode} onPick={(m) => setPrefs({ mode: m })} />
            <ModeButton mode="table" current={mode} onPick={(m) => setPrefs({ mode: m })} />
          </div>
        </div>
      </header>

      <div ref={edge} aria-hidden="true" className="h-px" />
      <div className={`sticky top-0 z-20 border-b bg-panel transition-[border-color,box-shadow] ${stuck ? "border-line shadow-hover" : "border-transparent"}`}>
        <div className="mx-auto w-full max-w-[1400px] space-y-3 px-6 pb-4 pt-5 sm:px-10">
          <label className="flex h-12 items-center gap-3 rounded-xl border border-line bg-raised px-4 shadow-card transition focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15">
            <Icon name="search" className="size-5 text-muted" />
            <input
              ref={search}
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  // The first Esc empties the box; the next one reaches the selection.
                  event.stopPropagation();
                  setQuery("");
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  content.current?.querySelector<HTMLElement>("[data-library-item]")?.focus();
                } else if (event.key === "Enter" && visible[0]) open(visible[0].path, event);
              }}
              placeholder="Find a card…"
              aria-label="Find a card"
              aria-keyshortcuts="Control+F"
              className="h-full min-w-0 flex-1 bg-transparent text-16 outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-line/50 hover:text-ink">
                <Glyph name="close" className="size-4" />
              </button>
            ) : (
              <kbd className="rounded-md border border-line px-1.5 py-0.5 font-sans text-11 text-muted">{isMac() ? "⌘F" : "Ctrl F"}</kbd>
            )}
          </label>
          <FilterBar filters={filters} onFilters={(patch) => setPrefs({ filters: { ...filters, ...patch } })} projects={places} tags={tags} counted={stats !== null} />
        </div>
      </div>

      <section ref={content} aria-label="Results" className="mx-auto w-full max-w-[1400px] flex-1 px-6 pb-12 pt-1 sm:px-10">
        {filtering && (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {matched.length > 0 && (
              <p className="text-13 text-muted" aria-live="polite">
                {matched.length.toLocaleString()} of {cards(rows.length)}
              </p>
            )}
            <button
              type="button"
              onClick={() => setSaving(true)}
              className="h-7 rounded-md border border-line bg-raised px-2.5 text-13 font-medium outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Save as collection
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyVault />
        ) : matched.length === 0 && searching ? (
          <p className="mt-16 text-center text-14 text-muted">Searching the full text…</p>
        ) : matched.length === 0 ? (
          <NoMatch onClear={clearAll} />
        ) : mode === "grid" ? (
          <CardGrid
            groups={drawn}
            grouped={group !== "none"}
            onFold={onFold}
            selected={chosenPaths}
            stats={stats}
            hits={hits}
            words={parsed.words}
            tagColors={tagColors}
            marked={marked}
            onCardClick={onCardClick}
            onCheck={onCheck}
            onPick={pick}
            onOpen={open}
            onSelectAll={selectAll}
          />
        ) : (
          <CardTable
            groups={drawn}
            grouped={group !== "none"}
            onFold={onFold}
            selected={chosenPaths}
            stats={stats}
            tagColors={tagColors}
            marked={marked}
            words={parsed.words}
            sort={sort}
            onSort={sortBy}
            onRowClick={onCardClick}
            onCheck={onCheck}
            onCheckAll={() => (visible.every((r) => chosenPaths.has(r.path)) ? clear() : selectAll())}
          />
        )}
        {shown.length > visible.length && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <p className="text-13 text-muted">
              Showing {visible.length.toLocaleString()} of {shown.length.toLocaleString()}
            </p>
            <button
              type="button"
              onClick={() => setPaging({ view, limit: limit + PAGE })}
              className="h-9 rounded-lg border border-line bg-raised px-4 text-13 font-medium shadow-card outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Show {Math.min(PAGE, shown.length - visible.length)} more
            </button>
          </div>
        )}
      </section>

      {chosen.length > 0 && <BulkBar rows={chosen} shown={shown.length} tags={tags} tagColors={tagColors} onSelectAll={selectAll} onClear={clear} onDone={done} />}
      {saving && <SaveCollectionDialog saved={savedSearch(typed, filters, weekStart)} onClose={() => setSaving(false)} />}
    </div>
  );
}

const MODES: Record<Mode, { label: string; glyph: "grid" | "table" }> = { grid: { label: "Grid", glyph: "grid" }, table: { label: "Table", glyph: "table" } };

function ModeButton({ mode, current, onPick }: { mode: Mode; current: Mode; onPick(mode: Mode): void }) {
  return (
    <button type="button" aria-pressed={mode === current} onClick={() => onPick(mode)}>
      <Glyph name={MODES[mode].glyph} className="size-3.5" />
      {MODES[mode].label}
    </button>
  );
}

function EmptyVault() {
  const captureKey = useKeyLabel("new-card");
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-well text-muted" aria-hidden="true">
        <Icon name="library" className="size-7" />
      </div>
      <h2 className="mt-3 text-16 font-semibold">Your library is empty</h2>
      <p className="mt-1.5 text-14 leading-relaxed text-muted">
        Every note you make shows up here as a card. Catch a first thought with Quick capture: {captureKey ? <>press {captureKey} anywhere, or type it on Home.</> : "type it on Home."}
      </p>
      <button type="button" onClick={() => captureCard()} className="mt-5 h-9 rounded-lg bg-accent px-4 text-13 font-medium text-on-accent outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2">
        New quick note
      </button>
    </div>
  );
}

function NoMatch({ onClear }: { onClear(): void }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-well text-muted" aria-hidden="true">
        <Icon name="search" className="size-7" />
      </div>
      <p className="mt-3 text-16 font-medium">No cards match. Try fewer filters.</p>
      <button type="button" onClick={onClear} className="mt-4 h-9 rounded-lg border border-line px-4 text-13 font-medium outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50">
        Clear filters
      </button>
    </div>
  );
}
