import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktop: true,
  invoke: vi.fn(),
  plain: vi.fn(),
  back: vi.fn(),
  scale: [] as (() => void)[],
  stopScale: vi.fn(),
  fullscreen: vi.fn((_on?: boolean) => Promise.resolve()),
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

describe("moving a running show", () => {
  it("swaps, moves to a display by name, lists and identifies through the app, without touching the kept choice", async () => {
    writePresentOn("here");
    await presentScreens.swap?.();
    expect(mocks.invoke).toHaveBeenLastCalledWith("present_move", { target: "swap" });
    await presentScreens.moveTo?.("Projector");
    expect(mocks.invoke).toHaveBeenLastCalledWith("present_move", { target: "name:Projector" });
    mocks.invoke.mockResolvedValueOnce([{ label: "Built-in", primary: true, current: true }]);
    await expect(presentScreens.list?.()).resolves.toEqual([{ label: "Built-in", primary: true, current: true }]);
    await presentScreens.identify?.();
    expect(mocks.invoke).toHaveBeenLastCalledWith("present_identify");
    expect(readPresentOn()).toBe("here");
  });

  it("does not throw when the app cannot", async () => {
    mocks.invoke.mockRejectedValue(new Error("no"));
    await expect(presentScreens.swap?.()).resolves.toBeUndefined();
    await expect(presentScreens.list?.()).resolves.toEqual([]);
  });

  it("asks the app to look again when the window's display changes, before it fills the display it is on", async () => {
    const order: string[] = [];
    mocks.invoke.mockImplementation((name: string) => {
      order.push(name);
      return Promise.resolve();
    });
    mocks.fullscreen.mockImplementation((on?: boolean) => {
      order.push(`full:${on}`);
      return Promise.resolve();
    });
    await fillShowScreen(() => {});
    order.length = 0;
    mocks.scale[0]!();
    await vi.waitFor(() => expect(order).toEqual(["present_check", "full:false", "full:true"]));
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
