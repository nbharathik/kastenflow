// The popups that sit over a browser tab's page say so (one hook call each), so the page steps aside.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotePick } from "../chat/view/AddContext";
import { Picker } from "../library/Picker";
import { Popup } from "../pages/page/Popup";
import { Floating } from "../tags/views/table/Floating";
import { covered, useOcclusion } from "./occlusion";

// The chat's store is picked from only when a row is chosen, and none is here.
vi.mock("../chat/store", () => ({ useChat: { getState: () => ({}) } }));

const AREA = { left: 200, top: 100, right: 800, bottom: 600 };
const POPUPS = ["kasten-popup", "kasten-table-pop", "kasten-chat-menu"];
const held = () => covered(useOcclusion.getState().holds, AREA);
const none = { current: document.body };

beforeEach(() => {
  useOcclusion.setState({ holds: {}, areas: {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // Popups take a place over the browser's area; nothing else has a size.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const popup = POPUPS.some((name) => this.classList.contains(name)) || this.getAttribute("aria-label") === "Add a board";
    const box = popup ? { left: 300, top: 150, right: 500, bottom: 350 } : { left: 0, top: 0, right: 0, bottom: 0 };
    return { ...box, width: box.right - box.left, height: box.bottom - box.top, x: box.left, y: box.top, toJSON: () => ({}) };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("popups over a browser tab's page", () => {
  it("a page editor's popup covers its area while it is open", () => {
    const view = render(
      <Popup label="Link" onClose={() => {}}>
        <input aria-label="Address" />
      </Popup>,
    );
    expect(held()).toBe(true);
    view.unmount();
    expect(held()).toBe(false);
  });

  it("a tag table's menu or picker covers its area while it is open", () => {
    const view = render(
      <Floating anchor={{ current: document.createElement("button") }} label="Options" onClose={() => {}}>
        <p>Choices</p>
      </Floating>,
    );
    expect(held()).toBe(true);
    view.unmount();
    expect(held()).toBe(false);
  });

  it("the chat's context pickers cover their area while they are open", () => {
    const page = render(<NotePick notes={[]} within={none} onClose={() => {}} onPick={() => {}} />);
    expect(held()).toBe(true);
    page.unmount();
    expect(held()).toBe(false);
    const list = render(<Picker label="Add a board" placeholder="Find a board…" options={[]} within={none} onPick={() => {}} onClose={() => {}} />);
    expect(held()).toBe(true);
    list.unmount();
    expect(held()).toBe(false);
  });
});
