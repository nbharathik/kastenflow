// Proposals inside the conversation: the cards of this chat's session, deciding
// there with the same operations as Review, hunk by hunk for a longer change,
// and a page that moved on since the agent read it (never applied).

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Proposal } from "../../../lib/vault/types";
import { useReview } from "../../review/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { Conversation } from "../view/Conversation";

const BODY = "## Method\n\nWe match photos by date.\n\nWe count every property.\n\n## Results\n\nIt works.\n";
const PAPER = `---\ntitle: Paper draft\n---\n${BODY}`;

/** The preview vault with proposals waiting, recording how they were decided. */
class AgentVault extends MemoryVault {
  pending: Proposal[] = [];
  accepted: string[] = [];
  rejected: string[] = [];
  hunks: { id: string; body: string }[] = [];
  refuse: string | null = null;

  override async proposals(): Promise<Proposal[]> {
    return this.pending.map((p) => ({ ...p }));
  }

  override async acceptProposal(id?: string): Promise<unknown> {
    if (this.refuse) throw new Error(this.refuse);
    this.accepted.push(id!);
    this.pending = this.pending.filter((p) => p.id !== id);
    return {};
  }

  override async acceptProposalHunks(id?: string, body?: string): Promise<unknown> {
    this.hunks.push({ id: id!, body: body! });
    this.pending = this.pending.filter((p) => p.id !== id);
    return {};
  }

  override async rejectProposal(id?: string): Promise<void> {
    this.rejected.push(id!);
    this.pending = this.pending.filter((p) => p.id !== id);
  }
}

function proposal(id: string, extra: Partial<Proposal> = {}): Proposal {
  return {
    id,
    created: "2026-10-29T09:00:00Z",
    session: "session-t1",
    client: "kasten-chat",
    status: "pending",
    op: { kind: "replace_section", path: "library/paper.md", heading: "Method", markdown: "We match by date.\n" },
    target: { path: "library/paper.md", title: "Paper draft" },
    reason: "A rewrite always waits for review",
    note: null,
    diff: "",
    before: BODY,
    after: BODY.replace("We match photos by date.", "We match by date."),
    decided: null,
    decidedBy: null,
    ...extra,
  };
}

/** Two separate changes in one text. */
const TWO = proposal("two", {
  op: { kind: "edit", path: "library/paper.md", body: "", base: BODY },
  after: BODY.replace("We match photos by date.", "We match by date.").replace("It works.", "It works well."),
});

let chat: Scripted;
let vault: AgentVault;

async function show(pending: Proposal[], notes: Record<string, string> = { "library/paper.md": PAPER }) {
  vault = new AgentVault(notes);
  vault.pending = pending;
  await useWorkspace.getState().connect({ client: vault });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ id: "t1", open: true });
  await useChat.getState().send(id, "Tighten the method");
  chat.emit({ chat: id, turn: "turn-1", kind: "done" });
  await useReview.getState().refresh();
  render(<Conversation id={id} variant="full" page={null} />);
  return id;
}

const cards = () => [...document.querySelectorAll("[data-proposal]")];
const press = (name: string | RegExp, within_: HTMLElement | null = null) => act(async () => fireEvent.click((within_ ? within(within_) : screen).getByRole("button", { name })));

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useReview.setState({ proposals: [], loaded: false, error: null });
  useWorkspace.setState({ toasts: [] });
});
afterEach(cleanup);

