import "../features/pages/editor/styles/tokens.css";
import "../features/pages/page/popups.css";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { boxOf } from "../features/browser/bounds";
import { useOccludes } from "../features/browser/occlusion";
import { Popup } from "../features/pages/page/Popup";
import { Icon } from "../ui/Icon";
import { menuItems, moveInMenu } from "../ui/menu-keys";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  /** A switch: shown ticked or not, read out as on or off. */
  checked?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  label: string;
  items: (MenuItem | "divider")[];
  /** The button's face. */
  children: ReactNode;
  buttonClass?: string;
  /** Classes for the box around the button, such as full width. */
  wrapClass?: string;
  align?: "left" | "right";
  /** Extra content above the items, such as page options. */
  header?: ReactNode;
  /** Floats over the window from the button, opening upwards or sliding
   * sideways to stay inside it: for menus in a scrolling list, such as the
   * sidebar's rows, which would otherwise be cut off by the list. */
  float?: boolean;
}

/** Room kept between a floating menu and its button, and the window's edges. */
const GAP = 4;
const EDGE = 8;

/** Where a floating menu of this size goes for its button. */
function floatAt(anchor: DOMRect, menu: DOMRect, align: "left" | "right"): CSSProperties {
  const left = align === "right" ? anchor.right - menu.width : anchor.left;
  let top = anchor.bottom + GAP;
  if (top + menu.height > window.innerHeight - EDGE) {
    const above = anchor.top - GAP - menu.height;
    top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - EDGE - menu.height);
  }
  return { left: Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - menu.width)), top };
}

/** The rows of a menu: each item a button, dividers between groups. `onPick`
 * runs first (the menu closes), then the item. Shared by `Menu` and the
 * Open menu, so every menu looks and answers the same. */
export function MenuItems({ items, onPick }: { items: (MenuItem | "divider")[]; onPick: () => void }) {
  return (
    <>
      {items.map((item, i) =>
        item === "divider" ? (
          <hr key={`d${i}`} className="my-1 border-line" />
        ) : (
          <button
            key={item.label}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            tabIndex={-1}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-13 outline-none hover:bg-hover focus-visible:bg-hover ${item.danger ? "text-danger" : ""}`}
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
        ),
      )}
    </>
  );
}

/** A button with a small dropdown of actions, closed by Escape or a click
 * outside. The arrows move between its items; opened from the keyboard,
 * the first item has the focus, and Escape gives it back to the button. */
export function Menu({ label, items, children, buttonClass = "", wrapClass = "", align = "right", header, float = false }: MenuProps) {
  const [open, setOpen] = useState<false | "pointer" | "keys">(false);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = () => wrap.current?.querySelector<HTMLElement>('[role="menu"]') ?? null;
  // Over a browser tab's page it would be hidden behind it.
  useOccludes(Boolean(open), () => {
    const list = menu();
    return list ? boxOf(list.getBoundingClientRect()) : null;
  });

  // Focus goes into the menu once it is placed: to its first item when
  // opened from the keyboard, else to the menu itself, so the arrows work.
  const placed = !float || at !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const list = menu();
    if (open === "keys") menuItems(list)[0]?.focus();
    else list?.focus({ preventScroll: true });
  }, [open, placed]);

  // Placed before the first paint, and again as the window or a list scrolls.
  useLayoutEffect(() => {
    if (!open || !float) return;
    const place = () => {
      const menu = box.current?.firstElementChild?.getBoundingClientRect();
      const anchor = button.current?.getBoundingClientRect();
      if (menu && anchor) setAt(floatAt(anchor, menu, align));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, float, align]);

  const list = (
    <Popup
      label={label}
      anchor={button}
      role="menu"
      onClose={() => setOpen(false)}
      className={`kasten-shell-menu min-w-56 p-1 outline-none ${float ? "" : `top-full mt-1 ${align === "right" ? "right-0" : "left-0"}`}`}
    >
      {header}
      <MenuItems items={items} onPick={() => setOpen(false)} />
    </Popup>
  );

  return (
    <span
      ref={wrap}
      className={`relative ${wrapClass || "inline-flex"}`}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") button.current?.focus();
        else if (event.key === "Tab") setOpen(false);
        else moveInMenu(event, menu());
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        className={buttonClass}
        onClick={(event) => {
          event.stopPropagation();
          // A click from the keyboard (Enter or Space) has no pointer detail.
          setOpen((o) => (o ? false : event.detail === 0 ? "keys" : "pointer"));
        }}
        onKeyDown={(event) => {
          if (open || event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen("keys");
        }}
      >
        {children}
      </button>
      {open &&
        (float ? (
          <div ref={box} className="fixed z-50" style={at ?? { left: 0, top: 0, visibility: "hidden" }}>
            {list}
          </div>
        ) : (
          list
        ))}
    </span>
  );
}

/** Right-click on a row opens the row's own menu (its "…" button), where
 * it has one, in place of the browser's. */
export function openRowMenu(event: MouseEvent<HTMLElement>): void {
  const button = event.currentTarget.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
  if (!button) return;
  event.preventDefault();
  // A click with a pointer's detail, so the menu opens as for the pointer.
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
}
