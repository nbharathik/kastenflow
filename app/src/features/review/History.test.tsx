import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import type { ChangedFile, CommitInfo, SessionInfo, Undone } from "../../lib/vault/types";
import { AppShell } from "../../shell/AppShell";
import { usePrefs } from "../workspace/prefs";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { showSession } from "./session-request";
import { useReview } from "./store";

const SEED = { "library/paper.md": "---\ntitle: Paper draft\n---\nWe match by date.\n" };

const now = new Date();
/** Today or `daysAgo` days before, at `hour` local time. */
const at = (hour: number, daysAgo = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour).getTime();

function commit(id: string, time: number, extra: Partial<CommitInfo> = {}): CommitInfo {
  return { id, summary: `edit: ${id}`, message: "", author: "Ada", time, agent: false, session: null, op: null, approvedBy: null, undoes: null, ...extra };
}

const agent = { agent: true, author: "agent:claude-code", session: "S1" };

/** The preview vault with a git-like history and one agent session. */
class HistoryVault extends MemoryVault {
  commits: CommitInfo[] = [
    commit("u1", at(12), { summary: "undo: edit: Old plan", undoes: "c0" }),
    commit("c4", at(11), { ...agent, summary: "edit: Paper draft", op: "propose_edit", approvedBy: "ada" }),
    commit("c3", at(10), { ...agent, summary: "append: Paper draft", op: "append" }),
    commit("h1", at(9, 1), { summary: "edit: Welcome" }),
  ];
  runs: SessionInfo[] = [{ id: "S1", client: "claude-code", started: at(10), last: at(11), commits: 2, undone: false }];
  undone: Undone = { reverted: ["c4"], conflict: { commit: "c3", summary: "append: Paper draft", path: "library/paper.md", detail: "It was edited on the same lines after the session" } };

  override async history(path: string | null, limit = 100): Promise<CommitInfo[]> {
    return path ? super.history(path, limit) : this.commits.slice(0, limit);
  }

  override async sessions(): Promise<SessionInfo[]> {
    return this.runs;
  }

  override async commitChanges(rev: string): Promise<ChangedFile[]> {
    if (rev !== "c3") return [];
    return [
      { path: "library/paper.md", before: "We match by date.\n", after: "We match by date.\nThen by size.\n" },
      { path: "library/gone.md", before: "Old.\n", after: null },
    ];
  }

  override async undoSession(): Promise<Undone> {
    return this.undone;
  }

  undoneCommits: string[] = [];

  override async undoCommit(commit: string): Promise<Undone> {
    this.undoneCommits.push(commit);
    return commit === "h1" ? { reverted: ["h1"], conflict: null } : { reverted: [], conflict: { commit, summary: "append: Paper draft", path: "library/paper.md", detail: "It was edited on the same lines after this change" } };
  }
}

let vault: HistoryVault;

async function openHistory() {
  // The sidebar pins a few views; this one is pinned so its button is there to click.
  usePrefs.setState({ navPinned: ["history"] });
  render(<AppShell connect={async () => ({ client: vault })} />);
  const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
  fireEvent.click(within(sidebar).getByRole("button", { name: "History" }));
  await screen.findByRole("heading", { level: 1, name: /History/ });
  return screen.findByRole("tabpanel");
}

const row = (panel: HTMLElement, text: string) => within(panel).getByText(text).closest("button")!;

