// The row above Home's recent list: chips for what to show, a project, a
// field that narrows the list as you type, and rows or a denser grid.

import { forwardRef, type KeyboardEvent } from "react";

import { Icon } from "../../ui/Icon";
import { Kbd } from "../../ui/Kbd";
import { Segmented } from "../../ui/Segmented";
import { Dropdown, type DropdownOption } from "../library/Dropdown";
import type { HomeLayout } from "../workspace/prefs";
import { FILTERS, type FilterId, type ItemType } from "./recent-items";

interface FilterBarProps {
  type: FilterId;
  onType(next: FilterId): void;
  /** How many of each kind there are: a chip for a kind with none stays out. */
  counts: Record<ItemType, number> | null;
  project: string | null;
  projects: readonly DropdownOption[];
  onProject(next: string | null): void;
  text: string;
  onText(next: string): void;
  layout: HomeLayout;
  onLayout(next: HomeLayout): void;
  /** Arrow Down in the field, and Enter (with Ctrl, `right`: to the right). */
  onDown(): void;
  onEnter(right: boolean): void;
}

const ALL_PROJECTS = "all";

export const FilterBar = forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar(props, field) {
  const { type, onType, counts, project, projects, onProject, text, onText, layout, onLayout, onDown, onEnter } = props;
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onDown();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onEnter(event.ctrlKey || event.metaKey);
    } else if (event.key === "Escape" && text) {
      // The first Esc empties the field; the next one leaves it.
      event.preventDefault();
      event.stopPropagation();
      onText("");
    }
  };
  return (
    <div className="kasten-home-filters">
      <div role="group" aria-label="Show" className="kasten-home-chipset">
        {FILTERS.filter((f) => f.id === "all" || f.id === type || (counts && counts[f.id as ItemType] > 0)).map((f) => (
          <button key={f.id} type="button" aria-pressed={f.id === type} className="kasten-home-filter" onClick={() => onType(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="kasten-home-tools">
        {projects.length > 1 && (
          <Dropdown label="Project" value={project ?? ALL_PROJECTS} options={projects} onChange={(value) => onProject(value === ALL_PROJECTS ? null : value)} />
        )}
        <label className="kasten-home-find">
          <Icon name="search" className="size-[15px] shrink-0 text-faint" />
          <input
            ref={field}
            type="text"
            value={text}
            onChange={(event) => onText(event.target.value)}
            onKeyDown={keys}
            placeholder="Filter"
            aria-label="Filter the list"
            aria-keyshortcuts="/"
            spellCheck={false}
            autoComplete="off"
          />
          {text ? (
            <button type="button" className="kasten-home-find-clear" aria-label="Clear the filter" onClick={() => onText("")}>
              <Icon name="close" className="size-3.5" />
            </button>
          ) : (
            <Kbd keys="/" />
          )}
        </label>
        <Segmented
          label="Layout"
          value={layout}
          choices={[
            { value: "list", label: "Rows", icon: "list" },
            { value: "grid", label: "Grid", icon: "gallery" },
          ]}
          onChange={onLayout}
          iconsOnly
        />
      </div>
    </div>
  );
});
