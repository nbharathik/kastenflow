// The overview's All tab: everything in the project (pages, cards and
// captures, whiteboards, decks) as a table or a gallery, found as you type
// with the Library's search words (`tag:`, `type:`, `on:`, `created:`,
// `updated:`) and narrowed by type, tag and dates.

import "../../dashboard/dashboard.css";

import { useDeferredValue, useMemo, useState } from "react";

import { relativeTime } from "../../../lib/dates";
import type { BoardInfo, DeckInfo, NoteMeta } from "../../../lib/vault/types";
import { openMenuHandlers } from "../../../shell/open-menu";
import { Icon } from "../../../ui/Icon";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { Segmented } from "../../../ui/Segmented";
import { BoardTile, DeckTile, NoteTile } from "../../dashboard/NoteTiles";
import { DateFilterField } from "../../library/DateFilterField";
import { Dropdown } from "../../library/Dropdown";
import { useFullText } from "../../library/data";
import { parseQuery } from "../../library/filters";
import { usePrefs } from "../../workspace/prefs";
import { howFromView, useWorkspace } from "../../workspace/store";
import { NO_FILTERS, filterItems, firstDir, hasFilters, itemsOf, sortItems, tagCounts, typeLabel, type Item, type ItemFilters, type SortKey } from "./items";
import { useOverviewPrefs, type Mode } from "./overview-prefs";

/** Rows drawn at once; "Show more" adds as many again. */
const PAGE = 200;

interface Props {
  folder: string;
  notes: NoteMeta[];
  boards: readonly BoardInfo[];
  decks: readonly DeckInfo[];
}

