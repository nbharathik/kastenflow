// The left pane of Settings: a search box over the groups, under small
// headings that fold. Up and Down move between them, Enter opens one; while a
// search is on the list shows only the groups that have a match, each with
// how many. A narrow window swaps the list for a drop-down.

import type { KeyboardEvent, RefObject } from "react";

import { IconButton } from "../../../../ui/Button";
import { Icon } from "../../../../ui/Icon";
import { Kbd } from "../../../../ui/Kbd";
import { GROUPS, HEADINGS, type Found, type GroupId, type NavHeading } from "./index";

interface NavProps {
  query: string;
  onQuery(query: string): void;
  found: Found | null;
  current: GroupId;
  onPick(group: GroupId): void;
  folded: readonly NavHeading[];
  onFold(heading: NavHeading): void;
  search: RefObject<HTMLInputElement | null>;
  /** The window is too narrow for the list: a drop-down takes its place. */
  narrow: boolean;
}

export function SettingsNav({ query, onQuery, found, current, onPick, folded, onFold, search, narrow }: NavProps) {
  const count = (id: GroupId) => found?.byGroup.get(id) ?? 0;
  const shown = (id: GroupId) => found === null || count(id) > 0;
  const rows = HEADINGS.map((heading) => ({ heading, groups: GROUPS.filter((g) => g.heading === heading && shown(g.id)) })).filter((r) => r.groups.length > 0);
  const closed = (heading: NavHeading) => found === null && folded.includes(heading);
  const visible = rows.flatMap((r) => (closed(r.heading) ? [] : r.groups));
  // The one stop of the list for Tab: the open group, or the first shown.
  const stop = visible.find((g) => g.id === current)?.id ?? visible[0]?.id;

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-nav]")];
    const here = (event.target as HTMLElement).closest<HTMLElement>("[data-nav]");
    const at = here ? items.indexOf(here) : -1;
    const go = (to: number) => {
      event.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
    };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(items.length - 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const heading = here?.dataset.heading as NavHeading | undefined;
      if (heading && closed(heading) === (event.key === "ArrowRight")) {
        event.preventDefault();
        onFold(heading);
      }
    }
  };

  return (
    <nav aria-label="Settings sections" className="kasten-set-nav">
      <div className="kasten-set-search">
        <Icon name="search" className="size-4 text-muted" />
        <input
          ref={search}
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              onQuery("");
            } else if (event.key === "ArrowDown" && !narrow) {
              event.preventDefault();
              event.currentTarget.closest("nav")?.querySelector<HTMLElement>("[data-nav][tabindex='0']")?.focus();
            }
          }}
        />
        {query ? <IconButton icon="close" label="Clear search" size="sm" onClick={() => onQuery("")} /> : <Kbd keys="/" className="kasten-set-slash" />}
      </div>
      {narrow ? (
        <select className="ui-field kasten-set-select" aria-label="Settings group" value={visible.some((g) => g.id === current) ? current : (visible[0]?.id ?? current)} onChange={(event) => onPick(event.target.value as GroupId)}>
          {rows.map(({ heading, groups }) => (
            <optgroup key={heading} label={heading}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {found ? `${g.title} (${count(g.id)})` : g.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <div className="kasten-set-list" onKeyDown={onListKey}>
          {rows.map(({ heading, groups }) => (
            <div key={heading} className="kasten-set-heading-block">
              <button type="button" data-nav data-heading={heading} tabIndex={-1} className="kasten-set-heading" aria-expanded={!closed(heading)} onClick={() => onFold(heading)}>
                <Icon name="chevron" className="kasten-set-chevron size-3" />
                {heading}
              </button>
              {!closed(heading) && (
                <ul>
                  {groups.map((g) => (
                    <li key={g.id}>
                      <button type="button" data-nav tabIndex={g.id === stop ? 0 : -1} className="kasten-set-item" aria-current={found === null && g.id === current ? "page" : undefined} onClick={() => onPick(g.id)}>
                        <Icon name={g.icon} className="size-4" />
                        <span className="kasten-set-item-title">{g.title}</span>
                        {found && <span className="kasten-set-count">{count(g.id)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
