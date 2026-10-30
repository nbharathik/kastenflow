import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SlidesHost } from "../editor/host.ts";
import { TOOLBAR_KEY, readToolbar, writeToolbar } from "./options.ts";
import { showScreens } from "./start.ts";

beforeEach(() => localStorage.clear());

describe("Show the toolbar while presenting", () => {
  it("is on until it is turned off, and is kept", () => {
    expect(readToolbar()).toBe(true);
    writeToolbar(false);
    expect(localStorage.getItem(TOOLBAR_KEY)).toBe("off");
    expect(readToolbar()).toBe(false);
    writeToolbar(true);
    expect(readToolbar()).toBe(true);
  });
});

describe("the screens a show can move between", () => {
  it("are none where the host cannot move a running show", () => {
    expect(showScreens({} as SlidesHost)).toBeUndefined();
    const plain = { screens: { displays: async () => [], chosen: () => "auto", choose: () => {} } } as unknown as SlidesHost;
    expect(showScreens(plain)).toBeUndefined();
  });

  it("hand swapping, moving and identifying to the host", async () => {
    const screens = { displays: async () => [], chosen: () => "auto", choose: () => {}, list: vi.fn(async () => []), swap: vi.fn(), moveTo: vi.fn(), identify: vi.fn() };
    const found = showScreens({ screens } as unknown as SlidesHost);
    await found?.list();
    found?.swap();
    found?.moveTo("Projector");
    found?.identify?.();
    expect(screens.list).toHaveBeenCalledTimes(1);
    expect(screens.swap).toHaveBeenCalledTimes(1);
    expect(screens.moveTo).toHaveBeenCalledWith("Projector");
    expect(screens.identify).toHaveBeenCalledTimes(1);
  });
});
