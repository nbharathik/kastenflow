// A view's row in the sidebar, and the menu on its right-click. A plain
// click goes there; Ctrl, Shift, Alt and the middle button open it in a tab,
// the stack or beside it, as they do everywhere.

import { useState, type MouseEvent, type ReactNode } from "react";

import { howFrom, useWorkspace, type OpenHow } from "../features/workspace/store";
import { Icon } from "../ui/Icon";
import { placeOfNav, showsNav, type NavItem } from "./nav";
import type { NavPins } from "./nav-pins";
import { openItems } from "./open-menu";
import { PointMenu } from "./PointMenu";

export const ROW = "group/row flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-13 transition-colors";
export const ACTIVE_ROW = "bg-selected font-medium text-ink [&>svg]:text-ink";
export const IDLE_ROW = "text-ink/85 hover:bg-hover [&>svg]:text-muted";

/** Whether `id` is the view in the focused tab; a page in the journal folder is the journal. */
export function useActive(id: string): boolean {
  return useWorkspace((s) => {
    if (id === "journal") return s.place.view === "journal" || (s.place.view === "page" && Boolean(s.place.path?.startsWith("journal/")));
    return showsNav(s.place, id);
  });
}

/** Opens a view the way asked. */
export function openView(id: string, how: OpenHow = "here"): void {
  useWorkspace.getState().go(placeOfNav(id), how);
}

interface RowProps {
  item: NavItem;
  /** A count shown at the end. */
  badge?: number;
  onMenu: (event: MouseEvent, item: NavItem) => void;
  /** Extra controls at the row's end. */
  trailing?: ReactNode;
  /** The button is the row (no wrapper), as in the sidebar's top. */
  className?: string;
}

/** The view's button: icon, label and count. */
export function NavButton({ item, badge, onMenu, className = "" }: RowProps) {
  const active = useActive(item.id);
  return (
    <button
      type="button"
      onClick={(event) => openView(item.id, howFrom(event))}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        openView(item.id, "tab");
      }}
      onContextMenu={(event) => onMenu(event, item)}
      aria-current={active ? "page" : undefined}
      data-nav-main=""
      className={`${ROW} ${active ? ACTIVE_ROW : IDLE_ROW} ${className}`}
    >
      <Icon name={item.icon} className="size-[17px]" />
      <span className="flex-1 truncate">{item.label}</span>
      {badge ? <span className="min-w-5 rounded bg-well px-1.5 text-center text-11 font-medium leading-[18px] text-muted">{badge}</span> : null}
    </button>
  );
}

/** The menu a view's row shows on right-click: the Open menu's ways to open
 * it, then pin or unpin and moving it among the pinned. `menu` is to be
 * drawn once, anywhere in the component that uses the hook. */
export function useNavMenu(pins: NavPins): { onMenu: RowProps["onMenu"]; menu: ReactNode } {
  const [at, setAt] = useState<{ x: number; y: number; item: NavItem } | null>(null);
  const close = () => setAt(null);
  let menu: ReactNode = null;
  if (at) {
    const index = pins.pinned.indexOf(at.item.id);
    const pinned = index >= 0;
    const id = at.item.id;
    menu = (
      <PointMenu
        x={at.x}
        y={at.y}
        label={`${at.item.label} options`}
        onClose={close}
        items={[
          ...openItems(placeOfNav(id)),
          "divider",
          pinned
            ? { label: "Unpin from the sidebar", icon: <Icon name="pin-off" className="size-4" />, onSelect: () => pins.unpin(id) }
            : { label: "Pin to the sidebar", icon: <Icon name="pin" className="size-4" />, onSelect: () => pins.pin(id) },
          ...(pinned && index > 0 ? [{ label: "Move up", icon: <Icon name="chevron-up" className="size-4" />, onSelect: () => pins.move(id, -1) }] : []),
          ...(pinned && index < pins.pinned.length - 1 ? [{ label: "Move down", icon: <Icon name="chevron-down" className="size-4" />, onSelect: () => pins.move(id, 1) }] : []),
        ]}
      />
    );
  }
  return {
    onMenu: (event, item) => {
      event.preventDefault();
      setAt({ x: event.clientX, y: event.clientY, item });
    },
    menu,
  };
}
