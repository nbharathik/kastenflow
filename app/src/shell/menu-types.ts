import type { ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  /** A switch: shown ticked or not, read out as on or off. */
  checked?: boolean;
  onSelect: () => void;
}

/** A small title over a group of items. It is not an item: the arrows pass it by. */
export interface MenuHeading {
  heading: string;
}

/** A row that opens a list of its own beside the menu: with → or a click; ← or Escape closes it. */
export interface MenuSubmenu {
  label: string;
  icon?: ReactNode;
  submenu: MenuEntry[];
}

/** Free content between rows, such as the page style controls. Buttons inside a
 * `data-menu-focus` element are reached by the arrows like any item. */
export interface MenuCustom {
  custom: ReactNode;
  /** Keeps the content's identity between renders. */
  id: string;
}

export type MenuEntry = MenuItem | MenuHeading | MenuSubmenu | MenuCustom | "divider";
