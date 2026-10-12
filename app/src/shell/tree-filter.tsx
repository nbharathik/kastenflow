// The sidebar's filter box: type to narrow the page tree to the titles that
// match, with the pages and projects that hold them opened out. Rows ask
// the context what to show; with no filter typed the context is null and
// the tree is as usual.

import { createContext, useContext, type KeyboardEvent } from "react";

import type { TreeMatch } from "../features/workspace/sidebar-rows";
import { Icon } from "../ui/Icon";

const FilterContext = createContext<TreeMatch | null>(null);

export const TreeFilterProvider = FilterContext.Provider;

/** What the filter leaves of the tree, or null while none is typed. */
export const useTreeFilter = (): TreeMatch | null => useContext(FilterContext);

/** Whether the row at `path` stays while a filter is typed. */
export const keeps = (filter: TreeMatch | null, path: string): boolean => filter === null || filter.show.has(path);

interface BoxProps {
  value: string;
  onChange: (value: string) => void;
}

/** The filter box above the tree. Escape clears it; the down arrow or Enter
 * moves to the first row left. */
export function TreeFilterBox({ value, onChange }: BoxProps) {
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && value) {
      event.preventDefault();
      event.stopPropagation();
      onChange("");
    } else if (event.key === "ArrowDown" || event.key === "Enter") {
      const first = event.currentTarget.closest("nav")?.querySelector<HTMLElement>("[data-tree] [data-row-title]");
      if (!first) return;
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-13 text-muted transition focus-within:border-accent/60 focus-within:bg-canvas hover:bg-hover">
      <Icon name="filter" className="size-3.5 shrink-0" />
      <input
        type="text"
        aria-label="Filter pages"
        placeholder="Filter pages"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKey}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
      />
      {value && (
        <button type="button" aria-label="Clear the filter" title="Clear the filter" onClick={() => onChange("")} className="grid size-4 place-items-center rounded text-muted hover:text-ink">
          <Icon name="close" className="size-3" />
        </button>
      )}
    </label>
  );
}
