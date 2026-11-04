// @vitest-environment jsdom
// The Slideshow button and its options: the host's actions arrive after the first draw, and the displays are asked for once per opening.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import type { PresentScreens } from "../host.ts";
import { MemoryHost } from "../memory-host.ts";
import { click } from "../menus/testing.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { TitleBar } from "./TitleBar.tsx";

afterEach(cleanup);

class ScreenHost extends MemoryHost {
  constructor(readonly screens: PresentScreens) {
    super();
  }
}

const slideshow = () => screen.getByRole("button", { name: "Slideshow" }) as HTMLButtonElement;

async function setup(host: MemoryHost) {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 10_000 });
  const ui = new EditorUi();
  render(<TitleBar session={session} ui={ui} />);
  return { ui };
}

describe("the title bar and the host's actions", () => {
  it("follow the actions the host gives after the first draw, with no second draw forced", async () => {
    const { ui } = await setup(new MemoryHost());
    expect(slideshow().disabled).toBe(true);
    act(() => void (ui.actions = { present: vi.fn() }));
    expect(slideshow().disabled).toBe(false);
  });
});

describe("Present on", () => {
  it("asks the host for the displays once per opening, and shows the row when they arrive", async () => {
    const screens: PresentScreens = {
      displays: vi.fn(async () => ["Built-in", "Projector"]),
      list: vi.fn(async () => [
        { label: "Built-in", primary: true, current: true },
        { label: "Projector", primary: false, current: false },
      ]),
      chosen: () => "auto",
      choose: vi.fn(),
    };
    const { ui } = await setup(new ScreenHost(screens));
    act(() => void (ui.actions = { present: vi.fn() }));
    expect(screens.list).not.toHaveBeenCalled();

    click(screen.getByRole("button", { name: "Slideshow options" }));
    await act(async () => {});
    expect(screens.list).toHaveBeenCalledTimes(1);
    expect(screens.displays).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Present on" })).toBeTruthy();

    // Closed and opened again: asked again, once more, as a display may have been plugged in.
    click(screen.getByRole("button", { name: "Slideshow options" }));
    click(screen.getByRole("button", { name: "Slideshow options" }));
    await act(async () => {});
    expect(screens.list).toHaveBeenCalledTimes(2);
  });

  it("asks for the names alone from a host that cannot describe its displays", async () => {
    const screens: PresentScreens = { displays: vi.fn(async () => ["A", "B"]), chosen: () => "auto", choose: vi.fn() };
    const { ui } = await setup(new ScreenHost(screens));
    act(() => void (ui.actions = { present: vi.fn() }));
    click(screen.getByRole("button", { name: "Slideshow options" }));
    await act(async () => {});
    expect(screens.displays).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menuitem", { name: "Present on" })).toBeTruthy();
  });
});
