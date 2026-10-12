import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppInfo, UpdateInfo } from "../../lib/api";
import { useWorkspace } from "../workspace/store";
import { DAY, dueAt, loadUpdates, newerThan, saveUpdates, updatePrefs } from "./prefs";
import { askOnce, dailyCheck, greetUpdate } from "./start";
import { selectAvailable, useUpdates } from "./store";
import { UpdatePill } from "./UpdatePill";
import WhatsNew, { sizeText } from "./WhatsNew";

const newer: UpdateInfo = {
  current: "0.2.0",
  latest: "0.3.0",
  newer: true,
  url: "https://github.com/example/kasten/releases/tag/v0.3.0",
  name: "KastenFlow 0.3.0",
  published: "2026-10-01T09:00:00Z",
  notes: "## Highlights\n\n- Mind maps\n- Faster search",
  download: { name: "KastenFlow_0.3.0_x64-setup.exe", url: "https://github.com/example/kasten/releases/download/v0.3.0/KastenFlow_0.3.0_x64-setup.exe", size: 84_000_000 },
};
const same: UpdateInfo = { ...newer, latest: "0.2.0", newer: false, download: null };
const app: AppInfo = { coreVersion: "0.3.0", appVersion: "0.3.0", vault: null, releases: "https://github.com/example/kasten/releases" };
const found = (info: UpdateInfo) => vi.fn(async () => info);

beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({ toasts: [] });
  useUpdates.setState({ info: null, checking: false, error: null, checkedAt: null, open: false, skipped: undefined });
});
afterEach(cleanup);

