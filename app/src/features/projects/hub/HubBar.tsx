// The top of the Projects hub: its title and "New project", then the search,
// the status chips, Archived, the sort and the gallery or list switch.

import { forwardRef, type KeyboardEvent } from "react";

import { Button } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { Kbd } from "../../../ui/Kbd";
import { Segmented } from "../../../ui/Segmented";
import { Dropdown } from "../../library/Dropdown";
import { SORTS, STATUS_FILTERS, type Focus, type HubLayout, type SortId, type StatusFilter } from "./hub-model";

const FOCUS_NAMES: Record<Focus, string> = { overdue: "Overdue to-dos", review: "Reviews due", stale: "Stale" };

interface Props {
  /** The projects in the view (archived ones apart), for the heading. */
  total: number;
  status: StatusFilter;
  onStatus(status: StatusFilter): void;
  counts: Record<StatusFilter, number>;
  archived: boolean;
  archivedCount: number;
  onArchived(on: boolean): void;
  focus: Focus | null;
  onFocus(focus: Focus | null): void;
  text: string;
  onText(text: string): void;
  sort: SortId;
  onSort(sort: SortId): void;
  layout: HubLayout;
  onLayout(layout: HubLayout): void;
  onNew(): void;
  /** Arrow Down in the search field goes to the first card. */
  onDown(): void;
}

export const HubBar = forwardRef<HTMLInputElement, Props>(function HubBar(props, field) {
  const { total, status, onStatus, counts, archived, archivedCount, onArchived, focus, onFocus, text, onText, sort, onSort, layout, onLayout, onNew, onDown } = props;
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onDown();
    } else if (event.key === "Escape" && text) {
      // The first Escape empties the field; the next one leaves it.
      event.preventDefault();
      event.stopPropagation();
      onText("");
    }
  };
  return (
    <>
      <header className="kasten-hub-bar">
        <h1>Projects</h1>
        <span className="kasten-hub-total">{archived ? `${total} archived` : total === 1 ? "1 project" : `${total} projects`}</span>
        <span className="flex-1" />
        <Button tone="primary" icon="plus" onClick={onNew}>
          New project
        </Button>
      </header>
      <div className="kasten-hub-tools">
        <div role="group" aria-label="Status" className="kasten-hub-chipset">
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} type="button" className="kasten-hub-filter" aria-pressed={status === f.id} onClick={() => onStatus(f.id)}>
              {f.label} <span className="kasten-hub-filter-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="kasten-hub-filter" aria-pressed={archived} title="Show the archived projects" onClick={() => onArchived(!archived)}>
          <Icon name="archive" className="size-3.5" />
          Archived <span className="kasten-hub-filter-count">{archivedCount}</span>
        </button>
        {focus && (
          <button type="button" className="kasten-hub-focus" aria-label={`Stop showing only: ${FOCUS_NAMES[focus]}`} onClick={() => onFocus(null)}>
            {FOCUS_NAMES[focus]}
            <Icon name="close" className="size-3" />
          </button>
        )}
        <span className="flex-1" />
        <label className="kasten-hub-find">
          <Icon name="search" className="size-[15px] shrink-0 text-faint" />
          <input ref={field} type="text" value={text} placeholder="Search projects" aria-label="Search projects" aria-keyshortcuts="/" spellCheck={false} autoComplete="off" onChange={(event) => onText(event.target.value)} onKeyDown={keys} />
          {text ? (
            <button type="button" className="kasten-hub-find-clear" aria-label="Clear the search" onClick={() => onText("")}>
              <Icon name="close" className="size-3.5" />
            </button>
          ) : (
            <Kbd keys="/" />
          )}
        </label>
        <Dropdown label="Sort" value={sort} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} onChange={(value) => onSort(value as SortId)} />
        <Segmented
          label="Layout"
          value={layout}
          choices={[
            { value: "gallery", label: "Gallery", icon: "gallery" },
            { value: "list", label: "List", icon: "list" },
          ]}
          onChange={onLayout}
          iconsOnly
        />
      </div>
    </>
  );
});
