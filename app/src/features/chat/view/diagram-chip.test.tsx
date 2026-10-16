// A diagram as context for a chat: the chip, "+ Context → A diagram…", and what goes with the message.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDiagrams } from "../../diagrams/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { ChatDock } from "../ChatDock";
import { diagramChip } from "../context";
import { useChat } from "../store";
import { resetChat, scriptedChat, type Scripted } from "../test-kit";

const SEED = { "library/plan.md": "---\ntitle: Plan\n---\nA plan.\n" };

let chat: Scripted;
let vault: MemoryVault;
let flow: string;

async function showPanel() {
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(noteAt(useWorkspace.getState().notes, "library/plan.md")!.path);
  render(<ChatDock />);
  return screen.findByRole("group", { name: "Context" });
}

const chipLabels = (chips: HTMLElement) => [...chips.querySelectorAll(".kasten-chat-chip-label")].map((c) => c.textContent);

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  flow = await vault.createDiagram("Login flow", null);
  chat = scriptedChat();
  resetChat(chat);
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
});
afterEach(cleanup);

describe("the diagram chip", () => {
  it("names the diagram by its path, and a page of it when it has several", () => {
    expect(diagramChip({ path: "library/Login-flow.drawio", title: "Login flow" })).toEqual({ kind: "diagram", label: "Login flow", ref: ["library/Login-flow.drawio"] });
    expect(diagramChip({ path: "library/Login-flow.drawio", title: "Login flow" }, "Second")).toEqual({ kind: "diagram", label: "Login flow", ref: ["library/Login-flow.drawio", "Second"] });
  });

  it("is added from + Context, found among the vault's diagrams", async () => {
    await vault.createDiagram("Network map", null);
    const chips = await showPanel();
    fireEvent.click(screen.getByRole("button", { name: "+ Context" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /A diagram/ }));
    const option = await screen.findByRole("option", { name: /Login flow/ });
    expect(screen.getByRole("option", { name: /Network map/ })).toBeTruthy();
    fireEvent.click(option);
    await expect.poll(() => chipLabels(chips)).toEqual(["Plan", "Login flow"]);
    const chip = within(chips).getByRole("button", { name: "Remove Login flow" }).closest(".kasten-chat-chip")!;
    expect(chip.getAttribute("data-kind")).toBe("diagram");
    expect(chip.getAttribute("data-origin")).toBe("added");
  });

  it("goes with the message as the request the backend reads the diagram from", async () => {
    const chips = await showPanel();
    fireEvent.click(screen.getByRole("button", { name: "+ Context" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /A diagram/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Login flow/ }));
    await expect.poll(() => chipLabels(chips)).toContain("Login flow");
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "What does this show?" } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(chat.requests[0]!.context).toEqual([
      { kind: "note", label: "Plan", ref: ["library/plan.md"] },
      { kind: "diagram", label: "Login flow", ref: [flow] },
    ]);
  });

  it("is added once, and removed with its button", async () => {
    const chips = await showPanel();
    useChat.getState().addChip(useChat.getState().active!, diagramChip({ path: flow, title: "Login flow" }));
    useChat.getState().addChip(useChat.getState().active!, diagramChip({ path: flow, title: "Login flow" }));
    await expect.poll(() => chipLabels(chips)).toEqual(["Plan", "Login flow"]);
    fireEvent.click(within(chips).getByRole("button", { name: "Remove Login flow" }));
    expect(chipLabels(chips)).toEqual(["Plan"]);
  });

  it("says there are none when the vault has no diagram", async () => {
    vault = new MemoryVault(SEED);
    await showPanel();
    fireEvent.click(screen.getByRole("button", { name: "+ Context" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /A diagram/ }));
    expect(await screen.findByText("No diagrams yet")).toBeTruthy();
  });
});
