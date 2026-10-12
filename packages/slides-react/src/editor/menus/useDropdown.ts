// A button that opens a menu or a popover. It opens on a click and closes on
// the next one (the popover's own "press outside closes it" would otherwise
// close it just before the click opens it again), remembers whether the
// keyboard opened it, and puts the focus back where it was when it closes.

import { type MouseEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import type { EditorUi } from "../ui-state.ts";
import { type Anchor, anchorOf } from "../ui/Popover.tsx";

export interface Dropdown {
  /** Where the popover opens from; null while it is closed. */
  anchor: Anchor | null;
  /** The keyboard opened it, so the menu takes the focus. */
  keyboard: boolean;
  close(): void;
  /** Opens it from `element` without a click on the button: a key that asks for it (the keyboard opened it). */
  openFrom(element: Element): void;
  /** Spread these on the button. */
  trigger: {
    ref: RefObject<HTMLButtonElement | null>;
    onClick(event: MouseEvent<HTMLButtonElement>): void;
    "aria-haspopup": "menu" | "dialog";
    "aria-expanded": boolean;
  };
}

/**
 * Whether a menu opened here has to leave the focus alone: a text box is being
 * edited and the mouse opened the menu. Opened with the keyboard, or with no
 * text box open, a menu takes the focus so its arrow keys work.
 */
export function keepsEditorFocus(ui: EditorUi, keyboard: boolean): boolean {
  return !keyboard && ui.state.text !== null;
}

export function useDropdown(popup: "menu" | "dialog" = "menu"): Dropdown {
  const button = useRef<HTMLButtonElement | null>(null);
  const [opened, setOpened] = useState<{ anchor: Anchor; keyboard: boolean } | null>(null);
  const isOpen = useRef(false);
  isOpen.current = opened !== null;
  /** The press that is going on began on the button while the popover was open: it has already closed it. */
  const closedByPress = useRef(false);
  const before = useRef<HTMLElement | null>(null);

  // These are registered before the popover's own listeners (it mounts later), so they see the press first.
  useEffect(() => {
    const press = (event: Event) => {
      closedByPress.current = event.type === "pointerdown" && isOpen.current && event.target instanceof Node && button.current?.contains(event.target) === true;
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("keydown", press, true);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("keydown", press, true);
    };
  }, []);

  // A closed menu that had the focus leaves it on nothing: give it back.
  useEffect(() => {
    if (opened !== null) return;
    const back = before.current;
    before.current = null;
    if (back?.isConnected && (document.activeElement === document.body || document.activeElement === null)) back.focus({ preventScroll: true });
  }, [opened]);

  const close = useCallback(() => setOpened(null), []);

  const openFrom = useCallback((element: Element) => {
    before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpened({ anchor: anchorOf(element), keyboard: true });
  }, []);

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (closedByPress.current) {
      closedByPress.current = false;
      return;
    }
    if (isOpen.current) return close();
    before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpened({ anchor: anchorOf(event.currentTarget), keyboard: event.detail === 0 });
  };

  return {
    anchor: opened?.anchor ?? null,
    keyboard: opened?.keyboard ?? false,
    close,
    openFrom,
    trigger: { ref: button, onClick, "aria-haspopup": popup, "aria-expanded": opened !== null },
  };
}
