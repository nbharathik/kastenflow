// Keys that fall on the page. When nothing has the focus (a deck was just opened, a window was left and came back, a menu or a dialog
// closed on a place that is gone) the browser sends Delete, Ctrl+Z and the copy and paste events to the body, outside the editor, and they
// do nothing until a click gives the editor the focus again. A host that knows this editor is the one in use says so
// (`routeOrphanKeys`), and then those keys take the editor's home and act as they would have there. Never from a field that has the focus,
// while a presentation or a dialog is open, or for plain typing: the host's own letter shortcuts are not ours to take.

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import { copyNative, pasteNative } from "../clipboard/events.ts";
import { dispatchKey } from "../commands/index.ts";
import type { CommandContext } from "../commands/types.ts";
import { canCopyHere } from "../clipboard/commands.ts";
import { placeOf } from "../clipboard/place.ts";
import { focusHome, focusIsLost, homeOf } from "./home.ts";

/** Events one editor took, so that a second editor listening for the same orphan does not take it again. */
const taken = new WeakSet<Event>();

/** Whether the event fell on the page itself and not on anything in it. */
function fellOnThePage(event: Event): boolean {
  const target = event.target;
  return target === null || target === document || target === window || target === document.body || target === document.documentElement;
}

/** Keys that are not a request: a modifier alone, Tab (it is the page's way round), Escape, and what the system sends while composing. */
const NOT_A_REQUEST = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn", "FnLock", "OS", "Hyper", "Super", "Tab", "Escape", "ContextMenu", "Dead", "Process", "Unidentified"]);

/** Whether a key press asks for something: a chord, an arrow, Delete, Enter, a function key. A plain character is typing. */
function asksForSomething(event: KeyboardEvent): boolean {
  if (event.isComposing || NOT_A_REQUEST.has(event.key)) return false;
  const chord = event.ctrlKey || event.metaKey || event.altKey;
  return chord || event.key.length !== 1;
}

/** The editor, when it is the one to take what fell on the page: it is shown, nothing else has the focus, no presentation or dialog is open, and the host agrees. */
function engaged(root: HTMLElement | null, isActive: () => boolean): HTMLElement | null {
  if (!root?.isConnected || root.closest("[inert]")) return null;
  if (!focusIsLost()) return null;
  if (document.querySelector(".ks-show-root, .ks-dialog")) return null;
  return isActive() ? root : null;
}

/**
 * Routes the keys and the clipboard events that fall on the page to this editor while `isActive()` says it is the one in use. Without
 * `isActive` nothing is listened for. The window is listened to once per editor and the answer is asked per event, so a host's
 * predicate (the focused pane, the active tab) is always current.
 */
export function useOrphanKeys(root: RefObject<HTMLElement | null>, context: CommandContext, isActive: (() => boolean) | undefined): void {
  const latest = useRef({ context, isActive });
  latest.current = { context, isActive };
  const listening = isActive !== undefined;

  useEffect(() => {
    if (!listening) return;
    const mine = (): HTMLElement | null => engaged(root.current, () => latest.current.isActive?.() === true);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || taken.has(event) || !fellOnThePage(event) || !asksForSomething(event)) return;
      const editor = mine();
      if (!editor) return;
      taken.add(event);
      // The key goes to the slide, as if it had had the focus: a command takes it; a key only the slide handles (an arrow) just gives it the focus.
      focusHome(editor);
      dispatchKey(event, latest.current.context, "stage");
    };

    // Chromium makes the clipboard events of a key only for something it could copy or paste into; saying so is what makes them come.
    const enabling = (kind: "copy" | "cut" | "paste") => (event: Event) => {
      if (event.defaultPrevented || taken.has(event) || !fellOnThePage(event)) return;
      const editor = mine();
      const home = homeOf(editor);
      if (!editor || !home) return;
      const { context: now } = latest.current;
      if (placeOf(home, now.ui) === "own") return;
      if (kind !== "paste" && !canCopyHere(now, now.session.state.selection)) return;
      event.preventDefault();
    };
    const clipboard = (kind: "copy" | "cut" | "paste") => (event: Event) => {
      if (event.defaultPrevented || taken.has(event) || !fellOnThePage(event)) return;
      const editor = mine();
      if (!editor || !focusHome(editor)) return;
      const home = homeOf(editor);
      if (!home) return;
      taken.add(event);
      const { context: now } = latest.current;
      // A page without a `ClipboardEvent` class (a test) makes a plain event with the data on it; the wrappers read only what both carry.
      if (kind === "paste") pasteNative(event as ClipboardEvent, now, home);
      else copyNative(event as ClipboardEvent, now, kind === "cut", home);
    };

    // A window that comes back with nothing focused gives the keys to the editor at once, so the first key is not the one that has to find it.
    const onWindowFocus = (): void => {
      const editor = mine();
      if (editor) focusHome(editor);
    };

    const listeners: [string, EventListener][] = [
      ["keydown", onKeyDown as EventListener],
      ["beforecopy", enabling("copy")],
      ["beforecut", enabling("cut")],
      ["beforepaste", enabling("paste")],
      ["copy", clipboard("copy")],
      ["cut", clipboard("cut")],
      ["paste", clipboard("paste")],
    ];
    for (const [type, listener] of listeners) window.addEventListener(type, listener);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [root, listening]);
}
