// How often the parts of the window that do not show the slide are drawn while the slide is worked on, on a deck of 60 slides:
// typing 20 characters, dragging an element 20 steps and zooming with 10 wheel ticks. Each part is mounted under a Profiler, which
// counts its commits. `Legacy` is a stand-in that follows the editor and the window state the way the menu bar, the context menus
// and the format panel did before they followed only what they show: it is drawn once for every change, which is the number to beat.

import { act, cleanup, render } from "@testing-library/react";
import { Profiler, type JSX } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { newDeck } from "../test/engine.ts";
import { plainText, textBox } from "./factory.ts";
import { MemoryHost } from "./memory-host.ts";
import { ContextMenus } from "./menus/ContextMenus.tsx";
import { MenuBar } from "./menus/MenuBar.tsx";
import { FormatPanel } from "./panels/format/FormatPanel.tsx";
import { EditorSession } from "./session/session.ts";
import { TitleBar } from "./titlebar/TitleBar.tsx";
import { EditorUi } from "./ui-state.ts";
import { useEditor } from "./useEditor.ts";
import { useUiState } from "./useUi.ts";

const SLIDES = 60;
const STEPS = 20;
const TICKS = 10;

afterEach(cleanup);

function Legacy({ session, ui }: { session: EditorSession; ui: EditorUi }): null {
  useEditor(session);
  useUiState(ui);
  return null;
}

type Counts = Record<"MenuBar" | "ContextMenus" | "FormatPanel" | "TitleBar" | "Legacy", number>;

async function mount() {
  const engine = await newDeck("Sixty");
  for (let i = 1; i < SLIDES; i++) engine.apply("add_slide", { layout: "title-body", content: { title: `Slide ${i + 1}`, body: `- a point on slide ${i + 1}\n- and another one` } });
  const session = new EditorSession(engine, new MemoryHost(), { saveDelay: 600_000 });
  const ui = new EditorUi();
  const [id] = session.elements.insert([textBox({ x: 40, y: 40, w: 400, h: 80 }, "")]);
  const counts: Counts = { MenuBar: 0, ContextMenus: 0, FormatPanel: 0, TitleBar: 0, Legacy: 0 };
  const watch = (name: keyof Counts, part: JSX.Element) => (
    <Profiler id={name} onRender={() => void (counts[name] += 1)}>
      {part}
    </Profiler>
  );
  render(
    <>
      {watch("MenuBar", <MenuBar session={session} ui={ui} />)}
      {watch("ContextMenus", <ContextMenus session={session} ui={ui} />)}
      {watch("FormatPanel", <FormatPanel session={session} ui={ui} />)}
      {watch("TitleBar", <TitleBar session={session} ui={ui} />)}
      {watch("Legacy", <Legacy session={session} ui={ui} />)}
    </>,
  );
  expect(session.deck.slides).toHaveLength(SLIDES);
  const idle = () => {
    for (const key of Object.keys(counts) as (keyof Counts)[]) counts[key] = 0;
  };
  idle();
  return { session, ui, id: id!, counts, idle };
}

const report = (flow: string, counts: Counts) => console.info(`commits, ${flow}, ${SLIDES} slides: ${JSON.stringify(counts)}`);

describe("how often the window around the slide is drawn, on a deck of 60 slides", () => {
  it("types 20 characters", async () => {
    const { session, id, counts } = await mount();
    for (let i = 1; i <= STEPS; i++) act(() => session.elements.setText(id, plainText("x".repeat(i)), session.state.slideId, i > 1));
    report("type 20 characters", counts);
    expect(counts.Legacy).toBeGreaterThanOrEqual(STEPS);
    expect(counts.MenuBar).toBe(0);
    expect(counts.ContextMenus).toBe(0);
    expect(counts.FormatPanel).toBeLessThanOrEqual(STEPS + 1);
    expect(counts.TitleBar).toBeLessThanOrEqual(3);
  });

  it("drags an element 20 steps", async () => {
    const { session, id, counts } = await mount();
    for (let i = 1; i <= STEPS; i++) act(() => session.elements.transform([{ id, x: 40 + i * 6, y: 40 + i * 3 }], i > 1));
    report("drag 20 steps", counts);
    expect(counts.Legacy).toBeGreaterThanOrEqual(STEPS);
    expect(counts.MenuBar).toBe(0);
    expect(counts.ContextMenus).toBe(0);
    // The panel and the position and size fields it holds are each drawn once for a step.
    expect(counts.FormatPanel).toBeLessThanOrEqual(2 * STEPS + 1);
    expect(counts.TitleBar).toBeLessThanOrEqual(3);
  });

  it("zooms with 10 wheel ticks", async () => {
    const { ui, counts } = await mount();
    for (let i = 1; i <= TICKS; i++) act(() => ui.setZoom(1 + i / 10));
    report("zoom 10 wheel ticks", counts);
    expect(counts.Legacy).toBeGreaterThanOrEqual(TICKS);
    expect(counts.MenuBar).toBe(0);
    expect(counts.ContextMenus).toBe(0);
    expect(counts.FormatPanel).toBe(0);
    expect(counts.TitleBar).toBe(0);
  });

  it("follows the editor while a context menu is open, and not after it is closed", async () => {
    const { session, ui, id, counts } = await mount();
    act(() => ui.openContextMenu({ kind: "element", x: 100, y: 100 }));
    const open = counts.ContextMenus;
    expect(open).toBeGreaterThan(0);
    act(() => session.elements.nudge(5, 5, [id]));
    expect(counts.ContextMenus).toBeGreaterThan(open);
    act(() => ui.openContextMenu(null));
    const closed = counts.ContextMenus;
    act(() => session.elements.nudge(5, 5, [id]));
    expect(counts.ContextMenus).toBe(closed);
  });
});
