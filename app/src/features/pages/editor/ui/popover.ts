// Notion-style popover menus: sections of rows with an icon, a label and a
// hint, driven by mouse or keyboard, with flyout submenus. The slash menu, the
// block menu, the colour picker and the callout icon all use it.

import { iconElement } from "../../../../ui/icon-dom";
import type { IconName } from "../../../../ui/icons";
import { occludeElement } from "../../../browser/occlusion";
import { el, type Rect } from "./dom";

export interface MenuItem {
  key: string;
  label: string;
  /** Text or emoji for the icon box, or an icon from the app's set as
   * `icon:name`, drawn without a box. */
  icon?: string;
  /** Extra classes on the icon box, e.g. to tint a colour swatch. */
  iconClass?: string;
  /** Draws an `icon:name` inside the icon box, as Notion's block choices are. */
  boxed?: boolean;
  /** Right-aligned hint, such as the Markdown shortcut. */
  hint?: string;
  /** Longer help, shown as a tooltip. */
  description?: string;
  /** Marks the current choice with a check. */
  active?: boolean;
  danger?: boolean;
  /** Keys that pick the item while the menu is open, e.g. "Delete" or "Mod-d". */
  keys?: string[];
  /** Opens a flyout instead of picking. */
  submenu?: () => MenuSection[];
  onPick?: () => void;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

export interface PopoverOptions {
  /** The popover opens below this rectangle, or above it when there is no room. */
  anchor: () => Rect;
  /** Open beside the anchor instead, as submenus do. */
  side?: boolean;
  /** Listen to the keyboard itself. The slash menu forwards the editor's keys instead. */
  ownKeys?: boolean;
  /** Shown when there is nothing to pick. */
  emptyText?: string;
  label?: string;
  /** Called once when the popover closes, for whatever reason. */
  onClose?: () => void;
}

const GAP = 4;
const MARGIN = 8;
const PREFERRED_BELOW = 220;

function matchesKey(event: KeyboardEvent, key: string): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (key.startsWith("Mod-")) return mod && event.key.toLowerCase() === key.slice(4).toLowerCase();
  return !mod && event.key === key;
}

export class Popover {
  readonly el: HTMLElement;
  private items: MenuItem[] = [];
  private rows: HTMLElement[] = [];
  private index = 0;
  private child: Popover | null = null;
  private childIndex = -1;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** Lets go of the area this menu covers: a browser tab's page beside it steps aside while the menu is open. */
  private uncover: () => void = () => {};

  constructor(
    sections: MenuSection[],
    private readonly options: PopoverOptions,
    private readonly parent: Popover | null = null,
  ) {
    this.el = el("div", "kasten-menu");
    this.el.setAttribute("role", "menu");
    if (options.label) this.el.setAttribute("aria-label", options.label);
    // Keep the editor's focus and selection while the menu is used.
    this.el.addEventListener("pointerdown", (event) => event.preventDefault());
    this.el.addEventListener("mousedown", (event) => event.preventDefault());
    document.body.append(this.el);
    this.setSections(sections);
    this.uncover = occludeElement(this.el);
    if (options.ownKeys) window.addEventListener("keydown", this.onKey, true);
    if (!parent) document.addEventListener("pointerdown", this.onOutside, true);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  get selected(): MenuItem | undefined {
    return this.items[this.index];
  }

  setSections(sections: MenuSection[]): void {
    this.closeChild();
    this.el.replaceChildren();
    this.items = [];
    this.rows = [];
    for (const section of sections) {
      if (section.items.length === 0) continue;
      const group = el("div", "kasten-menu-section");
      group.setAttribute("role", "group");
      if (section.title) group.append(el("div", "kasten-menu-title", { textContent: section.title }));
      for (const item of section.items) group.append(this.renderItem(item));
      this.el.append(group);
    }
    if (this.items.length === 0) this.el.append(el("div", "kasten-menu-empty", { textContent: this.options.emptyText ?? "No results" }));
    this.select(0);
    this.position();
  }

  /** Handles a key for the menu; true when the menu used it. */
  handleKey(event: KeyboardEvent): boolean {
    if (this.child) {
      if (event.key === "ArrowLeft" || event.key === "Escape") {
        this.closeChild();
        return true;
      }
      return this.child.handleKey(event);
    }
    switch (event.key) {
      case "ArrowDown":
        this.move(1);
        return true;
      case "ArrowUp":
        this.move(-1);
        return true;
      case "ArrowRight":
        if (!this.selected?.submenu) return false;
        this.openChild(this.index);
        return true;
      case "Enter":
      case "Tab":
        if (this.items.length === 0) return false;
        this.pickAt(this.index);
        return true;
      case "Escape":
        this.close();
        return true;
      default: {
        const index = this.items.findIndex((item) => item.keys?.some((key) => matchesKey(event, key)));
        if (index < 0) return false;
        this.pickAt(index);
        return true;
      }
    }
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    this.select((this.index + delta + this.items.length) % this.items.length);
  }

  /** Places the popover next to its anchor again, e.g. after the caret moved. */
  position(): void {
    const anchor = this.options.anchor();
    const style = this.el.style;
    style.maxHeight = "";
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    const { innerWidth, innerHeight } = window;
    let left: number;
    let top: number;
    if (this.options.side) {
      left = anchor.right + GAP;
      if (left + width > innerWidth - MARGIN) left = Math.max(MARGIN, anchor.left - width - GAP);
      top = Math.max(MARGIN, Math.min(anchor.top - 6, innerHeight - MARGIN - height));
    } else {
      left = Math.max(MARGIN, Math.min(anchor.left, innerWidth - MARGIN - width));
      const below = innerHeight - anchor.bottom - GAP - MARGIN;
      const above = anchor.top - GAP - MARGIN;
      // Below the anchor, as Notion prefers, unless that leaves too little room.
      if (height <= below || below >= Math.min(above, PREFERRED_BELOW)) {
        top = anchor.bottom + GAP;
        if (below > 0 && below < height) style.maxHeight = `${Math.max(below, 160)}px`;
      } else {
        top = Math.max(MARGIN, anchor.top - GAP - Math.min(height, above));
        if (above < height) style.maxHeight = `${above}px`;
      }
    }
    style.left = `${left}px`;
    style.top = `${top}px`;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.hoverTimer);
    this.closeChild();
    this.uncover();
    this.el.remove();
    window.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("pointerdown", this.onOutside, true);
    this.options.onClose?.();
  }

