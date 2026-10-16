// What the focus audit shares: a workspace on a deck with a block on it, the four keys that must work wherever the focus is, and the
// kinds of opener that go away.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { KASTEN_TYPE } from "../clipboard/format.ts";
import { shape, textBox } from "../factory.ts";
import { openDeck } from "../filmstrip/test-support.ts";
import { Workspace } from "../SlidesEditor.tsx";
import { describeNode, expectFocusIn } from "./testing.ts";

/** What jsdom lacks and the editor's dialogs and slide ask for. */
export function installAuditEnvironment(): void {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
  // The find dialog watches its area's size; jsdom has no layout to watch.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

/** What a clipboard event carries: types by name. */
export function transfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getData: (type: string) => data.get(type) ?? "", setData: (type: string, value: string) => void data.set(type, value), files: [] as File[], data };
}

/** A deck of three slides with a block and a text box on the first, in a workspace. `route` is the host's say-so for keys that fall on the page. */
export async function audit(options: { route?: boolean; autoFocus?: boolean } = {}) {
  const made = await openDeck({ slides: 3 });
  const [a, label] = made.session.elements.insert([shape("rect", { x: 700, y: 400, w: 100, h: 100 }), textBox({ x: 200, y: 200, w: 300, h: 60 }, "Words")]) as [string, string];
  const view = render(<Workspace session={made.session} ui={made.ui} routeOrphanKeys={options.route ? () => true : undefined} autoFocus={options.autoFocus} />);
  const root = view.container.querySelector<HTMLElement>(".ks-editor")!;
  const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!;
  return { ...made, ...view, a, label, root, q, stage: () => q(".ks-stage"), list: () => screen.getByRole("listbox", { name: "Slides" }) };
}
export type Audit = Awaited<ReturnType<typeof audit>>;

/** A key press where the focus is now (on the page when nothing has it). */
export const key = (init: KeyboardEventInit) => fireEvent.keyDown(document.activeElement ?? document.body, init);

/**
 * The four keys that matter act wherever the focus is now: Delete removes what is selected (a block, or the slides when the focus is
 * in the filmstrip), Ctrl+Z brings it back, Ctrl+C puts it on the clipboard event and Ctrl+V pastes it. The focus is in the editor after the first.
 */
export function keysAct({ session, root, a }: Pick<Audit, "session" | "root" | "a">): void {
  const snapshot = () => `${session.deck.slides.length}/${session.slide.elements.length}`;
  const start = snapshot();
  const where = () => `with the focus on ${describeNode(document.activeElement)}`;
  act(() => session.select([a]));
  key({ key: "Delete", code: "Delete" });
  expect(snapshot() !== start, `Delete ${where()}`).toBe(true);
  expectFocusIn(root);
  key({ key: "z", code: "KeyZ", ctrlKey: true });
  expect(snapshot() === start, `Ctrl+Z ${where()}`).toBe(true);
  act(() => session.select([a]));
  const data = transfer();
  fireEvent.copy(document.activeElement ?? document.body, { clipboardData: data });
  expect(data.data.has(KASTEN_TYPE), `Ctrl+C ${where()}`).toBe(true);
  fireEvent.paste(document.activeElement ?? document.body, { clipboardData: data });
  expect(snapshot() !== start, `Ctrl+V ${where()}`).toBe(true);
  expectFocusIn(root);
}

/** An opener inside the editor that has the focus and then goes (a menu row, a button that went with its menu). */
export function openerThatGoes(root: HTMLElement): { element: HTMLElement; drop(): void } {
  const opener = document.createElement("button");
  root.append(opener);
  opener.focus();
  return { element: opener, drop: () => opener.remove() };
}
