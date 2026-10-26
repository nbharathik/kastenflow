// What the chat is about as tabs change: the chip follows decks, whiteboards,
// diagrams and LaTeX documents too (not just pages); the three ways of
// "When I switch pages"; ties following a rename or a move; and the one-time
// import of the old deck-to-chat map.

import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useBoards } from "../../boards/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout, type Place } from "../../workspace/tabs";
import { ChatDock } from "../ChatDock";
import { activePath, activeTarget, targetOf, useActiveTarget } from "../open-pages";
import { reloadPanelPrefs, usePanelPrefs } from "../panel-prefs";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { migrateDeckBindings } from "./migrate";
import { rebindChats } from "./moves";
import { bindingOf, followChip } from "./target";
import { useSwitchMode } from "./use-switch-mode";

let chat: Scripted;
const store = () => useChat.getState();

const NOTES = [
  { path: "library/plan.md", id: "n-plan", title: "Plan", kind: "page" },
  { path: "library/notes.md", id: "n-notes", title: "Notes", kind: "page" },
] as never[];

/** Puts `place` in the focused pane. */
const goTo = (place: Place) => act(() => void useWorkspace.setState({ ...derive(initialLayout(place)), notes: NOTES }));
const page = (path: string): Place => ({ view: "page", path });

beforeEach(async () => {
  localStorage.clear();
  reloadPanelPrefs();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  await store().loadProviders();
  useWorkspace.setState({ ...derive(initialLayout(page("library/plan.md"))), notes: NOTES });
});
afterEach(cleanup);

describe("what is in front", () => {
  it("knows pages, decks, whiteboards, diagrams and LaTeX documents, and nothing else", () => {
    expect(targetOf(page("library/plan.md"))).toEqual({ kind: "page", path: "library/plan.md" });
    expect(targetOf({ view: "journal", path: "journal/2026-10-22.md" })).toEqual({ kind: "page", path: "journal/2026-10-22.md" });
    expect(targetOf({ view: "slides", path: "library/talk.deck" })).toEqual({ kind: "deck", path: "library/talk.deck" });
    expect(targetOf({ view: "boards", path: "boards/ideas.canvas" })).toEqual({ kind: "board", path: "boards/ideas.canvas" });
    expect(targetOf({ view: "plugin:diagrams", path: "diagrams/flow.drawio" })).toEqual({ kind: "diagram", path: "diagrams/flow.drawio" });
    expect(targetOf({ view: "plugin:latex", path: "paper/main.tex" })).toEqual({ kind: "latex", path: "paper/main.tex" });
    expect(targetOf({ view: "plugin:latex", path: "paper/refs.bib" })).toEqual({ kind: "latex", path: "paper/refs.bib" });
    expect(targetOf({ view: "plugin:latex", path: "paper/notes.txt" })).toBeNull();
    expect(targetOf({ view: "plugin:latex" })).toBeNull();
    expect(targetOf({ view: "trash" })).toBeNull();
    expect(targetOf({ view: "slides" })).toBeNull();
    expect(targetOf({ view: "highlights", path: "papers/x.pdf" })).toBeNull();
  });

  it("names the page in front, or the LaTeX file in front, and nothing else", async () => {
    expect(activePath()).toBe("library/plan.md");
    await goTo({ view: "plugin:latex", path: "paper/main.tex" });
    expect(activePath()).toBe("paper/main.tex");
    await goTo({ view: "slides", path: "library/talk.deck" });
    expect(activePath()).toBeNull();
    await goTo({ view: "plugin:diagrams", path: "diagrams/flow.drawio" });
    expect(activePath()).toBeNull();
  });

  it("makes the chip each kind follows, and ties a page by its id", () => {
    const boards = [{ path: "boards/ideas.canvas", title: "Ideas" }];
    expect(followChip({ kind: "page", path: "library/plan.md" }, NOTES, boards)).toEqual({ kind: "note", label: "Plan", ref: ["library/plan.md"] });
    expect(followChip({ kind: "page", path: "library/missing.md" }, NOTES, boards)).toBeNull();
    expect(followChip({ kind: "deck", path: "library/talk.deck" }, NOTES, boards)).toEqual({ kind: "deck", label: "talk", ref: ["library/talk.deck"] });
    expect(followChip({ kind: "board", path: "boards/ideas.canvas" }, NOTES, boards)).toEqual({ kind: "board", label: "Ideas", ref: ["boards/ideas.canvas"] });
    expect(followChip({ kind: "diagram", path: "diagrams/flow.drawio" }, NOTES, boards)).toEqual({ kind: "diagram", label: "flow", ref: ["diagrams/flow.drawio"] });
    expect(followChip({ kind: "latex", path: "paper/main.tex" }, NOTES, boards)).toEqual({ kind: "latex", label: "main.tex", ref: ["paper/main.tex"] });
    expect(followChip({ kind: "latex", path: "paper/sections/intro.tex" }, NOTES, boards)).toEqual({ kind: "latex", label: "intro.tex", ref: ["paper/sections/intro.tex"] });
    expect(bindingOf({ kind: "page", path: "library/plan.md" }, NOTES)).toEqual({ kind: "page", path: "library/plan.md", id: "n-plan" });
    expect(bindingOf({ kind: "deck", path: "library/talk.deck" }, NOTES)).toEqual({ kind: "deck", path: "library/talk.deck" });
    expect(activeTarget()).toEqual({ kind: "page", path: "library/plan.md" });
  });
});

