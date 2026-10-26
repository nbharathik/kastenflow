import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktop: true,
  invoke: vi.fn(),
  plain: vi.fn(),
  back: vi.fn(),
  scale: [] as (() => void)[],
  stopScale: vi.fn(),
  fullscreen: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setFullscreen: mocks.fullscreen,
    onScaleChanged: (run: () => void) => {
      mocks.scale.push(run);
      return Promise.resolve(mocks.stopScale);
    },
  }),
}));
vi.mock("./api", () => ({ inTauri: () => mocks.desktop }));
vi.mock("./fullscreen", () => ({
  fillScreen: async (onLeft: () => void) => {
    mocks.plain(onLeft);
    return mocks.back;
  },
}));

import { PRESENT_ON_KEY, fillShowScreen, presentScreens, readPresentOn, writePresentOn } from "./present-screen";

beforeEach(() => {
  localStorage.clear();
  mocks.desktop = true;
  mocks.scale.length = 0;
  for (const mock of [mocks.invoke, mocks.plain, mocks.back, mocks.stopScale, mocks.fullscreen]) mock.mockClear();
  mocks.invoke.mockResolvedValue(undefined);
});

describe("Present on", () => {
  it("is automatic until a choice is made, and the choice is kept for this computer", () => {
    expect(readPresentOn()).toBe("auto");
    writePresentOn("here");
    expect(localStorage.getItem(PRESENT_ON_KEY)).toBe("here");
    expect(readPresentOn()).toBe("here");
    writePresentOn("name:DELL U2720Q");
    expect(readPresentOn()).toBe("name:DELL U2720Q");
    expect(presentScreens.chosen()).toBe("name:DELL U2720Q");
  });

  it("ignores a stored value that is not a choice", () => {
    localStorage.setItem(PRESENT_ON_KEY, "everywhere");
    expect(readPresentOn()).toBe("auto");
    localStorage.setItem(PRESENT_ON_KEY, "name:");
    expect(readPresentOn()).toBe("auto");
  });

  it("is chosen through the host's screens", () => {
    presentScreens.choose("here");
    expect(readPresentOn()).toBe("here");
  });

  it("lists the displays the app knows, and none when it cannot say", async () => {
    mocks.invoke.mockResolvedValueOnce(["Built-in", "Projector"]);
    await expect(presentScreens.displays()).resolves.toEqual(["Built-in", "Projector"]);
    expect(mocks.invoke).toHaveBeenCalledWith("present_displays");
    mocks.invoke.mockRejectedValueOnce(new Error("no"));
    await expect(presentScreens.displays()).resolves.toEqual([]);
  });
});

describe("filling the screen for a show", () => {
  it("moves the window to the display chosen before it fills it, and puts it back after", async () => {
    writePresentOn("name:Projector");
    const order: string[] = [];
    mocks.invoke.mockImplementation((name: string) => {
      order.push(name);
      return Promise.resolve();
    });
    mocks.plain.mockImplementation(() => order.push("fill"));
    const onLeft = vi.fn();
    const leave = await fillShowScreen(onLeft);
    expect(mocks.invoke).toHaveBeenCalledWith("present_enter", { choice: "name:Projector" });
    expect(order).toEqual(["present_enter", "fill"]);
    expect(mocks.plain).toHaveBeenCalledWith(onLeft);
    leave();
    expect(mocks.back).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenLastCalledWith("present_leave");
    expect(mocks.stopScale).toHaveBeenCalledTimes(1);
  });

  it("still fills the screen where the display cannot be chosen", async () => {
    mocks.invoke.mockRejectedValue(new Error("no"));
    const leave = await fillShowScreen(() => {});
    expect(mocks.plain).toHaveBeenCalledTimes(1);
    expect(() => leave()).not.toThrow();
  });

  it("fills the page's own screen in a browser, and asks the app for nothing", async () => {
    mocks.desktop = false;
    const leave = await fillShowScreen(() => {});
    expect(mocks.plain).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
    leave();
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });

  it("fills the new display again when the window's display changes during the show (another scale), and not after it", async () => {
    const leave = await fillShowScreen(() => {});
    expect(mocks.scale).toHaveLength(1);
    mocks.scale[0]!();
    await vi.waitFor(() => expect(mocks.fullscreen.mock.calls).toEqual([[false], [true]]));
    leave();
    expect(mocks.stopScale).toHaveBeenCalled();
  });
});
