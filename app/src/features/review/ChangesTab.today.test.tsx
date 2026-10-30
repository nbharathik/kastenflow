// History's "Today by agents": what agents changed since midnight, and the
// words when there is nothing.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { CommitInfo } from "../../lib/vault/types";
import { ChangesTab, filterCommits } from "./ChangesTab";

const now = new Date(2026, 9, 23, 15, 0);
const at = (hour: number, daysAgo = 0) => new Date(2026, 9, 23 - daysAgo, hour).getTime();

function commit(id: string, time: number, extra: Partial<CommitInfo> = {}): CommitInfo {
  return { id, summary: `edit: ${id}`, message: "", author: "Ada", time, agent: false, session: null, op: null, approvedBy: null, undoes: null, ...extra } as CommitInfo;
}

const agent = { agent: true, author: "agent:routine: conference tracking", session: "S1", op: "append" };
const commits = [
  commit("mine-today", at(14)),
  commit("agent-today", at(13), agent),
  commit("agent-morning", at(0), agent),
  commit("agent-yesterday", at(23, 1), agent),
];

afterEach(cleanup);

describe("the Today by agents filter", () => {
  it("keeps what an agent changed since midnight, and nothing a person did", () => {
    expect(filterCommits(commits, "", "today", now).map((c) => c.id)).toEqual(["agent-today", "agent-morning"]);
    // The other filters are as they were.
    expect(filterCommits(commits, "", "agents", now).map((c) => c.id)).toEqual(["agent-today", "agent-morning", "agent-yesterday"]);
    expect(filterCommits(commits, "", "you", now).map((c) => c.id)).toEqual(["mine-today"]);
    expect(filterCommits(commits, "agent-today", "today", now).map((c) => c.id)).toEqual(["agent-today"]);
  });

  it("is one press away, and a preset from Home chooses it", () => {
    const { rerender } = render(<ChangesTab commits={commits} full={false} onOlder={() => {}} />);
    const group = screen.getByRole("group", { name: "Made by" });
    const today = within(group).getByRole("button", { name: "Today by agents" });
    expect(today.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(today);
    expect(today.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(today.getAttribute("aria-pressed")).toBe("false");
    rerender(<ChangesTab commits={commits} full={false} onOlder={() => {}} preset={{ who: "today", at: 1 }} />);
    expect(within(screen.getByRole("group", { name: "Made by" })).getByRole("button", { name: "Today by agents" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says so, in one line, when agents changed nothing today, and clears with a button", () => {
    const quiet = [commit("mine-today", Date.now()), commit("agent-old", new Date(2020, 0, 1).getTime(), agent)];
    render(<ChangesTab commits={quiet} full={false} onOlder={() => {}} preset={{ who: "today", at: 1 }} />);
    expect(screen.getByText("No agent changes today")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
    expect(screen.queryByText("No agent changes today")).toBeNull();
  });
});