describe("the dock's chip follows every kind of tab", () => {
  function chips() {
    const group = screen.getByRole("group", { name: "Context" });
    return [...group.querySelectorAll(".kasten-chat-chip-label")].map((c) => c.textContent);
  }

  it("no stale page chip on a deck, whiteboard, diagram or LaTeX tab", async () => {
    useBoards.setState({ list: [{ path: "boards/ideas.canvas", title: "Ideas" } as never] });
    render(<ChatDock />);
    await expect.poll(chips).toEqual(["Plan"]);
    await goTo({ view: "slides", path: "library/talk.deck" });
    await expect.poll(chips).toEqual(["talk"]);
    await goTo({ view: "boards", path: "boards/ideas.canvas" });
    await expect.poll(chips).toEqual(["Ideas"]);
    await goTo({ view: "plugin:diagrams", path: "diagrams/flow.drawio" });
    await expect.poll(chips).toEqual(["flow"]);
    // A LaTeX file has a chip of its own (its file), and the diagram's does not stay for it.
    await goTo({ view: "plugin:latex", path: "paper/main.tex" });
    await expect.poll(chips).toEqual(["main.tex"]);
    // Another file of the document: the chip follows to it.
    await goTo({ view: "plugin:latex", path: "paper/sections/intro.tex" });
    await expect.poll(chips).toEqual(["intro.tex"]);
    await goTo(page("library/notes.md"));
    await expect.poll(chips).toEqual(["Notes"]);
    // A view that is none of these leaves the chip alone.
    await goTo({ view: "settings" });
    await act(async () => {});
    expect(chips()).toEqual(["Notes"]);
  });

  it("sends the LaTeX chip with the message, tied to the file", async () => {
    render(<ChatDock />);
    await goTo({ view: "plugin:latex", path: "paper/main.tex" });
    await expect.poll(chips).toEqual(["main.tex"]);
    await store().send(store().active!, "Why does it not build?");
    expect(chat.requests[0]!.context).toEqual([{ kind: "latex", label: "main.tex", ref: ["paper/main.tex"] }]);
    expect(bindingOf({ kind: "latex", path: "paper/main.tex" }, NOTES)).toEqual({ kind: "latex", path: "paper/main.tex" });
  });

  it("sends the deck chip with the message", async () => {
    render(<ChatDock />);
    await goTo({ view: "slides", path: "library/talk.deck" });
    await expect.poll(chips).toEqual(["talk"]);
    await store().send(store().active!, "Tighten the titles");
    expect(chat.requests[0]!.context).toEqual([{ kind: "deck", label: "talk", ref: ["library/talk.deck"] }]);
  });
});

/** Runs the hook for the page in front, as the dock does. */
function Probe() {
  useSwitchMode(useActiveTarget());
  return null;
}

