// A page being presented: its progress, the presenter's keys, a click on the
// slide, the screen, and giving the page back where it was.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { presentingIn, setPresenting } from "../editor/sections/presenting";
import { registerSections, type SlideStep } from "../editor/sections/registry";
import { PagePresenter } from "./PagePresenter";

const screen_ = vi.hoisted(() => ({ left: null as (() => void) | null, gaveBack: 0, taken: 0 }));
vi.mock("../../../lib/fullscreen", () => ({
  fillScreen: async (onLeft: () => void) => {
    screen_.left = onLeft;
    screen_.taken++;
    return () => void screen_.gaveBack++;
  },
}));

const steps: SlideStep[] = [];
let stopped = 0;
let forget: () => void;
let pane: HTMLDivElement;

/** The presenter inside a page frame, with an editor of its own that records what it is asked. */
function frame() {
  const root = createRef<HTMLDivElement>();
  const view = render(
    <div ref={root} className="kasten-page is-presenting" data-testid="frame">
      <div className="kasten-page-main" data-testid="main">
        <div data-testid="editor">
          <p>The slide</p>
          <a href="https://example.com" onClick={(event) => event.preventDefault()}>
            a link
          </a>
          <div className="kasten-deck-embed">
            <span>a live block</span>
          </div>
        </div>
      </div>
      <PagePresenter root={root} scroller={() => pane} />
    </div>,
  );
  const dom = screen.getByTestId("editor");
  const unregister = registerSections({ dom, page: () => "any-key", foldAll: () => 0, present: () => 5, step: (to) => void steps.push(to), stop: () => void stopped++, texts: () => [] });
  forget = unregister;
  return { ...view, root, dom };
}

/** The editor of the page in the frame presents. */
const present = (index: number, count = 5) => act(() => setPresenting(screen.getByTestId("editor"), { index, count, title: `Slide ${index + 1}`, dom: screen.getByTestId("editor") }));
const key = (name: string, init: KeyboardEventInit = {}, target: Element = document.body) => fireEvent.keyDown(target, { key: name, ...init });

beforeEach(() => {
  steps.length = 0;
  stopped = 0;
  screen_.left = null;
  screen_.gaveBack = 0;
  screen_.taken = 0;
  pane = document.createElement("div");
  forget = () => {};
});

afterEach(() => {
  const editor = document.querySelector<HTMLElement>("[data-testid=editor]");
  if (editor) act(() => setPresenting(editor, null));
  cleanup();
  forget();
  vi.useRealTimers();
});

describe("a page being presented", () => {
  it("shows nothing until it is presented, then where it is in the talk", () => {
    frame();
    expect(screen.queryByRole("toolbar", { name: "Presentation" })).toBeNull();
    present(2);
    const bar = screen.getByRole("toolbar", { name: "Presentation" });
    expect(bar.textContent).toContain("3 / 5");
    present(4);
    expect(screen.getByRole("toolbar", { name: "Presentation" }).textContent).toContain("5 / 5");
  });

  it("goes on and back with the presenter's keys, and ends with Esc", () => {
    frame();
    present(1);
    for (const [name, init] of [["ArrowRight"], [" "], ["n"], ["PageDown"], ["Enter"]] as [string, KeyboardEventInit?][]) key(name, init);
    key("ArrowLeft");
    key(" ", { shiftKey: true });
    key("p");
    key("Home");
    key("End");
    expect(steps).toEqual(["next", "next", "next", "next", "next", "previous", "previous", "previous", "first", "last"]);
    expect(stopped).toBe(0);
    key("Escape");
    expect(stopped).toBe(1);
  });

  it("leaves other keys, chords and typing to the app", () => {
    frame();
    present(1);
    key("a");
    key("ArrowRight", { ctrlKey: true });
    key("k", { metaKey: true });
    const field = document.body.appendChild(document.createElement("input"));
    key("n", {}, field);
    key("Escape", {}, field);
    field.remove();
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    key("ArrowRight", {}, dialog);
    dialog.remove();
    expect(steps).toEqual([]);
    expect(stopped).toBe(0);
  });

  it("does not read keys when it is not being presented", () => {
    frame();
    key("ArrowRight");
    key("Escape");
    expect(steps).toEqual([]);
    expect(stopped).toBe(0);
  });

  it("goes on with a click on the slide and back with Shift, but not from a link, a button or a live block", () => {
    const { getByTestId } = frame();
    present(1);
    fireEvent.click(screen.getByText("The slide"));
    fireEvent.click(getByTestId("main"), { shiftKey: true });
    fireEvent.click(screen.getByText("a link"));
    fireEvent.click(screen.getByText("a live block"));
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    fireEvent.click(getByTestId("frame"), { button: 2 });
    // Two clicks on the slide went to the keys' steps; the buttons step themselves.
    expect(steps).toEqual(["next", "previous", "previous"]);
  });

  it("moves with its buttons, which stop at either end, and ends from them", () => {
    frame();
    present(0);
    expect((screen.getByRole("button", { name: "Previous slide" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    present(4);
    expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "End the presentation" }));
    expect(steps).toEqual(["next"]);
    expect(stopped).toBe(1);
    // Space on a button presses it, and it does not also go on.
    fireEvent.keyDown(screen.getByRole("button", { name: "Next slide" }), { key: " " });
    expect(steps).toEqual(["next"]);
  });

  it("takes the screen when it starts and gives it back when it ends; leaving the screen ends it", async () => {
    frame();
    present(0);
    await act(async () => void (await Promise.resolve()));
    expect(screen_.taken).toBe(1);
    // The person leaves full screen another way (Esc in a browser).
    screen_.left?.();
    expect(stopped).toBe(1);
    act(() => setPresenting(screen.getByTestId("editor"), null));
    expect(screen_.gaveBack).toBe(1);
  });

  it("gives the page back where it was scrolled to, and starts each slide at its top", () => {
    frame();
    pane.scrollTop = 140;
    present(0);
    pane.scrollTop = 60;
    present(1);
    expect(pane.scrollTop).toBe(0);
    act(() => setPresenting(screen.getByTestId("editor"), null));
    expect(pane.scrollTop).toBe(140);
  });

  it("shows its progress for a moment after a slide, and again when the pointer moves", () => {
    vi.useFakeTimers();
    frame();
    present(0);
    const bar = () => screen.getByRole("toolbar", { name: "Presentation" });
    expect(bar().classList.contains("is-shown")).toBe(true);
    act(() => void vi.advanceTimersByTime(2000));
    expect(bar().classList.contains("is-shown")).toBe(false);
    fireEvent.mouseMove(bar());
    expect(bar().classList.contains("is-shown")).toBe(true);
    present(1);
    act(() => void vi.advanceTimersByTime(1000));
    expect(bar().classList.contains("is-shown")).toBe(true);
  });

  it("is not moved by the presentation of the same page in another frame", () => {
    frame();
    // Presented by an editor this frame does not hold: this page's frame stays as it was.
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    act(() => setPresenting(elsewhere, { index: 0, count: 3, title: "Elsewhere", dom: elsewhere }));
    expect(screen.queryByRole("toolbar", { name: "Presentation" })).toBeNull();
    expect(presentingIn(screen.getByTestId("frame"))).toBeNull();
    act(() => setPresenting(elsewhere, null));
    elsewhere.remove();
  });
});