  private renderItem(item: MenuItem): HTMLElement {
    const index = this.items.length;
    const row = el("div", `kasten-menu-item${item.danger ? " is-danger" : ""}`);
    row.setAttribute("role", "menuitem");
    row.dataset.key = item.key;
    if (item.description) row.title = item.description;
    if (item.icon?.startsWith("icon:")) {
      const glyph = el("span", item.boxed ? "kasten-menu-icon" : "kasten-menu-glyph");
      glyph.append(iconElement(item.icon.slice(5) as IconName, item.boxed ? 14 : 16));
      row.append(glyph);
    } else if (item.icon !== undefined) {
      row.append(el("span", `kasten-menu-icon${item.iconClass ? ` ${item.iconClass}` : ""}`, { textContent: item.icon }));
    }
    row.append(el("span", "kasten-menu-label", { textContent: item.label }));
    const hint = item.submenu ? "›" : item.active ? "✓" : item.hint;
    if (hint) row.append(el("span", `kasten-menu-hint${item.active && !item.submenu ? " is-check" : ""}`, { textContent: hint }));
    if (item.submenu) row.setAttribute("aria-haspopup", "menu");
    // Pointer movement, not scrolling under a still pointer, moves the selection.
    row.addEventListener("pointermove", () => {
      if (this.index !== index) this.select(index);
      if (item.submenu && this.childIndex !== index) this.openChildSoon(index);
      else if (!item.submenu) this.closeChild();
    });
    row.addEventListener("click", () => this.pickAt(index));
    this.items.push(item);
    this.rows.push(row);
    return row;
  }

  private select(index: number): void {
    this.rows[this.index]?.classList.remove("is-selected");
    this.index = index;
    const row = this.rows[index];
    if (!row) return;
    row.classList.add("is-selected");
    row.scrollIntoView({ block: "nearest" });
  }

  private pickAt(index: number): void {
    const item = this.items[index];
    if (!item) return;
    if (item.submenu) {
      this.openChild(index);
      return;
    }
    // Pick first: the slash menu still needs to know where its "/" is.
    try {
      item.onPick?.();
    } finally {
      this.root().close();
    }
  }

  private openChildSoon(index: number): void {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => this.openChild(index), 120);
  }

  private openChild(index: number): void {
    clearTimeout(this.hoverTimer);
    const item = this.items[index];
    const row = this.rows[index];
    if (!item?.submenu || !row || this.closed) return;
    this.closeChild();
    this.childIndex = index;
    const child: Popover = new Popover(
      item.submenu(),
      { anchor: () => row.getBoundingClientRect(), side: true, label: item.label, onClose: () => this.forget(child) },
      this,
    );
    this.child = child;
  }

  private forget(child: Popover): void {
    if (this.child !== child) return;
    this.child = null;
    this.childIndex = -1;
  }

  private closeChild(): void {
    this.child?.close();
  }

  private root(): Popover {
    return this.parent ? this.parent.root() : this;
  }

  private contains(target: Node): boolean {
    return this.el.contains(target) || (this.child?.contains(target) ?? false);
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const used = this.handleKey(event);
    // A menu that owns the keyboard also keeps plain typing away from the editor.
    if (used || !(event.ctrlKey || event.metaKey || event.altKey)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private readonly onOutside = (event: Event) => {
    if (!this.contains(event.target as Node)) this.close();
  };
}
