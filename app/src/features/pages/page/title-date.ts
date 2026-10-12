// A date on any page: `@` in the page's title opens the date menu, and a pick
// sets the page's `date` property (the calendar shows pages by it). This file is
// the menu and the reading of what was typed; PageHeader.tsx draws the chip.

import { dateItems } from "../editor/menus/mention-dates";
import type { Rect } from "../editor/ui/dom";
import { Popover } from "../editor/ui/popover";

const MAX_QUERY = 60;

/** The `@` being typed before the caret in `value`: where it starts and what
 * follows it, or null. As in the page's text, an `@` inside a word does not
 * count (an address), and a space then a letter ends it. */
export function atQuery(value: string, caret: number): { from: number; query: string } | null {
  const before = value.slice(0, caret);
  const from = before.lastIndexOf("@");
  if (from < 0 || (from > 0 && !/\s/.test(before[from - 1]!))) return null;
  const query = before.slice(from + 1);
  if (query.length > MAX_QUERY || /^\s|\s\s|\n/.test(query)) return null;
  return { from, query };
}

/** The title with the `@` and what was typed after it taken out. */
export function withoutAt(value: string, from: number, caret: number): string {
  return `${value.slice(0, from)}${value.slice(caret)}`.replace(/\s{2,}/g, " ").trim();
}

/** The date menu under a title or a chip: days only, as a page's date has no time. */
export class DateMenu {
  private popover: Popover | null = null;
  private query: string | null = null;

  constructor(
    private readonly anchor: () => Rect,
    private readonly weekStart: () => number,
    private readonly pick: (day: string) => void,
  ) {}

  get isOpen(): boolean {
    return this.popover !== null;
  }

  /** Opens the menu for what was typed, or updates it. */
  show(query: string): void {
    if (this.popover && query === this.query) return;
    this.query = query;
    const items = dateItems(query, { weekStart: this.weekStart(), timeless: true }, (day) => this.pick(day));
    if (this.popover) this.popover.setSections([{ items }]);
    else this.popover = new Popover([{ items }], { anchor: this.anchor, label: "Date", emptyText: "No date matches", onClose: () => this.forget() });
  }

  /** Gives a key to the menu; true when it used it. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.popover) return false;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    if (!["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) return false;
    if (!this.popover.selected) {
      this.close();
      return false;
    }
    return this.popover.handleKey(event);
  }

  close(): void {
    this.popover?.close();
  }

  private forget(): void {
    this.popover = null;
    this.query = null;
  }
}
