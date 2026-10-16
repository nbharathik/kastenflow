// The keyboard on the hub's cards or rows: the arrows, Home, End and Page keys
// move between them (one tab stop for the whole list), Enter opens the
// overview, Shift+Enter the project page, P pins, the menu key opens the
// menu, and Alt with an arrow moves the project in the order it is kept in.

import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { howFrom, type OpenHow } from "../../workspace/store";
import { nextIndex } from "./hub-keys";

export interface NavActions {
  open(folder: string, how: OpenHow): void;
  page(folder: string, how: OpenHow): void;
  pin(folder: string): void;
  /** Opens the card's menu beside the point (the card's corner). */
  menu(folder: string, at: { x: number; y: number }): void;
  /** Moves the project a place earlier or later, when the order allows; true when it moved. */
  shift(folder: string, step: -1 | 1): boolean;
}

interface Options {
  /** The projects in the order they are shown. */
  order: readonly string[];
  /** Cards to a row now (1 for the list), and the rows a Page key skips. */
  columns(): number;
  rows: number;
  /** Draws and scrolls to the item at an index, for a list that draws only some of its items. */
  reveal?(index: number): void;
  actions: NavActions;
}

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** The card button of a project, if it is drawn. */
function cardOf(root: HTMLElement | null, folder: string): HTMLElement | null {
  return [...(root?.querySelectorAll<HTMLElement>("[data-card]") ?? [])].find((el) => el.dataset.card === folder) ?? null;
}

export function useCardNav({ order, columns, rows, reveal, actions }: Options) {
  const root = useRef<HTMLUListElement>(null);
  const [asked, setActive] = useState<string | null>(null);
  /** The project whose card takes the focus once it is drawn. */
  const want = useRef<string | null>(null);
  const active = asked !== null && order.includes(asked) ? asked : (order[0] ?? null);

  // After each draw: a card that was asked for takes the focus once it is there.
  useLayoutEffect(() => {
    if (want.current === null) return;
    const el = cardOf(root.current, want.current);
    if (!el) return;
    want.current = null;
    el.focus({ preventScroll: false });
  });

  const focusCard = (folder: string) => {
    const index = order.indexOf(folder);
    if (index < 0) return;
    reveal?.(index);
    want.current = folder;
    setActive(folder);
    // Drawn already: no render is coming to run the effect.
    const el = cardOf(root.current, folder);
    if (el) {
      want.current = null;
      el.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const hit = event.target instanceof HTMLElement && event.target.matches("[data-card]") ? event.target : null;
    if (!hit) return;
    const folder = hit.dataset.card!;
    const index = order.indexOf(folder);
    if (index < 0) return;
    const { key } = event;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;

    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ARROWS.has(key)) {
      event.preventDefault();
      if (actions.shift(folder, key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1)) focusCard(folder);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      // Shift+Enter is the project page; Ctrl, Alt and Ctrl+Alt choose the tab, a split and the pane to the right, as they do on a click.
      if (event.shiftKey) actions.page(folder, howFrom({ ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey }));
      else actions.open(folder, howFrom(event));
      return;
    }
    if (plain && !event.shiftKey) {
      const to = nextIndex(key, index, order.length, columns(), rows);
      if (to !== null) {
        event.preventDefault();
        if (to !== index) focusCard(order[to]!);
        return;
      }
      if (key === "p" || key === "P") {
        event.preventDefault();
        actions.pin(folder);
        // The card moves in the list; the focus goes with it.
        want.current = folder;
        setActive(folder);
        return;
      }
    }
    if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const box = hit.parentElement?.getBoundingClientRect() ?? hit.getBoundingClientRect();
      actions.menu(folder, { x: box.left + 24, y: box.top + 40 });
    }
  };

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const folder = event.target instanceof HTMLElement ? event.target.dataset.card : undefined;
    if (folder) setActive(folder);
  };

  return { root, active, focusCard, rootProps: { onKeyDown, onFocus } };
}
