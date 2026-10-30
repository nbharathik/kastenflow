// "Auto": small, safe changes to the page being worked on are applied when the
// turn ends; anything larger, riskier or elsewhere stays staged. Review
// everything and "Ask first" never apply on their own.

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAgentMode } from "../../agents/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { ChangesView, FileChange } from "../types";
import type { WriteChoice } from "../writes";
import { SMALL_CHANGE, isSmallAndSafe, workingPaths } from "./auto";

const PAGE = "library/welcome.md";
const file = (extra: Partial<FileChange> = {}): FileChange => ({ path: PAGE, kind: "note", title: "Welcome", new: false, before: "One\nTwo\n", after: "One\nTwo!\n", diff: "", stale: false, ...extra });
const view = (files: FileChange[], extra: Partial<ChangesView> = {}): ChangesView => ({
  id: "set-1",
  files,
  pictures: [],
  steps: [{ summary: "Edit “Welcome”", paths: files.map((f) => f.path) }],
  ...extra,
});

let chat: Scripted;

/** A thread about PAGE on `choice`, whose first turn staged `staged` and ended. */
async function turn(choice: WriteChoice, staged: ChangesView) {
  chat.view = staged;
  if (!useWorkspace.getState().client) await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ id: "t1", open: true, context: [{ kind: "note", label: "Welcome", ref: [PAGE] }] });
  useChat.getState().setWrites(id, choice);
  await useChat.getState().send(id, "Fix the typo");
  chat.emit({ chat: id, turn: "turn-1", kind: "changes", changes: { id: "set-1", count: staged.files.length, paths: staged.files.map((f) => f.path) } });
  chat.emit({ chat: id, turn: "turn-1", kind: "done" });
  return id;
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useAgentMode.setState({ view: null, box: "hour", error: null });
  useWorkspace.setState({ client: null, ready: false, notes: [], toasts: [] });
});

describe("what counts as small and safe", () => {
  const scope = new Set([PAGE]);

  it("is an edit to a page in scope, with few lines", () => {
    expect(isSmallAndSafe(view([file()]), scope)).toBe(true);
  });

  it("is not a page outside scope, a new page, a picture, a stale page or a move", () => {
    expect(isSmallAndSafe(view([file({ path: "library/other.md" })]), scope)).toBe(false);
    expect(isSmallAndSafe(view([file({ new: true, before: null })]), scope)).toBe(false);
    expect(isSmallAndSafe(view([file()], { pictures: [{ path: "assets/a.png", name: "a.png", bytes: 3 }] }), scope)).toBe(false);
    expect(isSmallAndSafe(view([file({ stale: true })]), scope)).toBe(false);
    expect(isSmallAndSafe(view([file()], { steps: [{ summary: "Move “Welcome” to Trips", paths: [PAGE] }] }), scope)).toBe(false);
    expect(isSmallAndSafe(view([file({ kind: "deck" })]), scope)).toBe(false);
  });

  it("is not a long change, or one that empties the page", () => {
    const long = Array.from({ length: SMALL_CHANGE + 1 }, (_, i) => `Line ${i}`).join("\n");
    expect(isSmallAndSafe(view([file({ before: "", after: `${long}\n` })]), scope)).toBe(false);
    expect(isSmallAndSafe(view([file({ before: "One\nTwo\n", after: "" })]), scope)).toBe(false);
  });

  it("works on the page chips and the pages selections come from", () => {
    const paths = workingPaths({
      context: [
        { kind: "note", label: "A", ref: ["library/a.md"] },
        { kind: "selection", label: "Selection", ref: [], selection: { source: { kind: "page", path: "library/b.md" }, text: "x", pinned: false } },
        { kind: "selection", label: "Selection", ref: [], selection: { source: { kind: "pdf", path: "library/c.pdf" }, text: "x", pinned: false } },
        { kind: "deck", label: "Deck", ref: ["decks/d.deck"] },
      ],
    });
    expect([...paths].sort()).toEqual(["library/a.md", "library/b.md"]);
  });
});

describe("a turn that ends with changes staged", () => {
  it("applies a small change to the page on Auto, with the same call as Apply", async () => {
    const id = await turn("auto", view([file()]));
    await waitFor(() => expect(chat.applied).toEqual([id]));
    await waitFor(() => expect(useChat.getState().threads[id]!.changes).toBeUndefined());
  });

  it("leaves a larger change staged on Auto", async () => {
    const id = await turn("auto", view([file({ path: "library/trip.md", new: true, before: null, after: "Day one.\n" })]));
    await waitFor(() => expect(useChat.getState().threads[id]!.streaming).toBe(false));
    expect(chat.applied).toEqual([]);
    expect(useChat.getState().threads[id]!.changes).toMatchObject({ id: "set-1", count: 1 });
  });

  it("leaves even a small change staged on Ask first", async () => {
    const id = await turn("ask", view([file()]));
    await waitFor(() => expect(useChat.getState().threads[id]!.streaming).toBe(false));
    expect(chat.applied).toEqual([]);
  });

  it("is held by Review everything, whatever the thread chose", async () => {
    const vault = new MemoryVault({});
    await vault.setAgentPolicy({ mode: "review", until: null, projects: {} });
    await useWorkspace.getState().connect({ client: vault });
    await useAgentMode.getState().load();
    const id = await turn("auto", view([file()]));
    await waitFor(() => expect(useChat.getState().threads[id]!.streaming).toBe(false));
    expect(chat.applied).toEqual([]);
    expect(useChat.getState().threads[id]!.changes).toBeDefined();
  });

  it("is held when one project is on Review", async () => {
    const vault = new MemoryVault({});
    await vault.setAgentPolicy({ mode: "balanced", until: null, projects: { thesis: "review" } });
    await useWorkspace.getState().connect({ client: vault });
    await useAgentMode.getState().load();
    const id = await turn("auto", view([file()]));
    await waitFor(() => expect(useChat.getState().threads[id]!.streaming).toBe(false));
    expect(chat.applied).toEqual([]);
  });
});
