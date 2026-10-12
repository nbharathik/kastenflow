import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { PANEL_WIDTH, Chrome, chromeOf } from "../chrome/chrome.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { PanelHost } from "./PanelHost.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup(panel: Parameters<EditorUi["openPanel"]>[0] = null) {
  const session = new EditorSession(await newDeck("Panels"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  if (panel) ui.openPanel(panel);
  render(<PanelHost session={session} ui={ui} />);
  return { session, ui };
}

const host = () => document.querySelector<HTMLElement>(".ks-panel-host");
const edge = () => screen.getByRole("separator", { name: "Resize the side panel" });

describe("where the side panel lives", () => {
  it("draws nothing while no panel is open, and the panel when one is", async () => {
    const { ui } = await setup();
    expect(host()).toBeNull();
    act(() => ui.openPanel("format"));
    expect(host()).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Side panel" })).toBeTruthy();
    act(() => ui.openPanel("steps"));
    expect(screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent).toBe("Steps");
    act(() => ui.openPanel(null));
    // Without motion to wait for, it goes at once.
    expect(host()).toBeNull();
  });

  it("is as wide as the person made it, at first the usual width", async () => {
    await setup("format");
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start}px`);
    expect(edge().getAttribute("aria-valuenow")).toBe(String(PANEL_WIDTH.start));
    expect(edge().getAttribute("aria-valuemin")).toBe(String(PANEL_WIDTH.min));
    expect(edge().getAttribute("aria-valuemax")).toBe(String(PANEL_WIDTH.max));
  });

  it("comes up at the width kept in this browser", async () => {
    new Chrome().setPanelWidth(444);
    await setup("format");
    expect(host()?.style.width).toBe("444px");
  });

  it("is made wider by dragging its edge to the left, and narrower to the right, and the width is kept when the pointer is let go", async () => {
    const { ui } = await setup("format");
    fireEvent.pointerDown(edge(), { clientX: 1000, button: 0, pointerId: 1 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 940 }));
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start + 60}px`);
    // The middle of a drag is not kept.
    expect(new Chrome().state.panelWidth).toBe(PANEL_WIDTH.start);
    fireEvent(window, new MouseEvent("pointermove", { clientX: 1040 }));
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start - 40}px`);
    fireEvent(window, new MouseEvent("pointerup", { clientX: 1040 }));
    expect(new Chrome().state.panelWidth).toBe(PANEL_WIDTH.start - 40);
    expect(chromeOf(ui).state.panelWidth).toBe(PANEL_WIDTH.start - 40);
    // A move after the pointer was let go changes nothing.
    fireEvent(window, new MouseEvent("pointermove", { clientX: 500 }));
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start - 40}px`);
  });

  it("stays between its least and most width however far it is dragged", async () => {
    await setup("format");
    fireEvent.pointerDown(edge(), { clientX: 1000, button: 0, pointerId: 1 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: -5000 }));
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.max}px`);
    fireEvent(window, new MouseEvent("pointermove", { clientX: 9000 }));
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.min}px`);
    fireEvent(window, new MouseEvent("pointerup", {}));
  });

  it("is moved with the arrow keys, Shift for big steps, Home and End for the most and least, and a double click for the usual", async () => {
    await setup("format");
    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start + 16}px`);
    fireEvent.keyDown(edge(), { key: "ArrowRight", shiftKey: true });
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start - 48}px`);
    fireEvent.keyDown(edge(), { key: "Home" });
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.max}px`);
    fireEvent.keyDown(edge(), { key: "End" });
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.min}px`);
    fireEvent.doubleClick(edge());
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start}px`);
    expect(new Chrome().state.panelWidth).toBe(PANEL_WIDTH.start);
  });

  it("keeps its width from one panel to the next", async () => {
    const { ui } = await setup("format");
    fireEvent.keyDown(edge(), { key: "ArrowLeft", shiftKey: true });
    act(() => ui.openPanel("themes"));
    expect(host()?.style.width).toBe(`${PANEL_WIDTH.start + 64}px`);
  });
});
