// The one line under Home's top line when agents changed something today.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Digest, DigestSession, VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { AgentStrip } from "./AgentStrip";

const session = (over: Partial<DigestSession> = {}): DigestSession => ({ id: "S1", client: "claude-code", started: 1, last: 2, changes: 23, proposed: 0, notesTouched: 4, notes: [], mode: null, proposalsWaiting: 0, canUndo: true, undone: false, ...over });
const digest = (sessions: DigestSession[]): Digest => ({ since: 0, sessions, changes: sessions.reduce((n, s) => n + s.changes, 0), waiting: sessions.reduce((n, s) => n + s.proposalsWaiting, 0) });

const go = vi.fn();
function useDigest(found: Digest) {
  const client = { activityDigest: vi.fn(async () => found) } as unknown as VaultClient;
  useWorkspace.setState({ client, notes: [], ...derive(initialLayout()), go });
}

beforeEach(() => go.mockClear());
afterEach(cleanup);

describe("Home's agent strip", () => {
  it("says how much agents changed and goes to Review for what waits", async () => {
    useDigest(digest([session({ proposalsWaiting: 2 })]));
    render(<AgentStrip />);
    expect(await screen.findByText("Agents changed 23 things today")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review 2" }));
    expect(go).toHaveBeenCalledWith({ view: "review" });
  });

  it("points at History when nothing waits", async () => {
    useDigest(digest([session()]));
    render(<AgentStrip />);
    fireEvent.click(await screen.findByRole("button", { name: "See what changed" }));
    expect(go).toHaveBeenCalledWith({ view: "history", path: "today-by-agents" });
    expect(screen.queryByRole("button", { name: /^Review/ })).toBeNull();
  });

  it("draws nothing on a day without agent changes", async () => {
    useDigest(digest([]));
    const { container } = render(<AgentStrip />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
  });
});
