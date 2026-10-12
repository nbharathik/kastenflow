import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const steps: string[] = [];
vi.mock("../workspace/page/before-exit", () => ({
  writeEverything: vi.fn(async () => void steps.push("written")),
}));

import type { DownloadProgress, UpdateInfo } from "../../lib/api";
import { useWorkspace } from "../workspace/store";
import { download, installAndRestart, installLabel } from "./install";
import { DAY, loadUpdates, updatePrefs } from "./prefs";
import { dailyCheck } from "./start";
import { useUpdates } from "./store";
import { UpdatePill } from "./UpdatePill";
import WhatsNew from "./WhatsNew";

const newer: UpdateInfo = {
  current: "0.2.0",
  latest: "0.3.0",
  newer: true,
  url: "https://github.com/example/kasten/releases/tag/v0.3.0",
  name: "KastenFlow 0.3.0",
  published: null,
  notes: "- Faster search",
  download: { name: "KastenFlow_0.3.0_x64-setup.exe", url: "https://github.com/example/kasten/releases/download/v0.3.0/KastenFlow_0.3.0_x64-setup.exe", size: 9_000_000 },
};

/** A download that reports halfway, then all of it. */
const fetched = (version: string | null) =>
  vi.fn(async (onProgress: (p: DownloadProgress) => void) => {
    onProgress({ done: 50, total: 100 });
    expect(useUpdates.getState().progress).toBe(0.5);
    onProgress({ done: 100, total: 100 });
    return version;
  });

beforeEach(() => {
  steps.length = 0;
  localStorage.clear();
  useWorkspace.setState({ toasts: [] });
  useUpdates.setState({ info: null, open: false, skipped: undefined, canInstall: true, phase: "idle", progress: null, installError: null });
});
afterEach(cleanup);

describe("downloading a new version", () => {
  it("reports its progress and is then ready", async () => {
    expect(await download(fetched("0.3.0"))).toBe(true);
    expect(useUpdates.getState()).toMatchObject({ phase: "ready", progress: 1, installError: null });
    // Once here, it is not fetched again.
    const again = fetched("0.3.0");
    expect(await download(again)).toBe(true);
    expect(again).not.toHaveBeenCalled();
  });

  it("says why when it fails, or when the release can't be installed from here", async () => {
    expect(await download(vi.fn(async () => Promise.reject(new Error("The download isn't signed with Kasten's key"))))).toBe(false);
    expect(useUpdates.getState()).toMatchObject({ phase: "failed", installError: "The download isn't signed with Kasten's key" });
    expect(await download(vi.fn(async () => null))).toBe(false);
    expect(useUpdates.getState().installError).toMatch(/Download it from the release page/);
  });
});

describe("installing", () => {
  it("writes and commits what was typed before it installs, and stays busy while Kasten restarts", async () => {
    const install = vi.fn(async () => void steps.push("installed"));
    await installAndRestart(fetched("0.3.0"), install);
    expect(steps).toEqual(["written", "installed"]);
    expect(useUpdates.getState().phase).toBe("installing");
  });

  it("installs nothing when the download fails, and says why an install failed", async () => {
    const install = vi.fn(async () => {});
    await installAndRestart(vi.fn(async () => Promise.reject(new Error("offline"))), install);
    expect(install).not.toHaveBeenCalled();
    useUpdates.setState({ phase: "idle" });
    await installAndRestart(fetched("0.3.0"), vi.fn(async () => Promise.reject(new Error("Installing needs your permission"))));
    expect(useUpdates.getState()).toMatchObject({ phase: "failed", installError: "Installing needs your permission" });
  });

  it("names each step on its button", () => {
    expect(installLabel("idle", null)).toBe("Install and restart");
    expect(installLabel("downloading", 0.42)).toBe("Downloading… 42%");
    expect(installLabel("downloading", null)).toBe("Downloading…");
    expect(installLabel("ready", 1)).toBe("Restart to update");
    expect(installLabel("installing", 1)).toBe("Installing…");
  });
});

describe("the daily check where Kasten installs in place", () => {
  const due = () => updatePrefs({ auto: true, checked: 0 });

  it("downloads what it finds, then offers to restart", async () => {
    due();
    const fetch = vi.fn(async () => true);
    await dailyCheck(vi.fn(async () => newer), 5 * DAY, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const toast = useWorkspace.getState().toasts.at(-1)!;
    expect(toast.text).toBe("KastenFlow 0.3.0 is ready to install");
    expect(toast.action!.label).toBe("Restart to update");
  });

  it("only says a version is out when downloading is off, fails, or can't happen here", async () => {
    for (const setup of [
      () => updatePrefs({ download: false }),
      () => useUpdates.setState({ canInstall: false }),
      () => {},
    ]) {
      localStorage.clear();
      useWorkspace.setState({ toasts: [] });
      useUpdates.setState({ canInstall: true });
      due();
      setup();
      const fetch = vi.fn(async () => false);
      await dailyCheck(vi.fn(async () => newer), 5 * DAY, fetch);
      expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("KastenFlow 0.3.0 is out");
    }
    expect(loadUpdates().download).toBe(true);
  });
});

describe("What's new, where Kasten installs in place", () => {
  it("installs and restarts, and falls back to the download when that fails", async () => {
    const install = vi.fn(async () => {});
    const open = vi.fn(async () => {});
    useUpdates.setState({ info: newer, open: true });
    const { rerender } = render(<WhatsNew open={open} install={install} />);
    expect(screen.getByText(/What you typed is saved first/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download \(9 MB\)/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(install).toHaveBeenCalledTimes(1);

    act(() => useUpdates.setState({ phase: "downloading", progress: 0.3 }));
    rerender(<WhatsNew open={open} install={install} />);
    expect((screen.getByRole("button", { name: "Downloading… 30%" }) as HTMLButtonElement).disabled).toBe(true);

    act(() => useUpdates.setState({ phase: "failed", installError: "Could not reach GitHub." }));
    rerender(<WhatsNew open={open} install={install} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not reach GitHub.");
    fireEvent.click(screen.getByRole("button", { name: /Download \(9 MB\)/ }));
    expect(open).toHaveBeenCalledWith(newer.download!.url);
  });
});

describe("the status bar, once a version is downloaded", () => {
  it("restarts to update in one click", () => {
    const install = vi.fn(async () => {});
    useUpdates.setState({ info: newer, phase: "ready" });
    const { rerender } = render(<UpdatePill install={install} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(install).toHaveBeenCalledTimes(1);
    act(() => useUpdates.setState({ phase: "installing" }));
    rerender(<UpdatePill install={install} />);
    expect((screen.getByRole("button", { name: "Installing…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
