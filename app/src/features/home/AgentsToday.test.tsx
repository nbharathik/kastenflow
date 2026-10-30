// Home's "Agents today": one block per agent session with its changes, notes,
// what waits for you and Undo; the empty and error words.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Digest, DigestSession, Undone, VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { AgentsToday } from "./AgentsToday";
import { homeSections } from "./sections";

const session = (over: Partial<DigestSession> = {}): DigestSession => ({
  id: "S1",
  client: "routine: conference tracking",
  started: new Date(2026, 9, 23, 8, 12).getTime(),
  last: new Date(2026, 9, 23, 8, 40).getTime(),
  changes: 3,
  proposed: 0,
  notesTouched: 2,
  notes: ["library/plan.md", "inbox/ask-the-team.md"],
  mode: null,
  proposalsWaiting: 0,
  canUndo: true,
  undone: false,
  ...over,
});

const digest = (sessions: DigestSession[]): Digest => ({ since: 0, sessions, changes: sessions.reduce((n, s) => n + s.changes, 0), waiting: sessions.reduce((n, s) => n + s.proposalsWaiting, 0) });

const go = vi.fn();
const toast = vi.fn();
const refresh = vi.fn(async () => {});
let reads: Digest[];
let undoSession: (id: string) => Promise<Undone>;
let activityDigest: ReturnType<typeof vi.fn>;

function useClient(first: Digest[]) {
  reads = [...first];
  activityDigest = vi.fn(async () => (reads.length > 1 ? reads.shift()! : reads[0]!));
  const client = { activityDigest, undoSession: (id: string) => undoSession(id) } as unknown as VaultClient;
  useWorkspace.setState({ client, notes: [{ path: "library/plan.md", title: "The plan" }] as never, ...derive(initialLayout()), go, toast, refresh });
}

beforeEach(() => {
  go.mockClear();
  toast.mockClear();
  undoSession = async () => ({ reverted: ["a", "b", "c"], conflict: null });
});
afterEach(cleanup);

