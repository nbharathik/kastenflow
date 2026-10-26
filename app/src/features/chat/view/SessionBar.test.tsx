// "Undo this chat's changes": a few changes are undone at once and can be
// undone again; many are counted first. "Apply directly" gives way to the
// agent mode.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentPolicy, CommitInfo, SessionInfo, Undone } from "../../../lib/vault/types";
import { useAgentMode } from "../../agents/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { newThread } from "../thread";
import { useChat } from "../store";
import { SessionBar } from "./SessionBar";

const day = Date.now();
const agent = (n: number): CommitInfo => ({ id: `a${n}`, summary: `append: Note ${n}`, message: "", author: "agent:kasten-chat", time: day - n * 1000, agent: true, session: "S1", op: "append", approvedBy: null, undoes: null });

/** A vault whose history holds `n` changes of the chat's session. */
class SessionVault extends MemoryVault {
  commits: CommitInfo[] = [];
  undone = false;
  undoneSession = 0;
  undoneCommits: string[] = [];
  failCounting = false;

  fill(n: number) {
    this.commits = Array.from({ length: n }, (_, i) => agent(i + 1));
  }

  override async history(path: string | null, limit = 100): Promise<CommitInfo[]> {
    return path ? super.history(path, limit) : this.commits.slice(0, limit);
  }

  override async sessions(): Promise<SessionInfo[]> {
    if (this.failCounting) throw new Error("History is busy");
    const ours = this.commits.filter((c) => c.session === "S1");
    return [{ id: "S1", client: "kasten-chat", started: day - 10_000, last: day, commits: ours.length, undone: this.undone }];
  }

  override async undoSession(): Promise<Undone> {
    this.undoneSession += 1;
    const reverted = this.commits.filter((c) => c.session === "S1" && !c.undoes).map((c) => c.id);
    this.commits = [...reverted.map((id) => ({ ...agent(0), id: `u-${id}`, summary: `undo: ${id}`, session: null, agent: false, author: "Ada", undoes: id })), ...this.commits];
    this.undone = true;
    return { reverted, conflict: null };
  }

  override async undoCommit(commit: string): Promise<Undone> {
    this.undoneCommits.push(commit);
    this.undone = false;
    return { reverted: [commit], conflict: null };
  }
}

let vault: SessionVault;

function Bar() {
  const thread = useChat((s) => s.threads["t1"]!);
  return <SessionBar thread={thread} />;
}

async function open(changes: number, policy?: AgentPolicy) {
  vault = new SessionVault({});
  vault.fill(changes);
  if (policy) await vault.setAgentPolicy(policy);
  useAgentMode.setState({ view: null, box: "hour", error: null });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  await useAgentMode.getState().load();
  useChat.setState({ threads: { t1: { ...newThread(), id: "t1", session: "S1", changed: true } }, active: "t1" });
  render(<Bar />);
}

const undoButton = () => screen.getByRole("button", { name: "Undo this chat's changes" });

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Undo this chat's changes", () => {
  it("undoes a few changes at once, and the undo can be undone", async () => {
    await open(3);
    await act(async () => fireEvent.click(undoButton()));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(vault.undoneSession).toBe(1);
    expect((await screen.findByRole("status")).textContent).toContain("Reverted 3 changes.");
    expect(screen.getByText("This chat's changes were undone.")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo the undo" })));
    // The commits that made the undo are undone, newest first.
    expect(vault.undoneCommits).toEqual(["u-a1", "u-a2", "u-a3"]);
    expect(screen.getByText("This chat changed your notes.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo the undo" })).toBeNull();
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Put this chat's changes back");
    expect(undoButton()).toBeTruthy();
  });

  it("undoes five at once; six are counted first", async () => {
    await open(5);
    await act(async () => fireEvent.click(undoButton()));
    expect(vault.undoneSession).toBe(1);
    cleanup();

    await open(6);
    await act(async () => fireEvent.click(undoButton()));
    const ask = screen.getByRole("alertdialog", { name: "Undo 6 changes from this chat?" });
    expect(vault.undoneSession).toBe(0);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(vault.undoneSession).toBe(0);

    await act(async () => fireEvent.click(undoButton()));
    expect(ask.isConnected).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo changes" })));
    expect(vault.undoneSession).toBe(1);
    expect((await screen.findByRole("status")).textContent).toContain("Reverted 6 changes.");
  });

  it("asks first when it cannot count", async () => {
    await open(2);
    vault.failCounting = true;
    await act(async () => fireEvent.click(undoButton()));
    expect(screen.getByRole("alertdialog", { name: "Undo this chat's changes?" })).toBeTruthy();
    expect(vault.undoneSession).toBe(0);
  });

  it("stops and says where when the undo cannot be undone", async () => {
    await open(2);
    await act(async () => fireEvent.click(undoButton()));
    vault.undoCommit = async () => ({ reverted: [], conflict: { commit: "u-a1", summary: "undo: a1", path: "library/x.md", detail: "It was edited on the same lines after this change" } });
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Undo the undo" })));
    expect((await screen.findByRole("alert")).textContent).toContain("The undo stopped at “undo: a1”");
    expect(screen.getByText("This chat's changes were undone.")).toBeTruthy();
  });
});

describe("Apply directly and the agent mode", () => {
  const apply = () => screen.getByRole("checkbox", { name: "Apply directly" }) as HTMLInputElement;

  it("is the thread's own choice on Balanced", async () => {
    await open(1);
    expect(apply().disabled).toBe(false);
    expect(apply().checked).toBe(false);
    expect(screen.getByText("Changes wait for you to review and apply them.")).toBeTruthy();
  });

  it("gives way to Review everything, which always holds changes", async () => {
    await open(1, { mode: "review", until: null, projects: {} });
    expect(apply().disabled).toBe(true);
    expect(apply().checked).toBe(false);
    expect(screen.getByText(/Review everything is on, so changes wait/)).toBeTruthy();
  });

  it("and to Autonomous, which never does", async () => {
    await open(1, { mode: "autonomous", until: null, projects: {} });
    expect(apply().disabled).toBe(true);
    expect(apply().checked).toBe(true);
    expect(screen.getByText(/Autonomous agents are on, so changes are saved as the chat makes them/)).toBeTruthy();
  });
});
