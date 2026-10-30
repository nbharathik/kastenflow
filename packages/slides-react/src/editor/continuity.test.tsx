// A deck put away and brought back: the host keeps the editor's window state (`onUiChange`) and hands it back (`initialUi`), and the
// assistant's status shows on the Assistant button while the panel is closed.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { newDeck } from "../test/engine.ts";
import { installAuditEnvironment } from "./focus/audit-kit.tsx";
import type { AiPanelProps, AiStatus, AiStatusSource } from "./host.ts";
import { MemoryHost } from "./memory-host.ts";
import { EditorSession } from "./session/session.ts";
import { SlidesEditor } from "./SlidesEditor.tsx";
import { TitleBar } from "./titlebar/TitleBar.tsx";
import { applySnapshot, readSnapshot, snapshotOf, type UiSnapshot } from "./ui-snapshot.ts";
import { EditorUi } from "./ui-state.ts";

beforeAll(installAuditEnvironment);
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

async function threeSlides(): Promise<string> {
  const engine = await newDeck("Talk");
  engine.apply("add_slide", { layout: "title-body", content: { title: "Two", body: "Point" } });
  engine.apply("add_slide", { layout: "title-body", content: { title: "Three", body: "Point" } });
  return engine.save();
}

/** What a host says about its assistant, and the way to change it. */
class Status implements AiStatusSource {
  private now: AiStatus = "idle";
  private readonly listeners = new Set<() => void>();
  current = (): AiStatus => this.now;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  set(next: AiStatus): void {
    this.now = next;
    for (const listener of [...this.listeners]) listener();
  }
}

