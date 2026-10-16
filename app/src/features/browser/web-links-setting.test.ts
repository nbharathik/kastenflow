import { beforeEach, describe, expect, it, vi } from "vitest";

import { openUrl } from "../../lib/api";
import { openWeb } from "../../shell/web-links";
import { coverWindow, windowCovered } from "./cover";
import { openInBrowserTab } from "./open";
import { resetBrowserPrefs, useBrowserPrefs } from "./prefs";

vi.mock("../../lib/api", async (original) => ({ ...(await original<typeof import("../../lib/api")>()), openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("./open", () => ({ openInBrowserTab: vi.fn() }));

const URL = "https://example.com/a";

/** Lets the dynamic import behind a browser tab settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  resetBrowserPrefs();
});

describe("where a web link in a page opens", () => {
  it("is the system's browser unless Settings says a browser tab, and the browser is on", async () => {
    useBrowserPrefs.setState({ enabled: true, known: true });
    openWeb(URL);
    await settle();
    expect(openUrl).toHaveBeenCalledWith(URL);
    expect(openInBrowserTab).not.toHaveBeenCalled();

    useBrowserPrefs.getState().set({ webLinks: "tab" });
    openWeb(URL);
    await settle();
    expect(openInBrowserTab).toHaveBeenCalledWith(URL);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("uses the other one for Shift+click", async () => {
    useBrowserPrefs.setState({ enabled: true, known: true });
    openWeb(URL, true);
    await settle();
    expect(openInBrowserTab).toHaveBeenCalledWith(URL);
    useBrowserPrefs.getState().set({ webLinks: "tab" });
    openWeb(URL, true);
    await settle();
    expect(openUrl).toHaveBeenCalledWith(URL);
  });

  it("never opens a tab with the browser off, and never a mail link in one", async () => {
    useBrowserPrefs.setState({ enabled: false, known: true });
    useBrowserPrefs.getState().set({ webLinks: "tab" });
    openWeb(URL);
    openWeb(URL, true);
    await settle();
    expect(openInBrowserTab).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledTimes(2);
    useBrowserPrefs.setState({ enabled: true });
    openWeb("mailto:me@example.com");
    await settle();
    expect(openInBrowserTab).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenLastCalledWith("mailto:me@example.com");
  });

  it("never makes a tab beneath a presentation: the link goes to the system's browser, and tabs return after", async () => {
    useBrowserPrefs.setState({ enabled: true, known: true });
    useBrowserPrefs.getState().set({ webLinks: "tab" });
    const uncover = coverWindow();
    const second = coverWindow();
    expect(windowCovered()).toBe(true);
    openWeb(URL);
    await settle();
    expect(openInBrowserTab).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith(URL);
    // Two things covering the window: it is open until both are gone, and a second "gone" changes nothing.
    uncover();
    uncover();
    expect(windowCovered()).toBe(true);
    second();
    expect(windowCovered()).toBe(false);
    openWeb(URL);
    await settle();
    expect(openInBrowserTab).toHaveBeenCalledWith(URL);
  });

  it("keeps what was chosen, and reads nothing odd back", () => {
    useBrowserPrefs.getState().set({ webLinks: "tab", engine: "DuckDuckGo", favourites: [{ title: "Docs", url: "https://docs.example/" }], custom: [{ name: "Kagi", url: "https://kagi.com/search?q=%s" }] });
    resetBrowserPrefs();
    expect(useBrowserPrefs.getState()).toMatchObject({ webLinks: "tab", engine: "DuckDuckGo", favourites: [{ title: "Docs", url: "https://docs.example/" }], custom: [{ name: "Kagi", url: "https://kagi.com/search?q=%s" }] });
    localStorage.setItem("kasten.browser", JSON.stringify({ webLinks: "elsewhere", engine: 3, custom: [{ name: "Bad", url: "javascript:%s" }, 7], favourites: [{ title: "x", url: "file:///etc/passwd" }, { url: "https://ok.example/" }] }));
    resetBrowserPrefs();
    expect(useBrowserPrefs.getState()).toMatchObject({ webLinks: "system", engine: "Google", custom: [], favourites: [{ title: "https://ok.example/", url: "https://ok.example/" }] });
  });
});