describe("When I switch pages: keep this chat", () => {
  it("does nothing: one chat, no search for a tied one", async () => {
    render(<Probe />);
    const id = store().start({ open: true });
    await goTo(page("library/notes.md"));
    await act(async () => {});
    expect(store().active).toBe(id);
    expect(store().order).toEqual([id]);
    expect(chat.ties).toEqual({});
  });
});

describe("When I switch pages: use that page's chat", () => {
  beforeEach(() => usePanelPrefs.getState().set({ onSwitch: "bound" }));

  it("shows the chat tied to the page in front, and switches with the tab", async () => {
    chat.threadList = [
      { id: "plan-chat", title: "About the plan", updated: 2, status: "idle", provider: "Claude", model: "m", bound: { kind: "page", path: "library/plan.md", id: "n-plan" } },
      { id: "notes-chat", title: "About the notes", updated: 1, status: "idle", provider: "Claude", model: "m", bound: { kind: "page", path: "library/notes.md", id: "n-notes" } },
    ];
    chat.ties["plan-chat"] = { kind: "page", path: "library/plan.md", id: "n-plan" };
    chat.ties["notes-chat"] = { kind: "page", path: "library/notes.md", id: "n-notes" };
    for (const [id, title] of [["plan-chat", "About the plan"], ["notes-chat", "About the notes"]] as const) {
      chat.loads[id] = { ui: { v: 1, messages: [{ id: "m1", role: "user", text: title, context: [] }] }, status: "idle", seq: 1, plan: [], title, provider: "Claude", model: "m", queued: [] };
    }
    render(<Probe />);
    await waitFor(() => expect(store().active).toBe("plan-chat"));
    await goTo(page("library/notes.md"));
    await waitFor(() => expect(store().active).toBe("notes-chat"));
    await goTo(page("library/plan.md"));
    await waitFor(() => expect(store().active).toBe("plan-chat"));
  });

  it("makes a chat for a page that has none, and ties it with the first message", async () => {
    render(<Probe />);
    await waitFor(() => expect(store().active).not.toBeNull());
    const id = store().active!;
    // Nothing is tied yet: a chat with nothing in it is not saved.
    expect(chat.ties).toEqual({});
    await store().send(id, "What is this plan about?");
    await waitFor(() => expect(chat.ties[id]).toEqual({ kind: "page", path: "library/plan.md", id: "n-plan" }));
    expect(store().threads[id]!.bound).toEqual({ kind: "page", path: "library/plan.md", id: "n-plan" });
  });

  it("gives the next page without a chat a new one, leaving the first page's chat as it was", async () => {
    render(<Probe />);
    await waitFor(() => expect(store().active).not.toBeNull());
    const first = store().active!;
    await store().send(first, "About the plan");
    await waitFor(() => expect(chat.ties[first]).toBeTruthy());
    await goTo(page("library/notes.md"));
    await waitFor(() => expect(store().active).not.toBe(first));
    const second = store().active!;
    await store().send(second, "About the notes");
    await waitFor(() => expect(chat.ties[second]).toMatchObject({ path: "library/notes.md" }));
    expect(chat.ties[first]).toMatchObject({ path: "library/plan.md" });
    expect(store().threads[first]!.messages).toHaveLength(2);
  });

  it("uses an empty chat instead of piling up new ones", async () => {
    render(<Probe />);
    await waitFor(() => expect(store().active).not.toBeNull());
    const empty = store().active!;
    await goTo(page("library/notes.md"));
    await act(async () => {});
    expect(store().active).toBe(empty);
    expect(store().order).toEqual([empty]);
    await store().send(empty, "Hello");
    await waitFor(() => expect(chat.ties[empty]).toMatchObject({ path: "library/notes.md" }));
  });

  it("follows decks too", async () => {
    chat.threadList = [{ id: "deck-chat", title: "The talk", updated: 1, status: "idle", provider: "Claude", model: "m", bound: { kind: "deck", path: "library/talk.deck" } }];
    chat.ties["deck-chat"] = { kind: "deck", path: "library/talk.deck" };
    chat.loads["deck-chat"] = { ui: null, status: "idle", seq: 0, plan: [], title: "The talk", provider: "Claude", model: "m", queued: [] };
    render(<Probe />);
    await goTo({ view: "slides", path: "library/talk.deck" });
    await waitFor(() => expect(store().active).toBe("deck-chat"));
  });
});