describe("the window state a host keeps", () => {
  it("takes the panel, the slides, the picks and the filmstrip back as they were", async () => {
    const text = await threeSlides();
    const first = new EditorSession((await import("@kasten-slides/wasm")).DeckEngine.open(text), new MemoryHost());
    const ui = new EditorUi();
    const second = first.deck.slides[1]!.id;
    ui.openPanel("ai");
    ui.setView("outline");
    first.goTo(second);
    ui.remember({ filmstripWidth: 260, filmstripScroll: 48 });
    const snapshot = snapshotOf(first, ui);
    expect(snapshot).toMatchObject({ panel: "ai", view: "outline", slideId: second, filmstripWidth: 260, filmstripScroll: 48, filmstripOpen: true });

    const again = new EditorSession((await import("@kasten-slides/wasm")).DeckEngine.open(text), new MemoryHost());
    const fresh = new EditorUi();
    applySnapshot(again, fresh, JSON.parse(JSON.stringify(snapshot)));
    expect(fresh.state.panel).toBe("ai");
    expect(fresh.state.view).toBe("outline");
    expect(again.state.slideId).toBe(second);
    expect(fresh.memory).toEqual({ filmstripWidth: 260, filmstripScroll: 48 });
  });

  it("restores the picked slides and the selected elements, and skips what the deck no longer has", async () => {
    const text = await threeSlides();
    const { DeckEngine } = await import("@kasten-slides/wasm");
    const session = new EditorSession(DeckEngine.open(text), new MemoryHost());
    const ids = session.deck.slides.map((s) => s.id);
    applySnapshot(session, new EditorUi(), { slideId: ids[2], slideSelection: [ids[1], ids[2]], selection: [] });
    expect(session.state.slideSelection).toEqual([ids[1], ids[2]]);
    expect(session.state.slideId).toBe(ids[2]);
    // A slide that was deleted while the deck was away leaves the editor where it opens; an unknown panel is ignored.
    const other = new EditorSession(DeckEngine.open(text), new MemoryHost());
    applySnapshot(other, new EditorUi(), { slideId: "gone", panel: "nonsense", selection: ["nothing"], filmstripWidth: "wide" });
    expect(other.state.slideId).toBe(ids[0]);
    expect(readSnapshot({ panel: "nonsense", filmstripScroll: -4, view: "edit" })).toEqual({ view: "edit", slideSelection: [], selection: [] });
  });

  it("tells the host of each change, once, and not at all while nothing changes", async () => {
    const text = await threeSlides();
    const seen: UiSnapshot[] = [];
    let session: EditorSession | null = null;
    let ui: EditorUi | null = null;
    const view = render(
      <SlidesEditor
        text={text}
        host={new MemoryHost()}
        onSession={(s, u) => {
          session = s;
          ui = u;
        }}
        onUiChange={(snapshot) => seen.push(snapshot)}
      />,
    );
    await waitFor(() => expect(view.container.querySelector(".ks-stage")).not.toBeNull());
    // The editor starts telling the host in an effect after the stage is drawn: let that run first,
    // or a quick change is taken as how the window began.
    await act(async () => {});
    expect(seen).toHaveLength(0);
    act(() => ui!.openPanel("themes"));
    expect(seen.at(-1)?.panel).toBe("themes");
    const count = seen.length;
    act(() => ui!.openPanel("themes"));
    expect(seen).toHaveLength(count);
    act(() => session!.goBy(1));
    expect(seen.at(-1)?.slideId).toBe(session!.deck.slides[1]!.id);
    act(() => ui!.remember({ filmstripScroll: 90 }));
    expect(seen.at(-1)?.filmstripScroll).toBe(90);
  });

  it("opens an editor again on the state the host kept, as after a tab was put away", async () => {
    const text = await threeSlides();
    const kept: { current: UiSnapshot | undefined } = { current: undefined };
    let session: EditorSession | null = null;
    let ui: EditorUi | null = null;
    const first = render(
      <SlidesEditor
        text={text}
        host={new MemoryHost()}
        onSession={(s, u) => {
          session = s;
          ui = u;
        }}
        onUiChange={(snapshot) => (kept.current = snapshot)}
      />,
    );
    await waitFor(() => expect(first.container.querySelector(".ks-stage")).not.toBeNull());
    await act(async () => {});
    act(() => {
      ui!.openPanel("ai");
      session!.goBy(2);
    });
    const third = session!.deck.slides[2]!.id;
    first.unmount();
    expect(kept.current).toMatchObject({ panel: "ai", slideId: third });

    let again: EditorSession | null = null;
    render(
      <SlidesEditor
        text={text}
        host={new MemoryHost()}
        initialUi={kept.current}
        onSession={(s) => {
          if (s) again = s;
        }}
      />,
    );
    await waitFor(() => expect(again).not.toBeNull());
    expect(again!.state.slideId).toBe(third);
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assistant" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the filmstrip as wide as it was made, per deck", async () => {
    const text = await threeSlides();
    let ui: EditorUi | null = null;
    const view = render(<SlidesEditor text={text} host={new MemoryHost()} initialUi={{ filmstripWidth: 280 }} onSession={(_, u) => (ui = u)} />);
    await waitFor(() => expect(view.container.querySelector(".ks-filmstrip-wrap")).not.toBeNull());
    expect(view.container.querySelector<HTMLElement>(".ks-filmstrip-wrap")!.style.getPropertyValue("--ks-filmstrip-w")).toBe("280px");
    fireEvent.keyDown(view.container.querySelector(".ks-filmstrip-grip")!, { key: "ArrowRight" });
    expect(ui!.memory.filmstripWidth).toBe(296);
  });
});

describe("what the assistant is doing, on its button", () => {
  async function setup() {
    const host = new MemoryHost();
    const status = new Status();
    host.aiStatus = status;
    const session = new EditorSession((await import("@kasten-slides/wasm")).DeckEngine.open(await threeSlides()), host);
    render(<TitleBar session={session} ui={new EditorUi()} />);
    return { status, host, session };
  }
  const dot = () => document.querySelector<HTMLElement>(".ks-btn-dot");

  it("is plain at rest", async () => {
    await setup();
    expect(screen.getByRole("button", { name: "Assistant" })).toBeTruthy();
    expect(dot()).toBeNull();
  });

  it("shows a pulsing dot while it works, and says so in the name", async () => {
    const { status } = await setup();
    act(() => status.set("working"));
    expect(screen.getByRole("button", { name: "Assistant, working" })).toBeTruthy();
    expect(dot()!.dataset.status).toBe("working");
    expect(dot()!.getAttribute("aria-hidden")).toBe("true");
    act(() => status.set("paused"));
    expect(screen.getByRole("button", { name: "Assistant, paused" })).toBeTruthy();
    expect(dot()!.dataset.status).toBe("paused");
    act(() => status.set("failed"));
    expect(screen.getByRole("button", { name: "Assistant, last request failed" })).toBeTruthy();
    act(() => status.set("idle"));
    expect(dot()).toBeNull();
  });

  it("does not animate where the motion setting is off", async () => {
    const css = (await import("./titlebar/titlebar.css?raw")).default;
    expect(css).toMatch(/:root\[data-motion="off"\] \.ks-btn-dot\s*\{\s*animation: none/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root:not\(\[data-motion="on"\]\) \.ks-btn-dot\s*\{\s*animation: none/);
  });

  it("is given to the host's panel as its status", async () => {
    const { status, host } = await setup();
    const { AiPanel } = await import("./panels/ai/AiPanel.tsx");
    const seen = vi.fn();
    host.aiPanel = (props: AiPanelProps) => {
      seen(props.status);
      return <p>panel</p>;
    };
    const session = new EditorSession((await import("@kasten-slides/wasm")).DeckEngine.open(await threeSlides()), host);
    render(<AiPanel session={session} ui={new EditorUi()} />);
    expect(seen).toHaveBeenLastCalledWith("idle");
    act(() => status.set("working"));
    expect(seen).toHaveBeenLastCalledWith("working");
  });
});
