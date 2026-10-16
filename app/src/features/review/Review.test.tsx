import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import type { Proposal } from "../../lib/vault/types";
import { AppShell } from "../../shell/AppShell";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { loadNotePage } from "../workspace/page/LazyNotePage";
import { useWorkspace } from "../workspace/store";
import { useReview } from "./store";

// Resolve the lazy view before timing proposal interactions.
beforeAll(async () => { await Promise.all([import("./Review"), loadNotePage()]); }, 60_000);

const SEED = {
  "library/paper.md": "---\ntitle: Paper draft\n---\n## Method\n\nWe match photos by date.\nWe count every changed property.\n",
  "inbox/old.md": "---\ntitle: Old idea\n---\nStale.\n",
};

/** The preview vault with proposals waiting, as the MCP server leaves them. */
class AgentVault extends MemoryVault {
  pending: Proposal[] = [];

  override async proposals(): Promise<Proposal[]> {
    return this.pending.map((p) => ({ ...p }));
  }

  // The preview's own versions take no id, so it is optional here.
  override async acceptProposal(id?: string): Promise<unknown> {
    this.pending = this.pending.filter((p) => p.id !== id);
    return {};
  }

  override async rejectProposal(id?: string): Promise<void> {
    this.pending = this.pending.filter((p) => p.id !== id);
  }
}

function proposal(id: string, extra: Partial<Proposal> = {}): Proposal {
  return {
    id,
    created: "2026-09-24T09:00:00Z",
    session: "01K5SESSIONONE",
    client: "claude-code",
    status: "pending",
    op: { kind: "replace_section", path: "library/paper.md", heading: "Method", markdown: "We match by date.\n" },
    target: { path: "library/paper.md", title: "Paper draft" },
    reason: "Removes 62% of the note's text (the limit is 40%)",
    note: null,
    diff: "--- a/library/paper.md\n+++ b/library/paper.md\n",
    before: "## Method\n\nWe match photos by date.\nWe count every changed property.\n",
    after: "## Method\n\nWe match by date.\n",
    decided: null,
    decidedBy: null,
    ...extra,
  };
}

const TRASH = proposal("02", {
  created: "2026-09-24T09:05:00Z",
  op: { kind: "trash", path: "inbox/old.md", reason: "Done with it" },
  target: { path: "inbox/old.md", title: "Old idea" },
  reason: "This session already moved 5 notes to the trash (the limit is 5)",
  note: "Done with it",
  diff: "Move “Old idea” to the trash",
  before: "Stale.\n",
  after: null,
});

let vault: AgentVault;

async function openReview() {
  render(<AppShell connect={async () => ({ client: vault })} />);
  const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
  const item = await within(sidebar).findByRole("button", { name: /Review/ });
  fireEvent.click(item);
  // The view's code loads when it is first opened; give it time on a busy machine.
  await screen.findByRole("heading", { level: 1, name: /Review/ }, { timeout: 30_000 });
  return { sidebar, badge: () => within(sidebar).queryByRole("button", { name: /Review/ })?.textContent ?? null };
}

const cards = () => screen.queryAllByRole("article");
const card = (name: RegExp) => screen.getByRole("article", { name });

