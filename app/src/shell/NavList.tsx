// "All views": every view the sidebar can list, by group, with a filter box
// and a pin or unpin on each row. The sidebar's "More views" opens it inline;
// Settings shows it as the place to arrange the sidebar.

import { useRef, useState, type KeyboardEvent } from "react";

import { useBrowserOn } from "../features/browser/prefs";
import { useCapturesShown } from "../features/extension/captures";
import { useReview } from "../features/review/store";
import { howFrom } from "../features/workspace/store";
import { Icon } from "../ui/Icon";
import { availableNav, groupedNav, type NavItem } from "./nav";
import { useNavPins, type NavPins } from "./nav-pins";
import { IDLE_ROW, NavButton, openView, ROW, useNavMenu } from "./NavRow";

/** The row in the list: its view, and the button that pins or unpins it. In
 * Settings (`arrange`), pinned rows also move up and down. */
function ListRow({ item, pins, onMenu, arrange }: { item: NavItem; pins: NavPins; onMenu: ReturnType<typeof useNavMenu>["onMenu"]; arrange: boolean }) {
  const index = pins.pinned.indexOf(item.id);
  const pinned = index >= 0;
  const small = "grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink";
  // Shown on hover and focus, and always for a pinned row, as a quiet mark.
  const show = pinned ? "" : "opacity-0 focus:opacity-100 group-focus-within/nav:opacity-100 group-hover/nav:opacity-100";
  return (
    <li className="group/nav flex items-center">
      {arrange ? (
        <span className={`${ROW} ${IDLE_ROW} min-w-0 flex-1`}>
          <Icon name={item.icon} className="size-[17px]" />
          <span className="flex-1 truncate">{item.label}</span>
        </span>
      ) : (
        <NavButton item={item} onMenu={onMenu} className="min-w-0 flex-1" />
      )}
      {arrange && pinned && (
        <>
          <button type="button" aria-label={`Move ${item.label} up`} title="Move up" disabled={index === 0} onClick={() => pins.move(item.id, -1)} className={`${small} disabled:opacity-30`}>
            <Icon name="chevron-up" className="size-3.5" />
          </button>
          <button type="button" aria-label={`Move ${item.label} down`} title="Move down" disabled={index === pins.pinned.length - 1} onClick={() => pins.move(item.id, 1)} className={`${small} disabled:opacity-30`}>
            <Icon name="chevron-down" className="size-3.5" />
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={pinned ? `Unpin ${item.label} from the sidebar` : `Pin ${item.label} to the sidebar`}
        title={pinned ? "Unpin from the sidebar" : "Pin to the sidebar"}
        aria-pressed={pinned}
        onClick={() => (pinned ? pins.unpin(item.id) : pins.pin(item.id))}
        className={`${small} ${show} ${pinned ? "text-accent" : ""}`}
      >
        <Icon name={pinned ? "pin" : "pin-off"} className={`size-3.5 ${pinned ? "" : "opacity-60"}`} />
      </button>
    </li>
  );
}

/** The views by group, narrowed by the filter box above them. Escape clears
 * the filter; the arrows move between the box and the rows; Enter on the
 * box opens the first view left. */
export function NavList({ arrange = false, className = "" }: { arrange?: boolean; className?: string }) {
  const pins = useNavPins();
  const { onMenu, menu } = useNavMenu(pins);
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  // A view that arrives (Review, when proposals wait) joins the list.
  useReview((s) => s.proposals.length);
  // So does the Browser, once it is turned on, and Captures.
  useBrowserOn();
  useCapturesShown();
  const groups = groupedNav(availableNav(), query);

  const rows = () => [...(list.current?.querySelectorAll<HTMLElement>("[data-nav-main]") ?? [])];
  const onBoxKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    } else if (event.key === "ArrowDown") {
      // The list's own arrows would move on from the row it lands on.
      event.preventDefault();
      event.stopPropagation();
      rows()[0]?.focus();
    } else if (event.key === "Enter") {
      const first = groups[0]?.items[0];
      if (!first || arrange) return;
      event.preventDefault();
      openView(first.id, howFrom(event));
    }
  };
  const onRowKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const all = rows();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && at === 0) return list.current?.querySelector<HTMLElement>("input")?.focus();
    all[Math.min(all.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return (
    <div ref={list} className={className} role="group" aria-label="All views" onKeyDown={onRowKey}>
      <label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-13 text-muted transition focus-within:border-accent/60 focus-within:bg-canvas hover:bg-hover">
        <Icon name="search" className="size-3.5 shrink-0" />
        <input
          type="text"
          aria-label="Filter views"
          placeholder="Filter views"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onBoxKey}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
        />
      </label>
      {groups.length === 0 && <p className="px-3 py-2 text-13 text-muted">No view is called “{query.trim()}”.</p>}
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label} className="mb-1">
          <h3 className="px-3 pb-0.5 pt-1.5 text-11 font-medium text-muted">{group.label}</h3>
          <ul>
            {group.items.map((item) => (
              <ListRow key={item.id} item={item} pins={pins} onMenu={onMenu} arrange={arrange} />
            ))}
          </ul>
        </section>
      ))}
      {menu}
    </div>
  );
}
