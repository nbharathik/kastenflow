// The outline strip: the page's sections as a filmstrip, to go to one and to
// put one somewhere else.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, useRef, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageEditorHandle } from "../editor/page-handle";
import type { SectionInfo } from "../editor/sections/api";
import { SectionStrip } from "./SectionStrip";

const info = (index: number, title: string): SectionInfo => ({ index, divider: index === 0 ? null : index * 10, from: index * 10 + 1, to: index * 10 + 5, blocks: 1, title, folded: false });

/** An editor that keeps its sections in a list and moves them as the real one does. */
function fakeEditor(titles: string[]) {
  let list = titles;
  const handle = {
    sections: () => list.map((title, i) => info(i, title)),
    showSection: vi.fn(() => true),
    moveSection: vi.fn((from: number, to: number) => {
      if (from === to || to < 0 || to >= list.length) return false;
      const next = [...list];
      next.splice(to, 0, ...next.splice(from, 1));
      list = next;
      return true;
    }),
  } as unknown as PageEditorHandle;
  const ref = createRef<PageEditorHandle | null>() as { current: PageEditorHandle | null };
  ref.current = handle;
  return { handle, ref: ref as RefObject<PageEditorHandle | null> };
}

const items = () => screen.getAllByRole("button").map((b) => b.textContent);

afterEach(cleanup);

/** Draws the strip with a body that changes when the page is saved, as it does. */
function Strip({ editor }: { editor: RefObject<PageEditorHandle | null> }) {
  const body = useRef("");
  return <SectionStrip editor={editor} body={body.current} ready={1} />;
}

describe("the sections strip", () => {
  it("lists the sections in order with their numbers", () => {
    const { ref } = fakeEditor(["Intro", "Plan", "Budget"]);
    render(<Strip editor={ref} />);
    expect(screen.getByRole("navigation", { name: "Sections of this page" })).toBeTruthy();
    expect(items()).toEqual(["1Intro", "2Plan", "3Budget"]);
  });

  it("goes to a section when it is clicked", () => {
    const { ref, handle } = fakeEditor(["Intro", "Plan", "Budget"]);
    render(<Strip editor={ref} />);
    fireEvent.click(screen.getByRole("button", { name: /Plan/ }));
    expect(handle.showSection).toHaveBeenCalledWith(1);
  });

  it("moves a section to where another is when it is dragged there, in either direction", () => {
    const { ref, handle } = fakeEditor(["Intro", "Plan", "Budget", "Thanks"]);
    render(<Strip editor={ref} />);
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => void data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    const button = (name: RegExp) => screen.getByRole("button", { name });
    fireEvent.dragStart(button(/Intro/), { dataTransfer });
    fireEvent.dragOver(button(/Budget/), { dataTransfer });
    // The line shows which side of Budget it lands on: after it, as it comes from above.
    expect(button(/Budget/).closest("li")!.className).toContain("is-after");
    expect(button(/Intro/).closest("li")!.className).toContain("is-dragged");
    fireEvent.drop(button(/Budget/), { dataTransfer });
    expect(handle.moveSection).toHaveBeenCalledWith(0, 2);
    expect(items()).toEqual(["1Plan", "2Budget", "3Intro", "4Thanks"]);
    expect(screen.getByRole("navigation").querySelector(".is-over, .is-dragged")).toBeNull();

    fireEvent.dragStart(button(/Thanks/), { dataTransfer });
    fireEvent.dragOver(button(/Plan/), { dataTransfer });
    expect(button(/Plan/).closest("li")!.className).toContain("is-before");
    fireEvent.drop(button(/Plan/), { dataTransfer });
    expect(handle.moveSection).toHaveBeenLastCalledWith(3, 0);
    expect(items()).toEqual(["1Thanks", "2Plan", "3Budget", "4Intro"]);
  });

  it("ignores something dragged in that is not one of its sections, and a drop on itself", () => {
    const { ref, handle } = fakeEditor(["Intro", "Plan"]);
    render(<Strip editor={ref} />);
    const dataTransfer = { setData: () => {}, getData: () => "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragOver(screen.getByRole("button", { name: /Plan/ }), { dataTransfer });
    fireEvent.drop(screen.getByRole("button", { name: /Plan/ }), { dataTransfer });
    fireEvent.dragStart(screen.getByRole("button", { name: /Plan/ }), { dataTransfer });
    fireEvent.drop(screen.getByRole("button", { name: /Plan/ }), { dataTransfer });
    expect(handle.moveSection).not.toHaveBeenCalled();
    expect(items()).toEqual(["1Intro", "2Plan"]);
  });

  it("moves a section with Alt and the arrows, keeping the focus on it, and moves between them with the arrows", () => {
    const { ref, handle } = fakeEditor(["Intro", "Plan", "Budget"]);
    render(<Strip editor={ref} />);
    const plan = screen.getByRole("button", { name: /Plan/ });
    plan.focus();
    fireEvent.keyDown(plan, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Budget/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });
    expect(handle.moveSection).toHaveBeenCalledWith(2, 1);
    expect(items()).toEqual(["1Intro", "2Budget", "3Plan"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Budget/ }));
    // Not past either end.
    act(() => void fireEvent.keyDown(screen.getByRole("button", { name: /Intro/ }), { key: "ArrowUp", altKey: true }));
    expect(items()).toEqual(["1Intro", "2Budget", "3Plan"]);
    expect(within(screen.getByRole("navigation")).getAllByRole("listitem")).toHaveLength(3);
  });
});
