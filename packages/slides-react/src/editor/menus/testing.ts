// Helpers for the tests of the top of the editor (title bar, menus, toolbar):
// a real deck in a real session, and a stand-in for the open text box.

import { act, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { PLAIN_FORMAT } from "../../text/handle.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import type { FormatState } from "../session/text-commands.ts";
import type { TextHandle } from "../text-handle.ts";
import { EditorUi } from "../ui-state.ts";

/** A deck with one title slide, in a session that saves to memory. */
export async function openEditor(theme = "Light") {
  const host = new MemoryHost();
  const session = new EditorSession(await newDeck("Talk", theme), host, { saveDelay: 10_000 });
  const ui = new EditorUi();
  return { session, ui, host };
}

/** How text looks when nothing is set. */
export const PLAIN: FormatState = PLAIN_FORMAT;

/** A text box being edited, as far as the commands can tell: every action is a spy. */
export function fakeTextBox(format: Partial<FormatState> = {}): TextHandle & { current: FormatState } {
  const box = {
    current: { ...PLAIN, ...format },
    focus: vi.fn(),
    getText: vi.fn(),
    selectAll: vi.fn(),
    formatState: () => box.current,
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    toggleUnderline: vi.fn(),
    toggleStrike: vi.fn(),
    toggleCode: vi.fn(),
    setColor: vi.fn(),
    setSize: vi.fn(),
    stepSize: vi.fn(),
    setFont: vi.fn(),
    setAlign: vi.fn(),
    toggleList: vi.fn(),
    indent: vi.fn(),
    setLineSpacing: vi.fn(),
    setLink: vi.fn(),
    clearFormatting: vi.fn(),
    insertText: vi.fn(),
  };
  return box as unknown as TextHandle & { current: FormatState };
}

/** Lets a frame go by: a menu takes the focus in the frame after it opens, when it is shown. */
export const nextFrame = () =>
  act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

/** A click with the mouse. A click made by the keyboard has a detail of 0, and opens menus for the keyboard. */
export const click = (element: HTMLElement) => fireEvent.click(element, { detail: 1 });

/** A button by its name. */
export const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** A title of the menu bar. */
export const bar = (name: string) => screen.getByRole("menuitem", { name });

/** The popover of the open menu with this name. */
export const menuOf = (name: string) => screen.getByRole("dialog", { name });

export const isDisabled = (element: HTMLElement) => (element as HTMLButtonElement).disabled;

/** The one row of an open menu with this name. */
export function row(name: string | RegExp): HTMLElement {
  const found = [...screen.queryAllByRole("menuitem", { name }), ...screen.queryAllByRole("menuitemcheckbox", { name })].filter((el) => el.closest("[role=menu]"));
  if (found.length !== 1) throw new Error(`Expected one row called ${String(name)} in an open menu, found ${found.length}: ${found.map((f) => f.textContent).join(" | ")}`);
  return found[0]!;
}
