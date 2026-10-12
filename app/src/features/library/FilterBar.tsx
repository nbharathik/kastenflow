import type { ReactNode } from "react";

import { Segmented } from "../../ui/Segmented";
import { DateFilterField } from "./DateFilterField";
import { Dropdown } from "./Dropdown";
import { INBOX, KINDS, NO_FILTERS, PAGES, SORTS, SORT_LABELS, firstDir, hasFilters, type Filters, type Sort, type TagCount } from "./filters";
import { GROUPS, type GroupBy } from "./groups";
import { Glyph } from "./parts";

export interface FilterBarProps {
  filters: Filters;
  onFilters(patch: Partial<Filters>): void;
  /** Projects by folder, with their titles. */
  projects: readonly { folder: string; title: string }[];
  tags: readonly TagCount[];
  /** Whether link and board counts have loaded (the toggles need them). */
  counted: boolean;
}

const control = "h-8 rounded-lg border text-13 outline-none transition-colors  focus-visible:ring-2 focus-visible:ring-accent/50";
const idle = "border-line bg-raised text-ink hover:bg-hover";
const set = "border-accent/55 bg-accent/12 font-medium text-accent";

/** Type, project, tag and date filters, and the board toggles. */
export function FilterBar({ filters, onFilters, projects, tags, counted }: FilterBarProps) {
  const placeKnown = filters.place === null || filters.place === INBOX || filters.place === PAGES || projects.some((p) => p.folder === filters.place);
  const tagKnown = filters.tag === null || tags.some((t) => t.tag === filters.tag);

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filters">
      {/* Scrolls sideways rather than spill out of a narrow pane. */}
      <Segmented
        label="Type"
        size="lg"
        className="max-w-full overflow-x-auto [scrollbar-width:none]"
        value={filters.kind}
        choices={KINDS.map((kind) => ({ value: kind.id, label: kind.label }))}
        onChange={(kind) => onFilters({ kind })}
      />

      <Dropdown
        label="Project"
        value={filters.place ?? ""}
        active={filters.place !== null}
        onChange={(v) => onFilters({ place: v || null })}
        options={[
          { value: "", label: "Any project" },
          { value: INBOX, label: "Inbox" },
          { value: PAGES, label: "Pages (no project)" },
          ...projects.map((p) => ({ value: p.folder, label: p.title, group: "Projects" })),
          ...(placeKnown ? [] : [{ value: filters.place!, label: filters.place!, group: "Projects" }]),
        ]}
      />

      <Dropdown
        label="Tag"
        value={filters.tag ?? ""}
        active={filters.tag !== null}
        onChange={(v) => onFilters({ tag: v || null })}
        options={[
          { value: "", label: "Any tag" },
          ...tags.map((t) => ({ value: t.tag, label: `#${t.label}`, detail: String(t.count) })),
          ...(tagKnown ? [] : [{ value: filters.tag!, label: `#${filters.tag}` }]),
        ]}
      />

      <DateFilterField label="Updated" value={filters.updated} onChange={(updated) => onFilters({ updated })} />
      <DateFilterField label="Created" value={filters.created} onChange={(created) => onFilters({ created })} />

      <Toggle on={filters.noBoard} waiting={!counted} onClick={() => onFilters({ noBoard: !filters.noBoard })} hint="Notes that sit on no whiteboard">
        On no board
      </Toggle>
      <Toggle on={filters.orphans} waiting={!counted} onClick={() => onFilters({ orphans: !filters.orphans })} hint="No links in or out, and on no board">
        Orphans
      </Toggle>

      {hasFilters(filters) && (
        <button
          type="button"
          onClick={() => onFilters(NO_FILTERS)}
          className="h-8 rounded-lg px-2 text-13 text-muted outline-none transition-colors hover:bg-line/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/** Updated, Created, Title or Most linked, and which way. */
export function SortControl({ sort, onSort }: { sort: Sort; onSort(sort: Sort): void }) {
  const preset = SORTS.some((s) => s.key === sort.key);
  return (
    <div className="flex items-center gap-1">
      <Dropdown
        label="Sort"
        value={sort.key}
        display={`Sort: ${SORT_LABELS[sort.key]}`}
        onChange={(v) => onSort({ key: v as Sort["key"], dir: SORTS.find((s) => s.key === v)?.dir ?? firstDir(v as Sort["key"]) })}
        options={[...SORTS.map((s) => ({ value: s.key, label: s.label })), ...(preset ? [] : [{ value: sort.key, label: SORT_LABELS[sort.key] }])]}
      />
      <button
        type="button"
        aria-label={sort.dir === "asc" ? "Ascending; switch to descending" : "Descending; switch to ascending"}
        title={sort.dir === "asc" ? "Ascending" : "Descending"}
        onClick={() => onSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
        className={`${control} ${idle} grid w-8 place-items-center text-muted`}
      >
        <Glyph name={sort.dir === "asc" ? "up" : "down"} className="size-3.5" />
      </button>
    </div>
  );
}

/** How cards are grouped under headings: none, type, project, tag, month or week. */
export function GroupControl({ group, onGroup }: { group: GroupBy; onGroup(group: GroupBy): void }) {
  return (
    <Dropdown
      label="Group by"
      value={group}
      display={group === "none" ? "Group: none" : `Group: ${GROUPS.find((g) => g.id === group)?.label.toLowerCase()}`}
      active={group !== "none"}
      onChange={(v) => onGroup(v as GroupBy)}
      options={GROUPS.map((g) => ({ value: g.id, label: g.label }))}
    />
  );
}

function Toggle({ on, waiting, onClick, hint, children }: { on: boolean; waiting: boolean; onClick(): void; hint: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={waiting ? `${hint} (counting links…)` : hint}
      onClick={onClick}
      className={`${control} ${on ? set : idle} flex items-center gap-1.5 px-2.5`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full transition-colors ${on ? "bg-accent" : "bg-muted/40"}`} />
      {children}
    </button>
  );
}