beforeEach(() => {
  localStorage.clear();
  vault = new AgentVault(SEED);
  useWorkspace.setState({ client: null, ready: false, notes: [], place: { view: "home" }, back: [], forward: [], recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
  useReview.setState({ proposals: [], loaded: false, error: null });
});
afterEach(cleanup);

describe("Review", () => {
  it("shows each proposal with its agent, note, change and reason, oldest first", async () => {
    vault.pending = [TRASH, proposal("01")];
    const { badge } = await openReview();
    expect(badge()).toContain("2");
    expect(cards().map((c) => c.getAttribute("data-proposal"))).toEqual(["01", "02"]);

    const edit = card(/Replace section “Method” in Paper draft/);
    expect(within(edit).getByText("claude-code")).toBeTruthy();
    expect(within(edit).getByText("Replace section “Method”")).toBeTruthy();
    expect(within(edit).getByText(/Removes 62% of the note's text/)).toBeTruthy();
    // Side by side: the old line on the left, its new version on the right, words marked.
    const row = within(edit).getByText((_, el) => el?.tagName === "TD" && el.textContent === "We match photos by date.").closest("tr")!;
    expect(row.textContent).toContain("We match by date.");
    expect(row.querySelector(".kr-del mark")?.textContent).toBe("photos ");

    fireEvent.click(screen.getByRole("button", { name: "Unified" }));
    expect(within(edit).getByRole("table").querySelectorAll("col")).toHaveLength(4);

    const trash = card(/Move to trash in Old idea/);
    expect(within(trash).getByText("Move “Old idea” to the trash")).toBeTruthy();
    expect(within(trash).getByText("Done with it")).toBeTruthy();
    fireEvent.click(within(trash).getByRole("button", { name: /Old idea/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "inbox/old.md" });
  });

  it("accepts a proposal: calls the vault, drops the card, refreshes the notes and the badge", async () => {
    vault.pending = [proposal("01"), TRASH];
    const accept = vi.spyOn(vault, "acceptProposal");
    const list = vi.spyOn(vault, "list");
    const { badge } = await openReview();
    const listed = list.mock.calls.length;

    await act(async () => fireEvent.click(within(card(/Paper draft/)).getByRole("button", { name: /^Accept/ })));
    expect(accept).toHaveBeenCalledWith("01");
    expect(await screen.findByText("Accepted “Paper draft”: Replace section “Method”")).toBeTruthy();
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cards()[0]!.getAttribute("data-proposal")).toBe("02");
    expect(list.mock.calls.length).toBeGreaterThan(listed);
    await waitFor(() => expect(badge()).toContain("1"));
  });

  it("rejects the focused card with R, and the Review item goes when the queue is empty", async () => {
    vault.pending = [TRASH];
    const reject = vi.spyOn(vault, "rejectProposal");
    const { sidebar } = await openReview();
    const trash = card(/Old idea/);
    trash.focus();
    await act(async () => fireEvent.keyDown(trash, { key: "r" }));
    expect(reject).toHaveBeenCalledWith("02");
    expect(await screen.findByText("Rejected “Old idea”: Move to trash")).toBeTruthy();
    expect(await screen.findByText("Nothing to review")).toBeTruthy();
    await waitFor(() => expect(within(sidebar).queryByRole("button", { name: /Review/ })).toBeNull());
  });

  it("keeps a card that could not be accepted, with the reason on it", async () => {
    vault.pending = [proposal("01"), TRASH];
    // Tauri rejects with the core's message as a plain string.
    vi.spyOn(vault, "acceptProposal").mockRejectedValue("The note changed on the same lines since this edit was proposed");
    const { badge } = await openReview();
    const edit = card(/Paper draft/);
    await act(async () => fireEvent.click(within(edit).getByRole("button", { name: /^Accept/ })));
    const alert = await within(edit).findByRole("alert");
    expect(alert.textContent).toContain("Could not accept.");
    expect(alert.textContent).toContain("The note changed on the same lines since this edit was proposed");
    expect(cards()).toHaveLength(2);
    expect(badge()).toContain("2");
    expect((within(edit).getByRole("button", { name: /^Reject/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("accepts all of one session's proposals after asking, oldest first", async () => {
    const other = proposal("03", { created: "2026-09-24T09:10:00Z", session: "01K5SESSIONTWO", client: "cursor" });
    vault.pending = [TRASH, other, proposal("01")];
    const accept = vi.spyOn(vault, "acceptProposal");
    const { badge } = await openReview();
    const session = screen.getByRole("region", { name: "Proposals from claude-code" });
    fireEvent.click(within(session).getByRole("button", { name: "Accept all" }));
    const ask = within(session).getByRole("alertdialog", { name: "Accept all 2 proposals from claude-code?" });
    expect(accept).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Accept all" })));
    await waitFor(() => expect(accept.mock.calls.map(([id]) => id)).toEqual(["01", "02"]));
    expect(await screen.findByText("Accepted 2 proposals from claude-code")).toBeTruthy();
    await waitFor(() => expect(cards().map((c) => c.getAttribute("data-proposal"))).toEqual(["03"]));
    await waitFor(() => expect(badge()).toContain("1"));
  });

  it("asks before rejecting all, and cancelling changes nothing", async () => {
    vault.pending = [proposal("01"), TRASH];
    const reject = vi.spyOn(vault, "rejectProposal");
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(reject).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(2);
  });

  it("says when there is nothing to review", async () => {
    render(<AppShell connect={async () => ({ client: vault })} />);
    const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
    await waitFor(() => expect(useReview.getState().loaded).toBe(true));
    expect(within(sidebar).queryByRole("button", { name: /Review/ })).toBeNull();
    act(() => useWorkspace.getState().go({ view: "review" }));
    expect(await screen.findByText("Nothing to review")).toBeTruthy();
    expect(screen.getByText(/rewrites a whole note/)).toBeTruthy();
  });
});
