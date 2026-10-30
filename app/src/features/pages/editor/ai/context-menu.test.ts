// The right-click menu on selected text: Explain and Ask AI beside Copy and
// Cut, only for a click inside the selection.

import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { selectionMenu } from "./context-menu";

/** An editor that has `from`-`to` selected and puts any click at `pos`. */
function fakeView(from: number, to: number, pos: number | null) {
  const focus = vi.fn();
  const view = { state: { selection: { from, to, empty: from === to } }, posAtCoords: () => (pos === null ? null : { pos, inside: -1 }), focus, dom: document.body } as unknown as EditorView;
  return { view, focus };
}

const click = () => new MouseEvent("contextmenu", { clientX: 40, clientY: 60, cancelable: true, bubbles: true });
const items = () => [...document.querySelectorAll('.kasten-menu [role="menuitem"]')].map((row) => row.querySelector(".kasten-menu-label")?.textContent);

afterEach(() => {
  document.querySelectorAll(".kasten-menu").forEach((menu) => menu.remove());
});

describe("the menu on selected text", () => {
  it("shows Explain, Ask AI, Copy and Cut for a click inside the selection, and takes the system's menu's place", () => {
    const { view } = fakeView(3, 12, 7);
    const event = click();
    expect(selectionMenu(view, event, vi.fn())).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(items()).toEqual(["Explain", "Ask AI…", "Add to chat", "Copy", "Cut"]);
  });

  it("offers Add to chat, which keeps the selection with the chat", async () => {
    const add = vi.fn(() => true);
    vi.doMock("../../../chat/selection/add", () => ({ addSelectionToChat: add }));
    const { view } = fakeView(3, 12, 7);
    selectionMenu(view, click(), vi.fn());
    (document.querySelector('.kasten-menu [data-key="add-to-chat"]') as HTMLElement).click();
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    vi.doUnmock("../../../chat/selection/add");
  });

  it("leaves the system's menu for a click outside the selection, or with nothing selected", () => {
    for (const [view] of [fakeView(3, 12, 20), fakeView(3, 12, null), fakeView(5, 5, 5)].map((v) => [v.view] as const)) {
      const event = click();
      expect(selectionMenu(view, event, vi.fn())).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(items()).toEqual([]);
  });

  it("starts the AI action that was picked, and closes", () => {
    const { view } = fakeView(3, 12, 7);
    const open = vi.fn();
    selectionMenu(view, click(), open);
    (document.querySelector('.kasten-menu [data-key="explain"]') as HTMLElement).click();
    expect(open).toHaveBeenCalledWith("explain");
    expect(document.querySelector(".kasten-menu")).toBeNull();

    selectionMenu(view, click(), open);
    (document.querySelector('.kasten-menu [data-key="ask-ai"]') as HTMLElement).click();
    expect(open).toHaveBeenLastCalledWith("ask");
  });

  it("copies and cuts the selection through the editor, keeping its focus", () => {
    const { view, focus } = fakeView(3, 12, 7);
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    selectionMenu(view, click(), vi.fn());
    (document.querySelector('.kasten-menu [data-key="copy"]') as HTMLElement).click();
    expect(exec).toHaveBeenCalledWith("copy");
    selectionMenu(view, click(), vi.fn());
    (document.querySelector('.kasten-menu [data-key="cut"]') as HTMLElement).click();
    expect(exec).toHaveBeenLastCalledWith("cut");
    expect(focus).toHaveBeenCalledTimes(2);
  });
});
