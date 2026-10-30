import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), canBackUp: () => true }));

import { useShell } from "../../lib/store";
import type { BackUpNow, BackupStatus } from "../../lib/vault/backup-types";
import type { VaultStatus } from "../../lib/vault/types";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { githubPage, sayBackUpNow } from "./back-up-now";
import { hasUnsavedEdits, lookOnce, tellLook } from "./look";
import { popoverView } from "./popover-model";
import { WHEN, whenOf } from "./schedule";
import { StatusPopover } from "./StatusPopover";
import { cardPutAway, CARD_RETURNS_MS, putCardAway } from "./told-up-front";
import { useBackupStatus } from "./use-backup-status";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const MIN = 60_000;

const vault = (over: Partial<VaultStatus["backup"]> = {}): VaultStatus => ({
  name: "Notes",
  root: "/n",
  history: true,
  remote: "https://github.com/ada/notes.git",
  backup: { state: "ok", lastPush: NOW - 2 * MIN, failures: 0, lastError: null, ...over },
  pending: 0,
});
const backup = (over: Partial<BackupStatus> = {}): BackupStatus => ({
  waiting: false,
  unpushed: 0,
  verifiedAt: null,
  skipped: [],
  warn: [],
  visibility: "private",
  paused: false,
  protection: { state: "protected", reason: null },
  lostHistory: false,
  recoveredBranch: null,
  lastBackupAt: null,
  repoSize: null,
  repoUrl: "https://github.com/ada/notes.git",
  ...over,
});

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  useWorkspace.setState({ toast: vi.fn() });
});
afterEach(cleanup);

