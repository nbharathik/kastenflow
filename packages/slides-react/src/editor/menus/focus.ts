// Where the focus goes when a field is done with it.

import { type FocusEvent, type KeyboardEvent, type RefObject, useEffect, useRef } from "react";

import { canTakeFocus, editorOf, focusHome, lastEditorRoot } from "../focus/home.ts";
import type { EditorUi } from "../ui-state.ts";

/**
 * Remembers what had the focus before a field took it (the slide, say), so
 * that when the field is done the person can carry on where they were:
 * typing in the open text box if there is one, else on the slide.
 */
export function useReturnFocus(ui: EditorUi) {
  const before = useRef<HTMLElement | null>(null);
  return {
    /** Call from the field's onFocus. */
    remember(event: FocusEvent): void {
      if (event.relatedTarget instanceof HTMLElement) before.current = event.relatedTarget;
    },
    /** Gives the focus back; to the editor's home when the place it was is gone, and not to the page. */
    restore(): void {
      if (ui.state.text) ui.state.text.focus();
      else if (canTakeFocus(before.current)) before.current.focus({ preventScroll: true });
      else focusHome(editorOf(before.current) ?? lastEditorRoot());
    },
  };
}

/**
 * For the wrapper of an open menu or popover: its keys are its own, and do not
 * reach the editor's shortcuts (Delete in a menu must not delete the selection).
 * Escape and Tab go on, since closing and moving on are not the menu's alone.
 */
export function swallowKeys(event: KeyboardEvent): void {
  if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
}

/** The list of a menu, and its first row that can be chosen. */
export const MENU_LIST = ".ks-menu-list";
export const MENU_FIRST_ROW = ".ks-menu-list > button:not(:disabled)";

/**
 * Moves the focus to the first thing in `root` that matches `selector` once the
 * popover in it is shown. A popover is hidden until it has been placed, and
 * something hidden cannot take the focus, so a menu's own attempt to take it
 * as it opens fails in a browser; this one comes a frame later. A null
 * `selector` leaves the focus alone. `key` says when it is a new popover.
 */
export function useFocusWhenShown(root: RefObject<HTMLElement | null>, selector: string | null, key: unknown): void {
  useEffect(() => {
    if (selector === null) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [root, selector, key]);
}