beforeEach(() => {
  localStorage.clear();
  vault = new HistoryVault(SEED);
  useWorkspace.setState({ client: null, ready: false, notes: [], place: { view: "home" }, back: [], forward: [], recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
  useReview.setState({ proposals: [], loaded: false, error: null });
});
afterEach(cleanup);

describe("History", () => {
  it("lists every change by day with its author and badges", async () => {
    const panel = await openHistory();
    await within(panel).findByText("Welcome");
    expect(within(panel).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Today", "Yesterday"]);
    const approved = row(panel, "approved by ada");
    expect(within(approved).getByText("claude-code")).toBeTruthy();
    expect(approved.textContent).toContain("Edited");
    // An undo: what it undid, the "undo" badge, and who did it.
    const undo = row(panel, "Old plan");
    expect(undo.textContent).toContain("Undid a change (edited)");
    expect(within(undo).getByText("undo")).toBeTruthy();
    expect(within(undo).getByText("Ada")).toBeTruthy();
    expect(row(panel, "Welcome").textContent).toContain("Ada");
  });

  it("reads a commit's files only when it is opened, and opens notes that still exist", async () => {
    const changes = vi.spyOn(vault, "commitChanges");
    const panel = await openHistory();
    const append = await waitFor(() => within(panel).getByText("Added text").closest("button")!);
    expect(changes).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(append));
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith("c3");
    const added = await within(panel).findByText("Then by size.");
    expect(added.className).toContain("kr-add");
    expect(within(panel).getByText("removed")).toBeTruthy();
    // A trashed or moved note's path is plain text; one that exists opens.
    expect(within(panel).queryByRole("button", { name: "library/gone.md" })).toBeNull();
    // A note that exists shows its title and opens.
    fireEvent.click(within(panel).getByRole("button", { name: "Paper draft" }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "library/paper.md" });
  });

  it("undoes one change in the desktop app, and says when it cannot", async () => {
    Object.defineProperty(vault, "kind", { value: "vault" });
    const panel = await openHistory();
    const welcome = await waitFor(() => row(panel, "Welcome"));
    await act(async () => fireEvent.click(welcome));
    await act(async () => fireEvent.click(await within(panel).findByRole("button", { name: "Undo this change" })));
    expect(vault.undoneCommits).toEqual(["h1"]);
    expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("Undid “Welcome”");

    await act(async () => fireEvent.click(row(panel, "Welcome")));
    await act(async () => fireEvent.click(within(panel).getByText("Added text").closest("button")!));
    await act(async () => fireEvent.click(await within(panel).findByRole("button", { name: "Undo this change" })));
    expect((await within(panel).findByRole("alert")).textContent).toBe("Not undone: library/paper.md changed since (it was edited on the same lines after this change).");
    // An undo is not undone again from here.
    await act(async () => fireEvent.click(row(panel, "Old plan")));
    expect(within(panel).queryAllByRole("button", { name: "Undo this change" })).toHaveLength(1);
  });

  it("finds changes by note, word or agent, and clears the filter", async () => {
    const panel = await openHistory();
    await within(panel).findByText("Welcome");
    const rows = () => [...panel.querySelectorAll("li")].map((li) => li.querySelector("button")!.textContent);
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Find a change" }), { target: { value: "paper" } });
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Find a change" }), { target: { value: "" } });
    fireEvent.click(within(within(panel).getByRole("group", { name: "Made by" })).getByRole("button", { name: /Agents/ }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().every((text) => text!.includes("claude-code"))).toBe(true);
    fireEvent.click(within(within(panel).getByRole("group", { name: "Made by" })).getByRole("button", { name: "You" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Find a change" }), { target: { value: "nothing like it" } });
    await within(panel).findByText("No changes match.");
    fireEvent.click(within(panel).getByRole("button", { name: "Clear the filter" }));
    await waitFor(() => expect(rows()).toHaveLength(4));
  });

  it("offers no undo of one change in the browser preview", async () => {
    const panel = await openHistory();
    await act(async () => fireEvent.click(await waitFor(() => row(panel, "Welcome"))));
    expect(within(panel).queryByRole("button", { name: "Undo this change" })).toBeNull();
  });

  it("shows the first 100 commits, then more", async () => {
    vault.commits = Array.from({ length: 150 }, (_, i) => commit(`k${i}`, at(12) - i * 60_000, { summary: `edit: Note ${i}` }));
    const history = vi.spyOn(vault, "history");
    const panel = await openHistory();
    await within(panel).findByText("Note 0");
    expect(panel.querySelectorAll("li")).toHaveLength(100);
    fireEvent.click(within(panel).getByRole("button", { name: "Show more" }));
    expect(panel.querySelectorAll("li")).toHaveLength(150);
    expect(within(panel).queryByRole("button", { name: "Show more" })).toBeNull();
    expect(history).toHaveBeenCalledWith(null, 300);
  });

  it("undoes a session after explaining it, and shows where it stopped", async () => {
    const undo = vi.spyOn(vault, "undoSession");
    const history = vi.spyOn(vault, "history");
    const list = vi.spyOn(vault, "list");
    await openHistory();
    fireEvent.click(screen.getByRole("tab", { name: /Agent sessions/ }));
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(await within(panel).findByRole("button", { expanded: false, name: /claude-code/ }));
    // Its commits, from the history list.
    expect(within(panel).getByText("Added text")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Undo session" }));
    const ask = within(panel).getByRole("alertdialog", { name: "Undo this session?" });
    expect(ask.textContent).toContain(
      "Reverts this session's 2 changes as new commits. Later edits you made are kept; if one conflicts the undo stops and tells you.",
    );
    const reads = history.mock.calls.length;
    const listed = list.mock.calls.length;

    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Undo session" })));
    expect(undo).toHaveBeenCalledWith("S1");
    const stopped = await within(panel).findByRole("alert");
    expect(stopped.textContent).toContain("The undo stopped at “append: Paper draft”, after reverting 1 change.");
    expect(stopped.textContent).toContain("library/paper.md: It was edited on the same lines after the session");
    expect(history.mock.calls.length).toBeGreaterThan(reads);
    expect(list.mock.calls.length).toBeGreaterThan(listed);

    fireEvent.click(within(stopped).getByRole("button", { name: "Open the note" }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "library/paper.md" });
  });

  it("says how many changes a clean undo reverted", async () => {
    vault.undone = { reverted: ["c4", "c3"], conflict: null };
    await openHistory();
    fireEvent.click(screen.getByRole("tab", { name: /Agent sessions/ }));
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(await within(panel).findByRole("button", { expanded: false, name: /claude-code/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Undo session" }));
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Undo session" })));
    expect((await within(panel).findByRole("status")).textContent).toBe("Reverted 2 changes.");
  });

  it("opens the session a page asks for", async () => {
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => showSession("S1"));
    const tab = await screen.findByRole("tab", { name: /Agent sessions/ });
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
    const panel = screen.getByRole("tabpanel");
    expect(await within(panel).findByRole("button", { expanded: true, name: /claude-code/ })).toBeTruthy();
    expect(within(panel).getByText("Added text")).toBeTruthy();
  });

  it("trusts a session for an hour", async () => {
    const trust = vi.spyOn(vault, "trustSession");
    await openHistory();
    fireEvent.click(screen.getByRole("tab", { name: /Agent sessions/ }));
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(await within(panel).findByRole("button", { expanded: false, name: /claude-code/ }));
    expect(within(panel).getByText(/lifts this session's soft limits/).textContent).toContain("The refusals stay");
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Trust for an hour" })));
    expect(trust).toHaveBeenCalledWith("S1", 60);
    expect(await screen.findByText(/soft limits are lifted, the refusals still apply/)).toBeTruthy();
    expect(within(panel).getByText(/Trusted until/)).toBeTruthy();
  });
});
