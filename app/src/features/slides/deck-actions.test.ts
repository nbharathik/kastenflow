import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktop: true,
  now: false,
  set: vi.fn((_on: boolean) => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: () => Promise.resolve(mocks.now), setFullscreen: mocks.set }),
}));
vi.mock("../../lib/api", () => ({ inTauri: () => mocks.desktop }));
vi.mock("./return-to-slides", () => ({ goToSlides: vi.fn() }));
vi.mock("./slide-numbers-state", () => ({ useSlideNumbers: { getState: () => ({ show: vi.fn() }) } }));

import { DECK_ACTIONS, setWindowFullScreen } from "./deck-actions";

beforeEach(() => {
  mocks.desktop = true;
  mocks.now = false;
  mocks.set.mockClear();
  mocks.set.mockImplementation(() => Promise.resolve());
});

describe("the editor's full screen and the desktop window", () => {
  it("takes the window full screen with the editor and gives it back", async () => {
    await setWindowFullScreen(true);
    expect(mocks.set).toHaveBeenLastCalledWith(true);
    mocks.now = true;
    await setWindowFullScreen(false);
    expect(mocks.set).toHaveBeenLastCalledWith(false);
  });

  it("leaves a window alone that is already as asked", async () => {
    mocks.now = true;
    await setWindowFullScreen(true);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("does nothing in a browser, and swallows a refusal", async () => {
    mocks.desktop = false;
    await setWindowFullScreen(true);
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.desktop = true;
    mocks.set.mockImplementation(() => Promise.reject(new Error("not allowed")));
    await expect(setWindowFullScreen(true)).resolves.toBeUndefined();
  });

  it("is one of the actions the editor is given", () => {
    expect(typeof DECK_ACTIONS.fullScreen).toBe("function");
  });
});
