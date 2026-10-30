// "Restore to before this session" in History: offered for a session that has a
// restore point, asked about first (it goes back past later changes too), and
// the result said in plain words.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Checkpoint, CommitInfo, SessionInfo, VaultRestore } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { restoreWords } from "./RestorePoints";
import { SessionsTab } from "./SessionsTab";

const session = (id: string): SessionInfo => ({ id, client: "claude-code", started: 1_000, last: 2_000, commits: 1, undone: false });
const commit: CommitInfo = { id: "c1", summary: "append: Plan", message: "", author: "agent:claude-code", time: 2_000, agent: true, session: "S1", op: "append", approvedBy: null, undoes: null };
const point = (over: Partial<Checkpoint> = {}): Checkpoint => ({ id: "P1", session: "S1", head: "abc", time: 900, label: "Before this session", ...over });

let vault: MemoryVault;
let restored: string[];

function show(checkpoints: Checkpoint[], onChanged = async () => {}) {
  render(<SessionsTab sessions={[session("S1"), session("S2")]} commits={[commit]} checkpoints={checkpoints} onChanged={onChanged} focus={{ id: "S1", at: 1 }} />);
}

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault({});
  restored = [];
  vi.spyOn(vault, "restoreToCheckpoint").mockImplementation(async (id) => {
    restored.push(id);
    return { written: ["library/a.md", "library/b.md"], trashed: [".trash/x/library/c.md"], commit: "r1" } satisfies VaultRestore;
  });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Restore to before this session", () => {
  it("words a restore point as the button says it", () => {
    expect(restoreWords("Before this session")).toBe("Restore to before this session");
    expect(restoreWords("Before a batch of 21 changes")).toBe("Restore to before a batch of 21 changes");
  });

  it("is offered only on the session that has a restore point", () => {
    show([point()]);
    expect(screen.getAllByRole("button", { name: "Restore to before this session" })).toHaveLength(1);
  });

  it("is not offered when there is no restore point", () => {
    show([]);
    expect(screen.queryByRole("button", { name: /Restore to before/ })).toBeNull();
  });

  it("asks first, warns that later changes go too, then restores and says what it did", async () => {
    const changed = vi.fn(async () => {});
    show([point()], changed);
    fireEvent.click(screen.getByRole("button", { name: "Restore to before this session" }));
    const ask = screen.getByRole("alertdialog", { name: "Restore to before this session?" });
    expect(ask.textContent).toContain("Everything changed since, by you or by other agents, goes back too");
    expect(restored).toEqual([]);
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Restore" })));
    expect(restored).toEqual(["P1"]);
    expect(screen.getByRole("status").textContent).toContain("2 files restored. History can undo this.");
    expect(changed).toHaveBeenCalled();
  });

  it("lets the question go with Cancel or Escape", () => {
    show([point()]);
    fireEvent.click(screen.getByRole("button", { name: "Restore to before this session" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore to before this session" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(restored).toEqual([]);
  });

  it("offers a batch's restore point beside the session's", () => {
    show([point({ id: "P2", label: "Before a batch of 30 changes" }), point()]);
    expect(screen.getByRole("button", { name: "Restore to before a batch of 30 changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore to before this session" })).toBeTruthy();
  });

  it("says plainly when it could not", async () => {
    vi.mocked(vault.restoreToCheckpoint).mockRejectedValueOnce(new Error("That restore point is gone"));
    show([point()]);
    fireEvent.click(screen.getByRole("button", { name: "Restore to before this session" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restore" })));
    expect(screen.getByRole("alert").textContent).toContain("The vault was not put back: That restore point is gone");
  });
});
