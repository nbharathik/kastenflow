import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { Icon } from "../ui/Icon";
import { menuItems, moveInMenu } from "../ui/menu-keys";
import type { MenuEntry, MenuSubmenu } from "./menu-types";

/** Room kept between a submenu and the window's edges. */
const EDGE = 8;

const ROW_CLASS = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-13 outline-none hover:bg-hover focus-visible:bg-hover";

/** The rows of a menu: each item a button, headings and dividers between groups,
 * and rows that open a submenu. `onPick` runs first (the menu closes), then
 * the item. Shared by `Menu`, `PointMenu` and the Open menu, so every menu
 * looks and answers the same. */
export function MenuItems({ items, onPick }: { items: MenuEntry[]; onPick: () => void }) {
  return (
    <>
      {items.map((item, i) => {
        if (item === "divider") return <hr key={`d${i}`} className="my-1 border-line" />;
        if ("heading" in item) {
          return (
            <div key={`h${i}`} role="presentation" className="kasten-popup-heading">
              {item.heading}
            </div>
          );
        }
        if ("custom" in item) return <div key={`c${item.id}`}>{item.custom}</div>;
        if ("submenu" in item) return <SubmenuRow key={item.label} item={item} onPick={onPick} />;
        return (
          <button
            key={item.label}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            tabIndex={-1}
            className={`${ROW_CLASS} ${item.danger ? "text-danger" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onPick();
              item.onSelect();
            }}
          >
            {item.checked !== undefined ? (
              <span className="flex w-5 justify-center text-accent">{item.checked && <Icon name="check" className="size-4" />}</span>
            ) : (
              item.icon !== undefined && <span className="flex w-5 justify-center text-muted">{item.icon}</span>
            )}
            <span className="flex-1 whitespace-nowrap">{item.label}</span>
            {item.hint && <span className="whitespace-nowrap text-12 text-muted">{item.hint}</span>}
          </button>
        );
      })}
    </>
  );
}

/** A row that opens its list beside it: a click or → opens it with the first
 * item focused, ← or Escape closes it and gives the focus back to the row. */
function SubmenuRow({ item, onPick }: { item: MenuSubmenu; onPick: () => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<CSSProperties>({ left: 0, top: 0, visibility: "hidden" });
  const row = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Placed before the first paint, to the right of the row, or to its left where there is no room.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = row.current?.getBoundingClientRect();
    const size = list.current?.getBoundingClientRect();
    if (!anchor || !size) return;
    const right = anchor.right + 2;
    const left = right + size.width > window.innerWidth - EDGE ? Math.max(EDGE, anchor.left - 2 - size.width) : right;
    setAt({ left, top: Math.max(EDGE, Math.min(anchor.top, window.innerHeight - EDGE - size.height)) });
  }, [open]);

  useEffect(() => {
    if (open) menuItems(list.current)[0]?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    row.current?.focus();
  };

  return (
    <>
      <button
        ref={row}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={-1}
        className={ROW_CLASS}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {item.icon !== undefined && <span className="flex w-5 justify-center text-muted">{item.icon}</span>}
        <span className="flex-1 whitespace-nowrap">{item.label}</span>
        <Icon name="chevron" className="size-3 text-muted" />
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={item.label}
          data-menu-sub=""
          tabIndex={-1}
          className="kasten-popup kasten-shell-menu min-w-48 max-h-[calc(100vh-2rem)] overflow-auto p-1 outline-none"
          style={{ position: "fixed", zIndex: 80, ...at }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (moveInMenu(event, list.current)) {
              event.stopPropagation();
            }
          }}
        >
          <MenuItems items={item.submenu} onPick={onPick} />
        </div>
      )}
    </>
  );
}