describe("Home's Agents today", () => {
  it("is off until asked for in Customize, and lives in the slim column", () => {
    expect(homeSections(null)).not.toContain("agents");
    expect(homeSections(["recent", "agents"])).toEqual(["recent", "agents"]);
  });

  it("says there were no agent changes when there were none", async () => {
    useClient([digest([])]);
    render(<AgentsToday />);
    expect(await screen.findByText("No agent changes today")).toBeTruthy();
  });

  it("shows each session with the agent's name, changes, notes and what waits", async () => {
    useClient([digest([session(), session({ id: "S2", client: "claude-code", changes: 1, notesTouched: 1, notes: ["library/plan.md"], proposalsWaiting: 2, canUndo: false, undone: true })])]);
    render(<AgentsToday />);
    const card = await screen.findByRole("region", { name: "Agents today" });
    await within(card).findByText("routine: conference tracking");
    expect(within(card).getByText("3 changes in 2 notes")).toBeTruthy();
    expect(within(card).getByText("The plan, ask the team")).toBeTruthy();
    expect(within(card).getByText(/^1 change in 1 note/)).toBeTruthy();
    expect(within(card).getByText("2 waiting for you")).toBeTruthy();
    expect(within(card).getByText("Taken back")).toBeTruthy();
    // Undo only where something can still be taken back; Review only where something waits.
    expect(within(card).getAllByRole("button", { name: /^Undo everything/ })).toHaveLength(1);
    expect(within(card).getAllByRole("button", { name: /^Review what/ })).toHaveLength(1);
  });

  it("takes a session back in one press, says how many changes, and reads again", async () => {
    useClient([digest([session()]), digest([session({ canUndo: false, undone: true })])]);
    const undo = vi.fn(async () => ({ reverted: ["a", "b", "c"], conflict: null }));
    undoSession = undo;
    render(<AgentsToday />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo everything routine: conference tracking changed" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Took back 3 changes by routine: conference tracking"));
    expect(undo).toHaveBeenCalledWith("S1");
    expect(await screen.findByText("Taken back")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Undo everything/ })).toBeNull();
  });

  it("says where an undo stopped and offers History", async () => {
    useClient([digest([session()])]);
    undoSession = async () => ({ reverted: [], conflict: { commit: "x", summary: "append: Plan", path: "library/plan.md", detail: "It was edited on the same lines" } });
    render(<AgentsToday />);
    fireEvent.click(await screen.findByRole("button", { name: /^Undo everything/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0]![0]).toBe("The undo stopped at “append: Plan”: It was edited on the same lines");
    expect(toast.mock.calls[0]![1]).toMatchObject({ label: "See in History" });
  });

  it("goes to Review for what waits and to History for the day", async () => {
    useClient([digest([session({ proposalsWaiting: 1 })])]);
    render(<AgentsToday />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review what/ }));
    expect(go).toHaveBeenCalledWith({ view: "review" });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(go).toHaveBeenCalledWith({ view: "history", path: "today-by-agents" });
  });

  it("sums the day up on top and puts what waits for you first", async () => {
    useClient([digest([session({ id: "A", client: "agent-a" }), session({ id: "B", client: "agent-b", proposalsWaiting: 1 }), session({ id: "C", client: "agent-c", proposalsWaiting: 3 })])]);
    render(<AgentsToday />);
    const card = await screen.findByRole("region", { name: "Agents today" });
    await within(card).findByText("3 agents · 9 changes · 4 waiting for you");
    const order = within(card)
      .getAllByRole("button", { name: /^See .* in History$/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual(["See agent-c in History", "See agent-b in History", "See agent-a in History"]);
  });

  it("shows three sessions in full, then 'and N more' that opens the rest as one line each", async () => {
    const many = Array.from({ length: 6 }, (_, i) => session({ id: `S${i}`, client: `agent-${i}`, changes: i + 1 }));
    useClient([digest(many)]);
    render(<AgentsToday />);
    const card = await screen.findByRole("region", { name: "Agents today" });
    await within(card).findByText("agent-0");
    expect(card.querySelectorAll(".kasten-agent-row:not(.is-line)")).toHaveLength(3);
    const more = within(card).getByRole("button", { name: "and 3 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    // Shut, the lines are out of reach of Tab and of a screen reader.
    expect(within(card).queryByRole("button", { name: "See agent-3 in History" })).toBeNull();
    fireEvent.click(more);
    expect(within(card).getByRole("button", { name: "See agent-3 in History" })).toBeTruthy();
    expect(card.querySelectorAll(".kasten-agent-row.is-line")).toHaveLength(3);
  });

  it("reads again 2 s after the notes stop changing, not for every change, and not while hidden", async () => {
    vi.useFakeTimers();
    try {
      useClient([digest([session()])]);
      render(<AgentsToday />);
      await act(async () => {});
      expect(activityDigest).toHaveBeenCalledTimes(1);
      const edit = (title: string) => act(() => void useWorkspace.setState({ notes: [{ path: "library/plan.md", title }] as never }));
      edit("a");
      vi.advanceTimersByTime(1500);
      edit("ab");
      vi.advanceTimersByTime(1500);
      edit("abc");
      expect(activityDigest).toHaveBeenCalledTimes(1);
      await act(async () => void vi.advanceTimersByTime(2100));
      expect(activityDigest).toHaveBeenCalledTimes(2);

      const hide = (state: "hidden" | "visible") => {
        Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      hide("hidden");
      edit("abcd");
      await act(async () => void vi.advanceTimersByTime(5000));
      expect(activityDigest).toHaveBeenCalledTimes(2);
      await act(async () => hide("visible"));
      expect(activityDigest).toHaveBeenCalledTimes(3);
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      vi.useRealTimers();
    }
  });

  it("says plainly when it could not read, and tries again from a button", async () => {
    useClient([digest([])]);
    activityDigest.mockRejectedValueOnce(new Error("no history"));
    render(<AgentsToday />);
    expect((await screen.findByText(/Could not read what agents did: no history/)).textContent).toContain("no history");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No agent changes today")).toBeTruthy();
  });
});