describe("what the popover says", () => {
  it("shows how fresh the backup is, what waits and when it was verified", () => {
    const view = popoverView(vault(), backup({ unpushed: 3, verifiedAt: new Date(NOW - 2 * 24 * 60 * MIN).toISOString() }), NOW);
    expect(view.headline).toBe("Backed up 2 minutes ago");
    expect(view.waiting).toBe("3 changes waiting");
    expect(view.verified).toBe("Verified 2 days ago");
    expect(popoverView(vault(), backup({ unpushed: 1 }), NOW).waiting).toBe("1 change waiting");
  });

  it("names a file over 100 MB, a public repository, lost history, a failing backup and being off", () => {
    const view = popoverView(vault({ state: "failing", lastError: "no route" }), backup({ skipped: [{ path: "big.bin", size: 120 * 1024 * 1024, since: "x" }], visibility: "public", paused: true, lostHistory: true }), NOW);
    expect(view.skipped[0]?.text).toBe("Not backed up: big.bin is 120 MB, over GitHub's 100 MB limit");
    expect([view.publicRepo, view.lostHistory, view.failing]).toEqual([true, true, "no route"]);
    expect(popoverView(vault({ state: "off" }), null, NOW).off).toBe(true);
    expect(popoverView(null, null, NOW).off).toBe(true);
  });

  it("draws the waiting count, the red public line and the lost-history choice", () => {
    useVaultStatus.setState({ status: vault() });
    useBackupStatus.setState({ status: backup({ unpushed: 3, visibility: "public", paused: true, lostHistory: true }) });
    render(<StatusPopover anchor={{ current: null }} onClose={() => {}} />);
    expect(screen.getByText("3 changes waiting")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make it private" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I want a public backup" })).toBeTruthy();
    expect(screen.getByText("The backup on GitHub is missing some of your history. This computer still has all of it.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /separate copy on GitHub/ })).toBeTruthy();
  });

  it("carries on with the backup as it is now, from the lost-history state", async () => {
    const toast = vi.fn();
    useWorkspace.setState({ toast });
    useVaultStatus.setState({ status: vault() });
    useBackupStatus.setState({ status: backup({ lostHistory: true }) });
    invoke.mockImplementation(async (name: string) => (name === "backup_carry_on" ? { tip: "abc", canPush: true } : undefined));
    render(<StatusPopover anchor={{ current: null }} onClose={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Carry on with the backup as it is now" })));
    expect(invoke).toHaveBeenCalledWith("backup_carry_on");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Carrying on"));
  });

  it("offers only setup while backup is off", () => {
    useVaultStatus.setState({ status: vault({ state: "off", lastPush: null }) });
    useBackupStatus.setState({ status: null });
    render(<StatusPopover anchor={{ current: null }} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Set up backup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back up now" })).toBeNull();
  });
});

describe("Back up now always answers", () => {
  it("says done, nothing to do, or the reason", () => {
    const say = (a: BackUpNow) => sayBackUpNow(a);
    expect(say({ answer: "done", sent: 1 })).toBe("Backed up: 1 change sent.");
    expect(say({ answer: "done", sent: 4 })).toBe("Backed up: 4 changes sent.");
    expect(say({ answer: "nothingToDo" })).toContain("Nothing to back up");
    expect(say({ answer: "not", reason: { kind: "behind" } })).toContain("Get the latest first");
    expect(say({ answer: "not", reason: { kind: "failed", message: "Offline." } })).toBe("Offline.");
  });

  it("shows the answer as a notice from the popover's button", async () => {
    const toast = vi.fn();
    useWorkspace.setState({ toast });
    useVaultStatus.setState({ status: vault() });
    useBackupStatus.setState({ status: backup() });
    invoke.mockImplementation(async (name: string) => (name === "backup_now" ? { answer: "nothingToDo" } : undefined));
    render(<StatusPopover anchor={{ current: null }} onClose={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Back up now" })));
    expect(invoke).toHaveBeenCalledWith("backup_now");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Nothing to back up"), undefined);
  });

  it("finds the web page of a GitHub backup", () => {
    expect(githubPage("https://github.com/ada/notes.git")).toBe("https://github.com/ada/notes");
    expect(githubPage("https://gitlab.com/ada/notes.git")).toBeNull();
  });
});

describe("when to back up", () => {
  it("reads the three choices from the two numbers and back", () => {
    for (const when of ["work", "hourly", "hand"] as const) expect(whenOf(WHEN[when])).toBe(when);
    expect(whenOf({ push_delay_seconds: 30, push_interval_minutes: 5 })).toBe("work");
  });
});

describe("looking for other computers' changes", () => {
  it("counts any page not saved as unsaved edits", () => {
    useShell.setState({ saveStates: { "a.md": "saved" } });
    expect(hasUnsavedEdits()).toBe(false);
    useShell.setState({ saveStates: { "a.md": "saved", "b.md": "edited" } });
    expect(hasUnsavedEdits()).toBe(true);
    useShell.setState({ saveStates: {} });
  });

  it("tells the engine about unsaved edits, and asks nothing when no look is due", async () => {
    useShell.setState({ saveStates: { "b.md": "saving" } });
    invoke.mockImplementation(async (name: string) => (name === "backup_look_due" ? { due: false, canTakeIn: false } : undefined));
    expect(await lookOnce()).toBeNull();
    expect(invoke).toHaveBeenCalledWith("backup_look_due", { unsavedEdits: true });
    expect(invoke).not.toHaveBeenCalledWith("backup_look", expect.anything());
    useShell.setState({ saveStates: {} });
  });

  it("brings in changes with a See changes button that opens History; a merge only asks", () => {
    const toast = vi.fn();
    const go = vi.fn();
    useWorkspace.setState({ toast, go, refresh: vi.fn(async () => {}) });
    tellLook({ result: "brought", changes: 4, files: 2, head: "h" }, { available: false });
    expect(toast.mock.calls[0]?.[0]).toBe("Brought in 4 changes from another computer");
    toast.mock.calls[0]?.[1].run();
    expect(go).toHaveBeenCalledWith({ view: "history" });
    toast.mockClear();
    const told = { available: false };
    tellLook({ result: "available", merge: true }, told);
    tellLook({ result: "available", merge: true }, told);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[1].label).toBe("Get latest");
    tellLook({ result: "held", why: "unsavedEdits" }, told);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

describe("the Home card", () => {
  it("stays away for 7 days once put away, then returns", () => {
    expect(cardPutAway(NOW)).toBe(false);
    putCardAway(NOW);
    expect(cardPutAway(NOW + CARD_RETURNS_MS - 1)).toBe(true);
    expect(cardPutAway(NOW + CARD_RETURNS_MS + 1)).toBe(false);
  });
});
