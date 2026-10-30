// Without a connection: the window opens and works, the update check says
// nothing and does not use up its day, and it looks again once the
// connection is back. (Chat held until the connection returns, and a
// calendar that cannot be fetched, are tested with their own features.)

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../../shell/AppShell";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { DAY, loadUpdates, updatePrefs } from "./prefs";
import { dailyCheck } from "./start";
import { useUpdates } from "./store";

const newer = {
  current: "0.2.0",
  latest: "0.3.0",
  newer: true,
  url: "https://github.com/example/kasten/releases/tag/v0.3.0",
  name: "KastenFlow 0.3.0",
  published: "2026-10-01T09:00:00Z",
  notes: "",
  download: null,
};

beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({ toasts: [] });
  useUpdates.setState({ info: null, checking: false, error: null, checkedAt: null, open: false, skipped: undefined });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the update check offline", () => {
  it("says nothing, keeps the reason, and does not use up the day", async () => {
    updatePrefs({ auto: true, checked: 0 });
    await dailyCheck(vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))), 5 * DAY);
    expect(useWorkspace.getState().toasts).toEqual([]);
    expect(useUpdates.getState().error).toBe("Failed to fetch");
    // Still due: the connection is back a minute later and the check goes through.
    expect(loadUpdates().checked).toBe(0);
    await dailyCheck(vi.fn(async () => newer), 5 * DAY + 60_000);
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("KastenFlow 0.3.0 is out");
    expect(useUpdates.getState().error).toBeNull();
    expect(loadUpdates().checked).toBe(5 * DAY + 60_000);
  });

  it("keeps the day used when the check went through", async () => {
    updatePrefs({ auto: true, checked: 0 });
    await dailyCheck(vi.fn(async () => ({ ...newer, newer: false, latest: "0.2.0" })), 5 * DAY);
    expect(loadUpdates().checked).toBe(5 * DAY);
  });
});

describe("a window that starts offline", () => {
  it("opens, lists the notes and says nothing about the network", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const vault = new MemoryVault({ "library/plan.md": "---\ntitle: Plan\n---\nBody.\n" });
    render(<AppShell connect={async () => ({ client: vault })} />);
    const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
    expect(sidebar).toBeTruthy();
    expect(useWorkspace.getState().toasts).toEqual([]);
    expect(useWorkspace.getState().notes.map((n) => n.title)).toContain("Plan");
  });
});
