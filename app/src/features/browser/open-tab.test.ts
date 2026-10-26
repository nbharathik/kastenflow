import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openUrl } from "../../lib/api";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { openInKastenTab } from "./open";
import { resetBrowserPrefs, useBrowserPrefs } from "./prefs";

vi.mock("../../lib/api", async (original) => ({ ...(await original<typeof import("../../lib/api")>()), openUrl: vi.fn(() => Promise.resolve()) }));

const WEB = "https://example.com/x";
const toast = vi.fn();

beforeEach(() => {
  resetBrowserPrefs();
  useWorkspace.setState({ ...derive(initialLayout({ view: "home" })), client: {} as never, notes: [], toasts: [], toast });
  vi.mocked(openUrl).mockClear();
  toast.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("Open in a KastenFlow tab", () => {
  it("opens a web tab beside the page when the browser is on, and says so", () => {
    useBrowserPrefs.setState({ enabled: true, known: true });
    openInKastenTab(WEB);
    const tabs = useWorkspace.getState().layout.panes.flatMap((pane) => pane.tabs);
    expect(tabs.some((tab) => tab.place.view === "web")).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Opened in a KastenFlow tab.");
  });

  it("opens the system's browser instead when the browser is off, and says so", () => {
    useBrowserPrefs.setState({ enabled: false, known: true });
    openInKastenTab(WEB);
    expect(openUrl).toHaveBeenCalledWith(WEB);
    expect(toast).toHaveBeenCalledWith("Web tabs are off, so the page opened in your browser.");
    expect(useWorkspace.getState().layout.panes.flatMap((pane) => pane.tabs).some((tab) => tab.place.view === "web")).toBe(false);
  });

  it("sends an address that is not a web page out, with no talk of tabs", () => {
    useBrowserPrefs.setState({ enabled: true, known: true });
    openInKastenTab("mailto:me@example.com");
    expect(openUrl).toHaveBeenCalledWith("mailto:me@example.com");
    expect(toast).not.toHaveBeenCalled();
  });
});
