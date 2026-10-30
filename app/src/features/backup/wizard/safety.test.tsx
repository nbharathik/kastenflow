// Things the wizard must never do: show or log a secret, leave a timer or a
// sign-in running after it closes, or talk in the app's inner words.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke: (await import("./harness")).answer,
}));
vi.mock("@tauri-apps/api/event", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/event")>()),
  listen: async (name: string, then: (event: { payload: unknown }) => void) => {
    const { bk } = await import("./harness");
    bk.listeners.set(name, then);
    return () => bk.listeners.delete(name);
  },
}));

import { bk, called, reset, row, signInEnds, status } from "./harness";
import { openBackupWizard, useBackupWizard } from "./index";
import WizardHost from "./WizardHost";

beforeEach(() => {
  reset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  useBackupWizard.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const INNER_WORDS = /\b(commits?|ops?|sidecars?|rebase|refs?|SHA)\b/i;

async function openToSignIn() {
  render(<WizardHost />);
  act(() => openBackupWizard());
  await screen.findByRole("heading", { name: "Where should your backup go?" });
  click(/^GitHub \(recommended\)/);
  await screen.findByLabelText("Sign-in code");
}

describe("secrets", () => {
  it("never puts a token on screen or in the console once it is sent", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await openToSignIn();
    click("Other ways to sign in");
    const field = screen.getByLabelText("Token") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "github_pat_SECRET" } });
    expect(document.body.textContent).not.toContain("github_pat_SECRET");
    click("Sign in with token");
    await screen.findByRole("heading", { name: "Choose the repository" });
    expect(document.body.innerHTML).not.toContain("github_pat_SECRET");
    expect(JSON.stringify(useBackupWizard.getState())).not.toContain("github_pat_SECRET");
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("github_pat_SECRET");
  });

  it("does not log the sign-in code", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await openToSignIn();
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("ABCD-1234");
  });
});

describe("closing the panel", () => {
  it("cancels a sign-in that is still waiting", async () => {
    await openToSignIn();
    expect(called("github_sign_in_cancel")).toHaveLength(0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(called("github_sign_in_cancel").length).toBeGreaterThan(0);
  });

  it("stops asking for the backup's status", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    bk.handlers.github_create_backup = () => new Promise(() => {});
    bk.handlers.backup_status = () => status({ unpushed: 2 });
    render(<WizardHost />);
    act(() => openBackupWizard());
    await screen.findByRole("heading", { name: "Where should your backup go?" });
    click(/^GitHub \(recommended\)/);
    await screen.findByLabelText("Sign-in code");
    await act(async () => signInEnds({ state: "signed", login: "ada" }));
    await screen.findByText("That name is free.");
    click("Create private repo");
    await screen.findByRole("progressbar", { name: "Backing up" });
    await act(async () => {
      vi.advanceTimersByTime(3700);
    });
    const asked = called("backup_status").length;
    expect(asked).toBeGreaterThanOrEqual(3);
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(called("backup_status")).toHaveLength(asked);
  });
});

describe("plain words", () => {
  it("uses none of the app's inner words on any step", async () => {
    render(<WizardHost />);
    act(() => openBackupWizard());
    await screen.findByRole("heading", { name: "Where should your backup go?" });
    const seen = [screen.getByRole("dialog").textContent ?? ""];
    click(/^GitHub \(recommended\)/);
    await screen.findByLabelText("Sign-in code");
    seen.push(screen.getByRole("dialog").textContent ?? "");
    click("Other ways to sign in");
    seen.push(screen.getByRole("dialog").textContent ?? "");
    await act(async () => signInEnds({ state: "signed", login: "ada" }));
    await screen.findByText("That name is free.");
    seen.push(screen.getByRole("dialog").textContent ?? "");
    bk.handlers.github_create_backup = ({ name }) => ({ ...row(`ada/${name}`), protection: { state: "protected", reason: null } });
    click("Create private repo");
    await screen.findByText(/^Backed up/);
    seen.push(screen.getByRole("dialog").textContent ?? "");
    click("Next");
    await screen.findByRole("heading", { name: "How your backup works" });
    seen.push(screen.getByRole("dialog").textContent ?? "");
    for (const text of seen) expect(text.match(INNER_WORDS)).toBeNull();
  });
});
