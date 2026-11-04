// "Undo this chat's changes": a few changes are undone at once and can be
// undone again; many are counted first. (The write choice and its agent-mode
// override are tested with the menu: WriteMenu.test.tsx.)

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentPolicy, CommitInfo, SessionInfo, Undone } from "../../../lib/vault/types";
import { useAgentMode } from "../../agents/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { newThread, type Message, type Thread } from "../thread";
import { useChat } from "../store";
import { SessionBar } from "./SessionBar";
import { useSessionUi } from "./session-ui";
import { WriteMenu } from "./WriteMenu";

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

beforeEach(() => {
  localStorage.clear();
  useSessionUi.setState({ dismissed: {}, undoAsked: {} });
});
afterEach(cleanup);

describe("Undo this chat's changes", () => {
  it("undoes a few changes at once, and the undo can be undone", async () => {
    await open(3);
    await act(async () => fireEvent.click(undoButton()));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(vault.undoneSession).toBe(1);
    expect((await screen.findByRole("status")).textContent).toContain("Reverted 3 changes.");
    expect(screen.getByText("Changes undone")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo the undo" })));
    // The commits that made the undo are undone, newest first.
    expect(vault.undoneCommits).toEqual(["u-a1", "u-a2", "u-a3"]);
    expect(screen.getByText("Changed notes")).toBeTruthy();
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
    expect(screen.getByText("Changes undone")).toBeTruthy();
  });
});

/** An answer whose tool wrote to these paths. */
const wrote = (id: string, ...paths: string[]): Message => ({
  id,
  role: "assistant",
  turn: null,
  provider: "p",
  model: "m",
  parts: [{ kind: "tool", call: { id: `c-${id}`, name: "append", input: null }, result: { id: `c-${id}`, ok: true, summary: "", paths } }],
  status: "done",
  error: null,
  pinned: null,
});

const setThread = (patch: Partial<Thread>) => act(() => useChat.setState((s) => ({ threads: { t1: { ...s.threads["t1"]!, ...patch } } })));

describe("the quiet chip", () => {
  it("counts the notes the tools changed, with icon buttons that have names and tooltips", async () => {
    await open(2);
    await setThread({ messages: [wrote("m1", "a.md", "b.md"), wrote("m2", "b.md", "c.md")] });
    expect(screen.getByText("Changed 3 notes")).toBeTruthy();
    for (const name of ["Undo this chat's changes", "See in History", "Hide this"]) expect(screen.getByRole("button", { name }).getAttribute("title")).toBeTruthy();
    expect(screen.queryByText("This chat changed your notes.")).toBeNull();
  });

  it("says Changed notes when it cannot count, and 1 note for one", async () => {
    await open(1);
    expect(screen.getByText("Changed notes")).toBeTruthy();
    await setThread({ messages: [wrote("m1", "a.md")] });
    expect(screen.getByText("Changed 1 note")).toBeTruthy();
  });

  it("is hidden until the chat changes something new, and while an answer streams", async () => {
    await open(2);
    await setThread({ messages: [wrote("m1", "a.md")] });
    fireEvent.click(screen.getByRole("button", { name: "Hide this" }));
    expect(screen.queryByRole("button", { name: "See in History" })).toBeNull();
    // A thread that goes on without changing anything keeps it away.
    await setThread({ messages: [wrote("m1", "a.md"), { id: "q2", role: "user", text: "Thanks", context: [] }] });
    expect(screen.queryByRole("button", { name: "See in History" })).toBeNull();
    // A new change brings it back.
    await setThread({ messages: [wrote("m1", "a.md"), wrote("m3", "b.md")] });
    expect(screen.getByText("Changed 2 notes")).toBeTruthy();
    // Not while it streams.
    await setThread({ streaming: true });
    expect(screen.queryByRole("button", { name: "See in History" })).toBeNull();
    await setThread({ streaming: false });
    expect(screen.getByRole("button", { name: "See in History" })).toBeTruthy();
  });

  it("keeps Undo and See in History in the thread's … menu, hidden chip or not", async () => {
    await open(2);
    await setThread({ messages: [wrote("m1", "a.md")] });
    function Menu() {
      const thread = useChat((s) => s.threads["t1"]!);
      return <WriteMenu thread={thread} />;
    }
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "Hide this" }));
    expect(screen.queryByRole("button", { name: "Undo this chat's changes" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Chat options" })));
    expect(screen.getByRole("menuitem", { name: /See in History/ })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /Undo this chat's changes/ })));
    expect(vault.undoneSession).toBe(1);
    expect((await screen.findByRole("status")).textContent).toContain("Reverted 2 changes.");
    // Undone, the menu offers History only.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Chat options" })));
    expect(screen.queryByRole("menuitem", { name: /Undo this chat's changes/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /See in History/ })).toBeTruthy();
  });
});