export function AllTab({ folder, notes, boards, decks }: Props) {
  const client = useWorkspace((s) => s.client);
  const weekStart = usePrefs((s) => s.weekStart);
  const [prefs, patch] = useOverviewPrefs(folder);
  const { filters, sort, mode } = prefs;
  const [text, setText] = useState("");
  const typed = useDeferredValue(text);
  const [limit, setLimit] = useState(PAGE);

  const items = useMemo(() => itemsOf(notes, boards, decks, folder), [notes, boards, decks, folder]);
  const query = useMemo(() => parseQuery(typed), [typed]);
  // The core's search is told the project, so the full text it finds is this project's.
  const hits = useFullText(client, typed.trim() ? (client?.kind === "vault" ? `project:${folder} ${typed}` : typed) : "", notes);
  const shown = useMemo(() => sortItems(filterItems(items, filters, { query, hits, now: Date.now(), weekStart }), sort), [items, filters, query, hits, weekStart, sort]);
  const tags = useMemo(() => tagCounts(items), [items]);
  const drawn = shown.slice(0, limit);
  const filtering = hasFilters(filters) || typed.trim() !== "";
  const setFilters = (change: Partial<ItemFilters>) => {
    patch({ filters: { ...filters, ...change } });
    setLimit(PAGE);
  };
  const sortBy = (key: SortKey) => patch({ sort: sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) } });

  return (
    <div className="kasten-overview-all">
      <div className="kasten-overview-controls" role="toolbar" aria-label="Find and filter">
        <label className="flex h-9 min-w-[14rem] flex-1 items-center gap-2 rounded-lg border border-line bg-raised px-3 focus-within:border-accent/60">
          <Icon name="search" className="size-4 text-muted" />
          <input
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setLimit(PAGE);
            }}
            onKeyDown={(event) => {
              // The first Esc empties the box; the next one reaches the view.
              if (event.key !== "Escape" || !text) return;
              event.stopPropagation();
              setText("");
            }}
            placeholder="Find in this project…"
            aria-label="Find in this project"
            title="Words, tag:x, type:card, on:2026-10, created:, updated:, after:, before:"
            className="min-w-0 flex-1 bg-transparent text-14 outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        <Segmented
          label="Type"
          value={filters.kind}
          choices={[
            { value: "all", label: "All" },
            { value: "page", label: "Pages" },
            { value: "card", label: "Cards" },
            { value: "board", label: "Boards" },
            { value: "deck", label: "Decks" },
          ]}
          onChange={(kind) => setFilters({ kind })}
        />
        <Dropdown
          label="Tag"
          value={filters.tag ?? ""}
          active={filters.tag !== null}
          onChange={(tag) => setFilters({ tag: tag || null })}
          options={[{ value: "", label: "Any tag" }, ...tags.map((t) => ({ value: t.tag, label: `#${t.tag}`, detail: String(t.count) }))]}
        />
        <DateFilterField label="Updated" value={filters.updated} onChange={(updated) => setFilters({ updated })} />
        <DateFilterField label="Created" value={filters.created} onChange={(created) => setFilters({ created })} />
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setText("");
              setFilters(NO_FILTERS);
            }}
            className="h-8 rounded-lg px-2 text-13 text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Clear
          </button>
        )}
        <Segmented
          label="Show as"
          value={mode}
          iconsOnly
          choices={[
            { value: "table", label: "Table", icon: "table" },
            { value: "gallery", label: "Gallery", icon: "gallery" },
          ]}
          onChange={(next: Mode) => patch({ mode: next })}
        />
      </div>

      <p className="kasten-overview-count" aria-live="polite">
        {filtering ? `${shown.length.toLocaleString()} of ${items.length.toLocaleString()}` : `${items.length.toLocaleString()} ${items.length === 1 ? "thing" : "things"}`}
      </p>

      {items.length === 0 ? (
        <p className="kasten-overview-empty">Nothing in this project yet. The + New menu makes a page, card, whiteboard or deck here.</p>
      ) : shown.length === 0 ? (
        <p className="kasten-overview-empty">Nothing matches. Try fewer filters.</p>
      ) : mode === "gallery" ? (
        <div className="kasten-tiles is-three" role="list" aria-label="Everything in this project">
          {drawn.map((item) => (
            <div key={item.key} role="listitem" className="contents">
              {item.note ? <NoteTile note={item.note} peek /> : item.board ? <BoardTile board={item.board} /> : item.deck ? <DeckTile deck={item.deck} /> : null}
            </div>
          ))}
        </div>
      ) : (
        <ItemTable items={drawn} sort={sort} onSort={sortBy} />
      )}
      {shown.length > drawn.length && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-13 text-muted">
            Showing {drawn.length.toLocaleString()} of {shown.length.toLocaleString()}
          </p>
          <button type="button" onClick={() => setLimit(limit + PAGE)} className="h-9 rounded-lg border border-line bg-raised px-4 text-13 font-medium outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50">
            Show {Math.min(PAGE, shown.length - drawn.length)} more
          </button>
        </div>
      )}
    </div>
  );
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "type", label: "Type" },
  { key: "updated", label: "Updated" },
  { key: "created", label: "Created" },
];

function ItemTable({ items, sort, onSort }: { items: readonly Item[]; sort: { key: SortKey; dir: "asc" | "desc" }; onSort(key: SortKey): void }) {
  const open = useWorkspace((s) => s.openPath);
  return (
    <table className="kasten-overview-table">
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
              <button type="button" onClick={() => onSort(c.key)}>
                {c.label}
                {sort.key === c.key && <Icon name={sort.dir === "asc" ? "chevron-up" : "chevron-down"} className="size-3" />}
              </button>
            </th>
          ))}
          <th scope="col">Tags</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.key}>
            <td>
              <button type="button" className="kasten-overview-open" onClick={(event) => open(item.path, howFromView(event))} {...openMenuHandlers(item.path)}>
                <span className="kasten-overview-icon" aria-hidden="true">
                  <IconOrEmoji icon={item.icon} />
                </span>
                <span className="truncate">{item.title}</span>
              </button>
            </td>
            <td>{typeLabel(item)}</td>
            <td title={new Date(item.updated).toLocaleString()}>{relativeTime(item.updated)}</td>
            <td>{item.created === null ? "" : new Date(item.created).toLocaleDateString()}</td>
            <td className="kasten-overview-tags">{item.tags.map((t) => `#${t}`).join(" ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
