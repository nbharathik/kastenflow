import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateInfo } from "../../../../lib/api";
import { loadUpdates } from "../../../updates/prefs";
import { useUpdates } from "../../../updates/store";
import { agoText, Updates } from "./Updates";

const newer: UpdateInfo = {
  current: "0.2.0",
  latest: "0.3.0",
  newer: true,
  url: "https://github.com/example/kasten/releases/tag/v0.3.0",
  name: "KastenFlow 0.3.0",
  published: "2026-10-01T09:00:00Z",
  notes: "- Mind maps",
};
const same: UpdateInfo = { ...newer, latest: "0.2.0", newer: false };

beforeEach(() => {
  localStorage.clear();
  useUpdates.setState({ info: null, checking: false, error: null, checkedAt: null, open: false, skipped: undefined });
});
afterEach(cleanup);

describe("Settings: Updates", () => {
  it("checks when asked and opens what is new", async () => {
    render(<Updates check={vi.fn(async () => newer)} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(await screen.findByText(/KastenFlow 0.3.0 is out \(this is 0.2.0\) · checked just now/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What’s new" }));
    expect(useUpdates.getState().open).toBe(true);
  });

  it("says when this is the latest, and when the check failed", async () => {
    const check = vi.fn<() => Promise<UpdateInfo | null>>(async () => same);
    render(<Updates check={check} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(await screen.findByText(/latest version/)).toBeTruthy();
    check.mockRejectedValueOnce(new Error("Could not reach GitHub: offline"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(await screen.findByText(/Could not reach GitHub/)).toBeTruthy();
  });

  it("turns the daily check on and off", () => {
    render(<Updates check={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Check for new versions" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(loadUpdates()).toMatchObject({ auto: true, asked: true });
  });

  it("in the browser preview, says updates are checked in the desktop app", async () => {
    render(<Updates check={vi.fn(async () => null)} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(await screen.findByText(/desktop app/)).toBeTruthy();
  });

  it("says how long ago it checked", () => {
    const now = 1_000_000_000;
    expect(agoText(now - 20_000, now)).toBe("just now");
    expect(agoText(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(agoText(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(agoText(now - 50 * 3_600_000, now)).toBe("2 d ago");
  });
});