describe("When I switch pages: start a new chat", () => {
  beforeEach(() => usePanelPrefs.getState().set({ onSwitch: "new" }));

  it("starts one for each page opened, and not for the first page or an empty chat", async () => {
    render(<Probe />);
    const first = store().start({ open: true });
    await act(async () => {});
    await goTo(page("library/notes.md"));
    // The chat has nothing in it: it is new enough.
    expect(store().active).toBe(first);
    await store().send(first, "About the plan");
    await goTo(page("library/plan.md"));
    await waitFor(() => expect(store().active).not.toBe(first));
    const second = store().active!;
    expect(store().threads[second]!.messages).toHaveLength(0);
    expect(store().threads[first]!.messages).toHaveLength(2);
    // Coming back to the same tab again (same page) does not start another.
    await goTo(page("library/plan.md"));
    await act(async () => {});
    expect(store().order).toHaveLength(2);
  });
});

describe("ties follow a rename or a move", () => {
  it("tells the backend which paths moved, and reads the ties again", async () => {
    chat.threadList = [{ id: "plan-chat", title: "About the plan", updated: 2, status: "idle", provider: "Claude", model: "m", bound: { kind: "page", path: "library/plan.md" } }];
    await store().loadSaved();
    expect(await rebindChats(new Map([["library/plan.md", "projects/plan.md"], ["a.md", "a.md"]]))).toBe(1);
    expect(chat.rebinds).toEqual([[{ from: "library/plan.md", to: "projects/plan.md" }]]);
    expect(await rebindChats(new Map())).toBe(0);
    expect(chat.rebinds).toHaveLength(1);
  });

  it("is called from the workspace's one hook for moved paths", async () => {
    await useWorkspace.getState().connect({ client: new MemoryVault({}) });
    useWorkspace.getState().followMoves(new Map([["library/plan.md", "projects/plan.md"]]));
    await waitFor(() => expect(chat.rebinds).toEqual([[{ from: "library/plan.md", to: "projects/plan.md" }]]));
  });
});

describe("the old deck-to-chat map", () => {
  it("is imported once, and not again once it went", async () => {
    localStorage.setItem("kasten.chat.decks", JSON.stringify({ "library/talk.deck": "chat-old", "library/bad.deck": 7 }));
    expect(await migrateDeckBindings(chat)).toBe(true);
    expect(chat.imports).toEqual([{ "library/talk.deck": "chat-old" }]);
    expect(await migrateDeckBindings(chat)).toBe(false);
    expect(chat.imports).toHaveLength(1);
  });

  it("is tried again next run when it failed, and counts as done when there is nothing to hand over", async () => {
    localStorage.setItem("kasten.chat.decks", JSON.stringify({ "library/talk.deck": "chat-old" }));
    const asked = chat.importBindings;
    chat.importBindings = async () => {
      throw new Error("No vault is open");
    };
    expect(await migrateDeckBindings(chat)).toBe(false);
    chat.importBindings = asked;
    expect(await migrateDeckBindings(chat)).toBe(true);
    localStorage.clear();
    expect(await migrateDeckBindings(chat)).toBe(false);
    localStorage.setItem("kasten.chat.decks", "not json");
    expect(await migrateDeckBindings(chat)).toBe(false);
    expect(chat.imports).toHaveLength(1);
  });

  it("is sent once when asked for together", async () => {
    localStorage.setItem("kasten.chat.decks", JSON.stringify({ "library/talk.deck": "chat-old" }));
    await Promise.all([migrateDeckBindings(chat), migrateDeckBindings(chat)]);
    expect(chat.imports).toHaveLength(1);
  });
});

describe("hooks", () => {
  it("a switch to the same target does not act twice", async () => {
    usePanelPrefs.getState().set({ onSwitch: "bound" });
    const view = renderHook(() => useSwitchMode({ kind: "page", path: "library/plan.md" }));
    await waitFor(() => expect(store().active).not.toBeNull());
    const only = store().order.length;
    view.rerender();
    await act(async () => {});
    expect(store().order).toHaveLength(only);
    expect(within(document.body).queryAllByRole("alert")).toHaveLength(0);
  });
});