describe("update choices", () => {
  it("start with the daily check off, and keep what is changed", () => {
    expect(loadUpdates()).toMatchObject({ auto: false, checked: 0, asked: false });
    updatePrefs({ auto: true });
    updatePrefs({ skipped: "0.3.0" });
    expect(loadUpdates()).toMatchObject({ auto: true, skipped: "0.3.0" });
  });

  it("run the daily check at most once a day, and only when on", () => {
    const now = 10 * DAY;
    expect(dueAt(loadUpdates(), now)).toBe(false);
    saveUpdates({ ...loadUpdates(), auto: true });
    expect(dueAt(loadUpdates(), now)).toBe(true);
    saveUpdates({ ...loadUpdates(), checked: now - DAY / 2 });
    expect(dueAt(loadUpdates(), now)).toBe(false);
    expect(dueAt(loadUpdates(), now + DAY)).toBe(true);
  });

  it("compare versions by number, a release after its pre-releases", () => {
    expect(newerThan("0.10.0", "0.9.3")).toBe(true);
    expect(newerThan("v1.0", "0.9.9")).toBe(true);
    expect(newerThan("1.2.0", "1.2.0-beta.2")).toBe(true);
    expect(newerThan("1.2.0-beta.2", "1.2.0")).toBe(false);
    expect(newerThan("0.2.0", "0.2.0")).toBe(false);
    expect(newerThan("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("the daily check", () => {
  it("says once when a newer Kasten is out, and opens what is new in it", async () => {
    updatePrefs({ auto: true });
    const check = found(newer);
    await dailyCheck(check, 5 * DAY);
    const toast = useWorkspace.getState().toasts.at(-1)!;
    expect(toast.text).toBe("KastenFlow 0.3.0 is out");
    toast.action!.run();
    expect(useUpdates.getState().open).toBe(true);
    // The next day the same release is not announced again, but it stays
    // a click away in the status bar.
    await dailyCheck(check, 6 * DAY + 1);
    expect(check).toHaveBeenCalledTimes(2);
    expect(useWorkspace.getState().toasts).toHaveLength(1);
    expect(selectAvailable(useUpdates.getState())?.latest).toBe("0.3.0");
  });

  it("stays quiet when off, up to date, skipped or offline", async () => {
    const check = found(same);
    await dailyCheck(check, 5 * DAY);
    expect(check).not.toHaveBeenCalled();
    updatePrefs({ auto: true, checked: 0 });
    await dailyCheck(check, 5 * DAY);
    updatePrefs({ checked: 0, skipped: "0.3.0" });
    await dailyCheck(found(newer), 5 * DAY);
    updatePrefs({ checked: 0 });
    await dailyCheck(vi.fn(async () => Promise.reject(new Error("offline"))), 5 * DAY);
    expect(useWorkspace.getState().toasts).toEqual([]);
    expect(useUpdates.getState().error).toBe("offline");
  });

  it("is asked for once, and turning it on checks at once", async () => {
    const check = found(newer);
    askOnce(check);
    askOnce(check);
    const toasts = useWorkspace.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.text).toMatch(/new KastenFlow is out/);
    await act(async () => toasts[0]!.action!.run());
    expect(loadUpdates().auto).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("KastenFlow 0.3.0 is out");
  });

  it("is not asked for when it is already on", () => {
    updatePrefs({ auto: true });
    askOnce(found(newer));
    expect(useWorkspace.getState().toasts).toEqual([]);
  });
});

describe("after an update", () => {
  it("says what version runs now, once, with its notes a click away", () => {
    const open = vi.fn(async () => {});
    greetUpdate({ ...app, appVersion: "0.2.0" }, open);
    // The first run has nothing to compare with.
    expect(useWorkspace.getState().toasts).toEqual([]);
    greetUpdate(app, open);
    const toast = useWorkspace.getState().toasts.at(-1)!;
    expect(toast.text).toBe("KastenFlow is now 0.3.0");
    toast.action!.run();
    expect(open).toHaveBeenCalledWith("https://github.com/example/kasten/releases/tag/v0.3.0");
    greetUpdate(app, open);
    expect(useWorkspace.getState().toasts).toHaveLength(1);
  });

  it("says nothing after going back to an older version", () => {
    updatePrefs({ ran: "0.4.0" });
    greetUpdate(app, vi.fn());
    expect(useWorkspace.getState().toasts).toEqual([]);
    expect(loadUpdates().ran).toBe("0.3.0");
  });
});

describe("What's new", () => {
  it("shows the release and its notes, and downloads the installer", () => {
    const open = vi.fn(async () => {});
    useUpdates.setState({ info: newer, open: true });
    render(<WhatsNew open={open} />);
    expect(screen.getByRole("dialog", { name: "KastenFlow 0.3.0" })).toBeTruthy();
    expect(screen.getByText(/You have 0.2.0/)).toBeTruthy();
    expect(screen.getByText("Mind maps")).toBeTruthy();
    expect(screen.getByText(/Your notes stay in their folder/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download \(84 MB\)/ }));
    expect(open).toHaveBeenCalledWith(newer.download!.url);
    fireEvent.click(screen.getByRole("button", { name: "Release page" }));
    expect(open).toHaveBeenCalledWith(newer.url);
  });

  it("skips a version, or closes for later", () => {
    useUpdates.setState({ info: newer, open: true });
    render(<WhatsNew open={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(useUpdates.getState().open).toBe(false);
    useUpdates.setState({ open: true });
    fireEvent.click(screen.getByRole("button", { name: "Skip this version" }));
    expect(useUpdates.getState()).toMatchObject({ open: false, skipped: "0.3.0" });
    expect(loadUpdates().skipped).toBe("0.3.0");
    expect(selectAvailable(useUpdates.getState())).toBeNull();
  });

  it("closes with Escape, and offers the release page when there is no installer", () => {
    const open = vi.fn(async () => {});
    useUpdates.setState({ info: { ...newer, download: null, notes: "" }, open: true });
    render(<WhatsNew open={open} />);
    expect(screen.getByText(/release page lists what changed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(useUpdates.getState().open).toBe(false);
  });

  it("writes sizes as people read them", () => {
    expect(sizeText(84_000_000)).toBe("84 MB");
    expect(sizeText(420_000)).toBe("420 KB");
    expect(sizeText(12)).toBe("1 KB");
  });
});

describe("the status bar", () => {
  it("shows a newer version until it is skipped", () => {
    const { rerender } = render(<UpdatePill />);
    expect(screen.queryByRole("button")).toBeNull();
    act(() => useUpdates.setState({ info: newer }));
    rerender(<UpdatePill />);
    fireEvent.click(screen.getByRole("button", { name: "Update to 0.3.0" }));
    expect(useUpdates.getState().open).toBe(true);
    act(() => useUpdates.getState().skip());
    rerender(<UpdatePill />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nothing when this is the latest version", () => {
    useUpdates.setState({ info: same });
    render(<UpdatePill />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
