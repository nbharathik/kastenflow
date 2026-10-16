// A diagram proposal in the review queue: the diagram before and after as the program draws them, from the proposal's own text (it
// is not in the vault yet), with the core's words for the change and the XML one button away.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentOp, Proposal } from "../../../lib/vault/types";
import { ProposalCard } from "../../review/ProposalCard";
import { opWords } from "../../review/words";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { isDiagramProposal } from "./ProposalChange";

const model = (cells: string) => `<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n${cells}      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`;
const box = (id: string, label: string, x: number) => `        <mxCell id="${id}" value="${label}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="40" as="geometry"/></mxCell>\n`;
const BEFORE = model(box("api", "API", 0));
const AFTER = model(box("api", "API", 0) + box("cache", "Cache", 120));

const proposal = (op: AgentOp, extra: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  created: new Date().toISOString(),
  session: "s1",
  client: "claude-code",
  status: "pending",
  op,
  target: { path: "library/Login-flow.drawio", title: "Login flow" },
  reason: "Moves most of the boxes (6 of 8)",
  note: null,
  diff: "Edit the diagram “Login flow”: add 1 node, 1 link\n- add_node cache\n- add_edge api → cache\n\n--- a\n+++ b\n",
  before: BEFORE,
  after: AFTER,
  decided: null,
  decidedBy: null,
  ...extra,
});

const EDIT: AgentOp = { kind: "edit_diagram", path: "library/Login-flow.drawio", steps: [], summary: "add 1 node, 1 link" };
const props = (p: Proposal) => ({ proposal: p, state: {}, mode: "split" as const, note: undefined, onDecide: vi.fn(), onOpen: vi.fn(), onStep: vi.fn() });

let vault: MemoryVault;
let asked: string[];

beforeEach(async () => {
  asked = [];
  vault = new MemoryVault({});
  vault.diagramDraftSvg = async (xml) => {
    asked.push(xml);
    return `<svg xmlns="http://www.w3.org/2000/svg"><text>${xml.length}</text></svg>`;
  };
  await useWorkspace.getState().connect({ client: vault });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("which proposals are drawn as diagrams", () => {
  it("are the ones that make or change a diagram and carry its text", () => {
    expect(isDiagramProposal(proposal(EDIT))).toBe(true);
    expect(isDiagramProposal(proposal({ kind: "update_diagram", path: "library/Login-flow.drawio", xml: AFTER, base: BEFORE }))).toBe(true);
    expect(isDiagramProposal(proposal({ kind: "create_diagram", title: "Login flow", xml: AFTER }, { before: null }))).toBe(true);
    // Trashing has no text after it, and a note is a note.
    expect(isDiagramProposal(proposal({ kind: "trash_diagram", path: "library/Login-flow.drawio" }, { after: null }))).toBe(false);
    expect(isDiagramProposal(proposal({ kind: "append", note: "x" }, { target: { path: "library/x.md", title: "X" } }))).toBe(false);
  });

  it("says what an edit does in the core's words, else in plain ones", () => {
    expect(opWords(EDIT)).toBe("Add 1 node, 1 link");
    expect(opWords({ kind: "edit_diagram", path: "x.drawio", steps: [] })).toBe("Change the diagram");
  });
});

describe("a diagram proposal's card", () => {
  it("draws the diagram before and after from the proposal's text, and shows the core's words and what changed", async () => {
    render(<ProposalCard {...props(proposal(EDIT))} />);
    const pair = await screen.findByRole("group", { name: "Login flow: before and after" });
    expect(await within(pair).findByRole("img", { name: "Login flow, before the change" })).toBeTruthy();
    expect(await within(pair).findByRole("img", { name: "Login flow, after the change" })).toBeTruthy();
    expect(asked).toEqual([BEFORE, AFTER]);
    // The core's description, without the unified diff that follows it.
    expect(screen.getByText(/Edit the diagram “Login flow”: add 1 node, 1 link/).textContent).toContain("- add_edge api → cache");
    expect(screen.queryByText(/\+\+\+ b/)).toBeNull();
    expect(screen.getByRole("list", { name: "What changed" }).textContent).toContain("Added “Cache”.");
    expect(screen.getByText("Moves most of the boxes (6 of 8)")).toBeTruthy();
  });

  it("keeps the XML one button away, and Accept and Reject where they were", async () => {
    const card = props(proposal(EDIT));
    render(<ProposalCard {...card} />);
    await screen.findByRole("group", { name: "Login flow: before and after" });
    fireEvent.click(screen.getByRole("button", { name: "Show XML" }));
    expect(await screen.findByRole("table", { name: "XML changes to Login flow" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Accept/ }));
    expect(card.onDecide).toHaveBeenCalledWith("accept");
  });

  it("shows only the new diagram for one that is made", async () => {
    render(<ProposalCard {...props(proposal({ kind: "create_diagram", title: "Login flow", xml: AFTER }, { before: null }))} />);
    const pair = await screen.findByRole("group", { name: "Login flow: the new diagram" });
    expect(await within(pair).findByRole("img", { name: /as the chat drew it/ })).toBeTruthy();
    await waitFor(() => expect(asked).toEqual([AFTER]));
  });

  it("says no picture could be drawn when the program cannot, and the XML still shows the change", async () => {
    vault.diagramDraftSvg = async () => null;
    render(<ProposalCard {...props(proposal(EDIT))} />);
    const pair = await screen.findByRole("group", { name: "Login flow: before and after" });
    expect(within(pair).getAllByText(/No picture\. The program could not draw this version/)).toHaveLength(2);
  });

  it("leaves a note's proposal as a text diff", async () => {
    const note = proposal({ kind: "append", note: "library/x.md", markdown: "More." }, { target: { path: "library/x.md", title: "X" }, before: "One\n", after: "One\nMore\n", diff: "Add to the end" });
    render(<ProposalCard {...props(note)} />);
    expect(screen.getByRole("table", { name: "Changes to X" })).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });
});
