import { type JSX, type KeyboardEvent as ReactKeyEvent, useEffect, useMemo, useRef, useState } from "react";

import { isMac } from "../commands/keys.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Menu } from "../ui/Menu.tsx";
import { type Anchor, anchorOf } from "../ui/Popover.tsx";
import { useEditor } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";
import { barMenus } from "./bar-menus.ts";
import { MENU_FIRST_ROW, MENU_LIST, useFocusWhenShown } from "./focus.ts";
import { keepsEditorFocus } from "./useDropdown.ts";
import "./menus.css";

/** The letter after Alt that opens each menu: File, Edit, View, Insert, fOrmat, sliDe, Arrange, Tools, Help. */
export const MNEMONICS: Readonly<Record<string, string>> = { F: "file", E: "edit", V: "view", I: "insert", O: "format", D: "slide", A: "arrange", T: "tools", H: "help" };

interface Opened {
  index: number;
  anchor: Anchor;
  /** The keyboard opened it (or moved to it), so it takes the focus. */
  keyboard: boolean;
}

/** The last thing the person did with a key or the pointer, for deciding where the focus goes when a menu closes. */
interface Input {
  type: "pointer" | "key";
  key: string;
  onBar: boolean;
  inMenu: boolean;
}

/**
 * File, Edit, View, Insert, Format, Slide, Arrange, Tools and Help. A menu
 * opens on a click and the others open as the pointer passes over them; the
 * arrow keys move between them. It leaves the focus where it is when a text
 * box is being edited, so formatting applies to the words selected.
 */
export function MenuBar({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  useEditor(session);
  useUiState(ui);
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  const menus = barMenus(ctx);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const last = useRef<Input>({ type: "key", key: "", onBar: false, inMenu: false });
  /** Where the focus goes back to when a menu is done with it. */
  const restore = useRef<HTMLElement | null>(null);
  const enteredFrom = useRef<HTMLElement | null>(null);

  // Registered before any popover's own listeners, so they see each press first.
  useEffect(() => {
    const note = (event: PointerEvent | KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      last.current = {
        type: "key" in event ? "key" : "pointer",
        key: "key" in event ? event.key : "",
        onBar: target?.closest(".ks-menubar-item") != null,
        inMenu: target?.closest(".ks-popover") != null,
      };
    };
    document.addEventListener("pointerdown", note, true);
    document.addEventListener("keydown", note, true);
    return () => {
      document.removeEventListener("pointerdown", note, true);
      document.removeEventListener("keydown", note, true);
    };
  }, []);

  // Opened with the keyboard the first row is ready; opened with the mouse the arrow keys work at once.
  const takesFocus = opened !== null && !keepsEditorFocus(ui, opened.keyboard);
  useFocusWhenShown(root, takesFocus ? (opened.keyboard ? MENU_FIRST_ROW : MENU_LIST) : null, opened?.index);

  const openAt = (index: number, keyboard: boolean) => {
    const button = buttons.current[index];
    if (!button) return;
    if (!opened) restore.current = keyboard ? enteredFrom.current : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActive(index);
    setOpened({ index, anchor: anchorOf(button), keyboard });
  };

  // Alt and a letter opens a menu, as in Google Slides (Alt+F File, Alt+O Format, Alt+D Slide), where the computer does not use Alt to type.
  const openMenu = useRef<(id: string) => void>(() => {});
  openMenu.current = (id) => {
    const index = menus.findIndex((menu) => menu.id === id);
    if (index >= 0) openAt(index, true);
  };
  useEffect(() => {
    if (isMac()) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !event.code.startsWith("Key")) return;
      const id = MNEMONICS[event.code.slice(3)];
      const editor = root.current?.closest(".ks-editor");
      if (!id || !editor?.contains(document.activeElement)) return;
      // First of all, so that an open menu (which keeps the keys it is typed to for itself) does not take the letter for a search.
      event.preventDefault();
      event.stopPropagation();
      openMenu.current(id);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const focusItem = (index: number): number => {
    const to = (index + menus.length) % menus.length;
    setActive(to);
    buttons.current[to]?.focus();
    return to;
  };

  /** Closes the menu. Unless the person clicked somewhere else, the focus goes back to where it was, or to the title. */
  const shut = (giveFocusBack: boolean, toTitle = false) => {
    const index = opened?.index;
    setOpened(null);
    if (!giveFocusBack) return;
    if (toTitle && index !== undefined) buttons.current[index]?.focus();
    else if (restore.current?.isConnected) restore.current.focus({ preventScroll: true });
    else if (index !== undefined && opened?.keyboard) buttons.current[index]?.focus();
  };

  /** A menu asked to close: Escape, a press outside, or a row was chosen. */
  const onClose = () => {
    const input = last.current;
    // A press on one of the bar's own buttons: that button decides whether it closes or switches.
    if (input.type === "pointer" && input.onBar) return;
    if (input.type === "pointer" && !input.inMenu) return shut(false);
    shut(true, input.key === "Escape" && opened?.keyboard === true);
  };

  const onKeyDown = (event: ReactKeyEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const from = target?.classList.contains("ks-menubar-item") ? Number(target.dataset.index) : null;
    if (from !== null) {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step !== 0) {
        event.preventDefault();
        const to = focusItem(from + step);
        if (opened) openAt(to, true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openAt(from, true);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusItem(event.key === "Home" ? 0 : menus.length - 1);
      }
      return;
    }
    if (!opened) return;
    // From inside the open menu: sideways moves to the neighbouring menu, unless the menu used the key for a sub-menu.
    if (!event.defaultPrevented && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      openAt((opened.index + (event.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length, true);
    } else if (event.key === "Tab") setOpened(null);
    // The keys belong to the menu while it is open, not to the editor's shortcuts.
    if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
  };

  return (
    <div
      ref={root}
      className="ks-menubar"
      role="menubar"
      aria-label="Menus"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.relatedTarget instanceof HTMLElement && !root.current?.contains(event.relatedTarget)) enteredFrom.current = event.relatedTarget;
      }}
    >
      {menus.map((menu, i) => (
        <button
          key={menu.id}
          ref={(node) => {
            buttons.current[i] = node;
          }}
          type="button"
          role="menuitem"
          className={`ks-btn ks-menubar-item${opened?.index === i ? " is-open" : ""}`}
          data-index={i}
          data-ks-keep-focus=""
          tabIndex={i === active ? 0 : -1}
          aria-haspopup="menu"
          aria-expanded={opened?.index === i}
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => setActive(i)}
          onMouseEnter={(event) => {
            if (opened && opened.index !== i) setOpened({ index: i, anchor: anchorOf(event.currentTarget), keyboard: opened.keyboard });
          }}
          onClick={(event) => {
            if (opened?.index === i) shut(true);
            else openAt(i, event.detail === 0);
          }}
        >
          {menu.label}
        </button>
      ))}
      {opened ? (
        <div className="ks-contents" data-ks-keep-focus="">
          <Menu items={menus[opened.index]?.items() ?? []} anchor={opened.anchor} onClose={onClose} keepFocus={keepsEditorFocus(ui, opened.keyboard)} label={menus[opened.index]?.label} />
        </div>
      ) : null}
    </div>
  );
}
