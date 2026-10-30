// Sharing the selection with a client that asked: nothing is told until the app
// says a client has asked; then what the chat holds as selected text (kept to
// the page in front) is told at once and again when it changes, cleared when
// there is none, and left alone the moment the app says to stop. The chat panel
// says so for as long as it goes on.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat } from "../test-kit";
import { chipKey, type Chip } from "../thread";
import { ContextChips } from "../view/ContextChips";
import { selectionChip } from "./chip";
import { SHARE_DELAY_MS } from "./share";
import { useSelectionShare, useSharing, WATCH_EVENT } from "./sharing";
import type { SelectionSnapshot } from "./sources";

vi.mock("@tauri-apps/api/core", async (original) => ({ ...(await original<typeof import("@tauri-apps/api/core")>()), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../../lib/api", async (original) => ({ ...(await original<typeof import("../../../lib/api")>()), inTauri: () => true }));

const store = () => useChat.getState();
const handlers = new Map<string, (event: { payload: unknown }) => void>();
let watching = false;

/** The calls the window made to tell the app what is selected. */
const told = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "selection_publish").map(([, args]) => (args as { snippets: Record<string, unknown>[] }).snippets);

const snap = (text: string, over: Partial<SelectionSnapshot> = {}): SelectionSnapshot => ({ source: { kind: "page", path: "library/plan.md" }, text, title: "Plan", ...over });

/** The app says a client has asked (or has stopped). */
const say = (on: boolean) => act(async () => handlers.get(WATCH_EVENT)?.({ payload: { on } }));

/** A chat with a thread, and the plan page in front. */
function open() {
  const id = store().start();
  useChat.setState({ active: id });
  useWorkspace.setState({ ...derive(initialLayout({ view: "page", path: "library/plan.md" })), notes: [{ path: "library/plan.md", title: "Plan" } as never] });
  return id;
}

beforeEach(() => {
  resetChat(scriptedChat([CLAUDE]));
  handlers.clear();
  watching = false;
  useSharing.setState({ shared: false });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command: string) => (command === "selection_watching" ? watching : command === "selection_publish" ? true : undefined));
  vi.mocked(listen).mockImplementation((async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }) as never);
});
afterEach(cleanup);