describe("proposals in the conversation", () => {
  it("draws this chat's proposals as cards, and counts the other agents' without drawing them", async () => {
    await show([proposal("mine"), proposal("theirs", { session: "someone-else", client: "claude-code" })]);
    const found = await screen.findAllByRole("article", { name: /Paper draft, proposed by kasten-chat/ });
    expect(found).toHaveLength(1);
    expect(cards()).toHaveLength(1);
    expect(screen.getByText(/1 change from other agents waits in/)).toBeTruthy();
    // The same drawing as Review: the change as a diff.
    expect(within(found[0]!).getByRole("table").textContent).toContain("We match by date.");
  });

  it("accepts with the Review operation, and the card goes", async () => {
    await show([proposal("mine")]);
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    await press("Accept", card);
    await waitFor(() => expect(vault.accepted).toEqual(["mine"]));
    expect(vault.rejected).toEqual([]);
    await waitFor(() => expect(cards()).toHaveLength(0));
  });

  it("rejects without touching the note", async () => {
    await show([proposal("mine")]);
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    await press("Reject", card);
    await waitFor(() => expect(vault.rejected).toEqual(["mine"]));
    expect(vault.accepted).toEqual([]);
    expect((await vault.read("library/paper.md")).text).toBe(PAPER);
  });

  it("offers a way to Review, which is not a forced switch of page", async () => {
    await show([proposal("mine")]);
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    expect(useWorkspace.getState().place).not.toEqual({ view: "review" });
    await press("Open in Review", card);
    expect(useWorkspace.getState().place).toEqual({ view: "review" });
  });
});

describe("keeping some changes of a proposal", () => {
  it("shows each change with Keep and Undo, and keeps all with one press", async () => {
    await show([TWO]);
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    const first = within(card).getByRole("group", { name: "Change 1 of 2" });
    expect(within(first).getByRole("button", { name: "Keep change 1 of 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(card).getByRole("group", { name: "Change 2 of 2" })).toBeTruthy();
    await press("Keep all", card);
    await waitFor(() => expect(vault.accepted).toEqual(["two"]));
    expect(vault.hunks).toEqual([]);
  });

  it("writes only the changes kept when one is undone", async () => {
    await show([TWO]);
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    await press("Undo change 2 of 2", card);
    expect(within(card).getByRole("button", { name: "Undo change 2 of 2" }).getAttribute("aria-pressed")).toBe("true");
    await press("Keep 1 of 2", card);
    await waitFor(() => expect(vault.hunks).toHaveLength(1));
    expect(vault.hunks[0]).toEqual({ id: "two", body: BODY.replace("We match photos by date.", "We match by date.") });
    expect(vault.accepted).toEqual([]);
  });

  it("is a rejection when every change is undone, and Undo all rejects at once", async () => {
    await show([TWO]);
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    await press("Undo all", card);
    await waitFor(() => expect(vault.rejected).toEqual(["two"]));
    expect(vault.hunks).toEqual([]);
  });
});

describe("a page that changed since the agent read it", () => {
  const MOVED = PAPER.replace("We match photos by date.", "We match photos by day.");

  it("says so, offers to ask again, and never offers to apply", async () => {
    await show([proposal("mine")], { "library/paper.md": MOVED });
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    await within(card).findByText("This page changed since the agent read it.");
    expect(within(card).queryByRole("button", { name: "Accept" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Ask the agent to redo" })).toBeTruthy();
    // The key that accepts does nothing on it.
    fireEvent.keyDown(card, { key: "a" });
    expect(vault.accepted).toEqual([]);
  });

  it("rejects the stale proposal and asks the agent again in the same chat", async () => {
    await show([proposal("mine")], { "library/paper.md": MOVED });
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    await within(card).findByText("This page changed since the agent read it.");
    await press("Ask the agent to redo", card);
    await waitFor(() => expect(vault.rejected).toEqual(["mine"]));
    await waitFor(() => expect(chat.requests.at(-1)?.text).toContain("changed after you read it"));
    expect(vault.accepted).toEqual([]);
    expect((await vault.read("library/paper.md")).text).toBe(MOVED);
  });

  it("is what the card shows when the core refuses to put the change together", async () => {
    await show([proposal("mine")]);
    const card = await screen.findByRole("article", { name: /proposed by kasten-chat/ });
    vault.refuse = "The note changed on the same lines since this was proposed";
    await press("Accept", card);
    await within(card).findByText("This page changed since the agent read it.");
    expect(within(card).getByRole("button", { name: "Ask the agent to redo" })).toBeTruthy();
  });
});