describe("sharing the selection with a connected client", () => {
  it("tells the app nothing until a client has asked", async () => {
    const id = open();
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    act(() => store().setSelection(id, selectionChip(snap("a private thought"), false)));
    await new Promise((done) => setTimeout(done, SHARE_DELAY_MS * 2));
    expect(told()).toEqual([]);
    expect(useSharing.getState().shared).toBe(false);
  });

  it("tells what is selected at once when a client asks, with the file, the heading and the place", async () => {
    const id = open();
    act(() => store().setSelection(id, selectionChip(snap("the words I selected", { heading: "Method", range: { from: 10, to: 30 } }), false)));
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    await say(true);
    await waitFor(() => expect(told()).toHaveLength(1));
    expect(told()[0]).toEqual([{ kind: "page", path: "library/plan.md", title: "Plan", heading: "Method", range: { from: 10, to: 30 }, text: "the words I selected" }]);
    expect(useSharing.getState().shared).toBe(true);
  });

  it("tells a change after it settles, once, and an empty list when nothing is selected any more", async () => {
    const id = open();
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    await say(true);
    await waitFor(() => expect(told()).toEqual([[]]));
    act(() => {
      store().setSelection(id, selectionChip(snap("first try"), false));
      store().setSelection(id, selectionChip(snap("second try, longer"), false));
    });
    await waitFor(() => expect(told()).toHaveLength(2), { timeout: 2000 });
    expect(told()[1]!.map((s) => s.text)).toEqual(["second try, longer"]);
    // Something that changes nothing about it is not told again.
    act(() => useWorkspace.setState({ toast: vi.fn() }));
    await new Promise((done) => setTimeout(done, SHARE_DELAY_MS * 2));
    expect(told()).toHaveLength(2);
    // The chip is dismissed: nothing is selected, and the app is told so.
    const chip = store().threads[id]!.context.find((c) => c.kind === "selection")!;
    act(() => store().removeChip(id, chipKey(chip)));
    await waitFor(() => expect(told()).toHaveLength(3), { timeout: 2000 });
    expect(told()[2]).toEqual([]);
  });

  it("shares only what is in the page in front: a chip for another page is left out", async () => {
    const id = open();
    act(() => {
      store().keepSelection(id, selectionChip(snap("from the plan"), true));
      store().keepSelection(id, selectionChip(snap("from another page", { source: { kind: "page", path: "library/notes.md" }, title: "Notes" }), true));
    });
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    await say(true);
    await waitFor(() => expect(told()).toHaveLength(1));
    expect(told()[0]!.map((s) => s.text)).toEqual(["from the plan"]);
    // In a PDF the page number is the place; in a LaTeX file the file's name is the title.
    act(() => {
      useWorkspace.setState({ ...derive(initialLayout({ view: "highlights", path: "papers/loops.pdf" })) });
      store().keepSelection(id, selectionChip(snap("agents call tools", { source: { kind: "pdf", path: "papers/loops.pdf", id: "3" }, title: "loops" }), true));
    });
    await waitFor(() => expect(told()).toHaveLength(2), { timeout: 2000 });
    expect(told()[1]).toEqual([{ kind: "pdf", path: "papers/loops.pdf", title: "loops", heading: "Page 3", text: "agents call tools" }]);
  });

  it("names the slide in front and the elements selected on it", async () => {
    const id = open();
    useWorkspace.setState({ ...derive(initialLayout({ view: "slides", path: "library/talk.deck" })) });
    const slide: Chip = { kind: "slide", label: "Slide 2: The loop · 2 selected", ref: ["library/talk.deck", "s2", "e1", "e2"] };
    useChat.setState((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id]!, bound: { kind: "deck", path: "library/talk.deck" }, context: [slide] } } }));
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    await say(true);
    await waitFor(() => expect(told()).toHaveLength(1));
    expect(told()[0]).toEqual([{ kind: "slide", path: "library/talk.deck", title: "talk", heading: "Slide 2: The loop", elements: ["e1", "e2"], text: "" }]);
    // A slide with nothing selected on it shares nothing.
    useChat.setState((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id]!, context: [{ ...slide, label: "Slide 2: The loop", ref: ["library/talk.deck", "s2"] }] } } }));
    await waitFor(() => expect(told()).toHaveLength(2), { timeout: 2000 });
    expect(told()[1]).toEqual([]);
  });

  it("shares five pieces at most", async () => {
    const id = open();
    act(() => {
      for (let i = 1; i <= 5; i++) store().keepSelection(id, selectionChip(snap(`snippet number ${i}`), true));
      store().setSelection(id, selectionChip(snap("an automatic sixth"), false));
    });
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    await say(true);
    await waitFor(() => expect(told()).toHaveLength(1));
    expect(told()[0]).toHaveLength(5);
  });

  it("is asked again while it goes on: it tells again at once, and stops when the app says to", async () => {
    const id = open();
    act(() => store().setSelection(id, selectionChip(snap("steady words"), false)));
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    await say(true);
    await waitFor(() => expect(told()).toHaveLength(1));
    await say(true);
    await waitFor(() => expect(told()).toHaveLength(2));
    expect(told()[1]).toEqual(told()[0]);
    // The app stops sharing (two minutes with no ask): the line goes and nothing more is told.
    await say(false);
    expect(useSharing.getState().shared).toBe(false);
    act(() => store().setSelection(id, selectionChip(snap("after it stopped"), false)));
    await new Promise((done) => setTimeout(done, SHARE_DELAY_MS * 2));
    expect(told()).toHaveLength(2);
  });

  it("learns of a client that asked before this window opened, and drops the line when the app refuses", async () => {
    open();
    watching = true;
    renderHook(() => useSelectionShare());
    await waitFor(() => expect(useSharing.getState().shared).toBe(true));
    await waitFor(() => expect(told()).toHaveLength(1));
    // The app says it is not sharing (it lapsed meanwhile): the line goes.
    vi.mocked(invoke).mockImplementation(async (command: string) => command === "selection_publish" ? false : undefined);
    await say(true);
    await waitFor(() => expect(useSharing.getState().shared).toBe(false));
  });

  it("stops when the window goes", async () => {
    const id = open();
    const view = renderHook(() => useSelectionShare());
    await waitFor(() => expect(handlers.has(WATCH_EVENT)).toBe(true));
    await say(true);
    await waitFor(() => expect(told()).toHaveLength(1));
    view.unmount();
    expect(handlers.has(WATCH_EVENT)).toBe(false);
    expect(useSharing.getState().shared).toBe(false);
    act(() => store().setSelection(id, selectionChip(snap("too late"), false)));
    await new Promise((done) => setTimeout(done, SHARE_DELAY_MS * 2));
    expect(told()).toHaveLength(1);
  });
});

describe("the line in the chat panel", () => {
  it("says a client is connected while the selection is shared, in plain words, and not otherwise", () => {
    const id = open();
    const thread = store().threads[id]!;
    const view = render(<ContextChips thread={thread} page={null} />);
    expect(screen.queryByText("Shared with a connected client")).toBeNull();
    act(() => useSharing.setState({ shared: true }));
    const line = screen.getByText("Shared with a connected client");
    expect(line.getAttribute("role")).toBe("status");
    act(() => useSharing.setState({ shared: false }));
    expect(screen.queryByText("Shared with a connected client")).toBeNull();
    view.unmount();
  });
});
