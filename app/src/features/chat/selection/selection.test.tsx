// Selected text as context: the chip's lifecycle, the debounce, the three
// settings, "Add to chat" with its limit of five, and the sources that read the
// page, a PDF and a slide's text box (and the hook a LaTeX editor will use).

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../lib/store";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { reloadPanelPrefs, usePanelPrefs } from "../panel-prefs";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { chipKey, originOf } from "../thread";
import { addSelectionToChat } from "./add";
import { firstWords, MAX_KEPT, selectionChip } from "./chip";
import { registerBuiltinSources } from "./dom-sources";
import { currentSelection, registerSelectionSource, type SelectionSnapshot } from "./sources";
import { SELECTION_DELAY_MS, useSelectionContext } from "./use-selection";

let chat: Scripted;
const store = () => useChat.getState();

const snap = (text: string, over: Partial<SelectionSnapshot> = {}): SelectionSnapshot => ({ source: { kind: "page", path: "library/plan.md" }, text, title: "Plan", ...over });

beforeEach(async () => {
  localStorage.clear();
  reloadPanelPrefs();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  await store().loadProviders();
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const selections = (id: string) => store().threads[id]!.context.filter((c) => c.kind === "selection");

describe("the selection chip", () => {
  it("says the first words and the page, on one line", () => {
    const chip = selectionChip(snap("The   quick brown fox jumps over the lazy dog again and again"), false);
    expect(chip.label).toBe("Selection · “The quick brown fox jumps o…” · Plan");
    expect(firstWords("short")).toBe("short");
    expect(chip).toMatchObject({ kind: "selection", ref: [], origin: "auto", selection: { pinned: false, text: "The   quick brown fox jumps over the lazy dog again and again" } });
  });

  it("a new selection replaces the automatic one, and the same words are one chip", () => {
    const id = store().start();
    store().setSelection(id, selectionChip(snap("first selection"), false));
    store().setSelection(id, selectionChip(snap("second selection"), false));
    expect(selections(id).map((c) => c.selection!.text)).toEqual(["second selection"]);
    store().setSelection(id, selectionChip(snap("second selection"), false));
    expect(selections(id)).toHaveLength(1);
    // The page chip is not touched: the selection has rules of its own.
    store().followPage(id, { kind: "note", label: "Plan", ref: ["library/plan.md"] });
    store().followPage(id, { kind: "note", label: "Notes", ref: ["library/notes.md"] });
    expect(store().threads[id]!.context.map((c) => c.label)).toEqual(["Notes", "Selection · “second selection” · Plan"]);
  });

  it("stays when the selection collapses, until it is dismissed", () => {
    const id = store().start();
    store().setSelection(id, selectionChip(snap("keep me around"), false));
    // Nothing selected any more (a click into the box): the chip is still there.
    expect(currentSelection()).toBeNull();
    expect(selections(id)).toHaveLength(1);
    store().removeChip(id, chipKey(store().threads[id]!.context[0]!));
    expect(selections(id)).toHaveLength(0);
  });

  it("keeps up to five snippets with Add to chat, and the sixth is refused", () => {
    const id = store().start();
    for (let i = 1; i <= MAX_KEPT; i++) expect(store().keepSelection(id, selectionChip(snap(`snippet number ${i}`), true))).toBe(true);
    expect(selections(id).map(originOf)).toEqual(Array(MAX_KEPT).fill("added"));
    expect(store().keepSelection(id, selectionChip(snap("one too many"), true))).toBe(false);
    expect(selections(id)).toHaveLength(MAX_KEPT);
    // The same snippet again is already kept.
    expect(store().keepSelection(id, selectionChip(snap("snippet number 2"), true))).toBe(true);
    expect(selections(id)).toHaveLength(MAX_KEPT);
  });

  it("pinning the automatic chip keeps it, within the same five", () => {
    const id = store().start();
    for (let i = 1; i <= MAX_KEPT; i++) store().keepSelection(id, selectionChip(snap(`snippet number ${i}`), true));
    store().setSelection(id, selectionChip(snap("an automatic one"), false));
    const auto = selections(id).find((c) => originOf(c) === "auto")!;
    store().pinChip(id, chipKey(auto), true);
    // The five are full: it stays automatic and is replaced by the next selection.
    expect(selections(id).filter((c) => originOf(c) === "auto")).toHaveLength(1);
    // With room, pinning keeps it.
    store().removeChip(id, chipKey(selections(id)[0]!));
    store().pinChip(id, chipKey(auto), true);
    expect(selections(id).filter((c) => originOf(c) === "auto")).toHaveLength(0);
  });

  it("sends the automatic one once and drops it; kept ones go with the request and stay", async () => {
    const id = store().start();
    store().keepSelection(id, selectionChip(snap("a kept snippet", { heading: "Intro" }), true));
    store().setSelection(id, selectionChip(snap("what I am looking at"), false));
    await store().send(id, "What does this mean?");
    const sent = chat.requests[0]!.context.filter((c) => c.kind === "selection");
    expect(sent).toEqual([
      { kind: "selection", label: "Selection · “a kept snippet” · Plan", ref: [], selection: { source: { kind: "page", path: "library/plan.md" }, text: "a kept snippet", heading: "Intro", pinned: true } },
      { kind: "selection", label: "Selection · “what I am looking at” · Plan", ref: [], selection: { source: { kind: "page", path: "library/plan.md" }, text: "what I am looking at", pinned: false } },
    ]);
    expect(selections(id).map((c) => c.selection!.text)).toEqual(["a kept snippet"]);
    // The question remembers what it was asked about.
    const asked = store().threads[id]!.messages[0]!;
    expect(asked.role === "user" && asked.context.filter((c) => c.kind === "selection")).toHaveLength(2);
  });
});

describe("the setting and the debounce", () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));
  const select = (text: string) => void stops.push(registerSelectionSource("latex", () => (text ? snap(text, { source: { kind: "latex", path: "paper/main.tex" }, title: "main" }) : null)));

  it("adds the chip 250 ms after the selection settles, and only the last one", () => {
    vi.useFakeTimers();
    const id = store().start();
    renderHook(() => useSelectionContext(id));
    act(() => {
      select("first try");
      document.dispatchEvent(new Event("selectionchange"));
      vi.advanceTimersByTime(SELECTION_DELAY_MS - 50);
      select("second try, longer");
      document.dispatchEvent(new Event("selectionchange"));
      vi.advanceTimersByTime(SELECTION_DELAY_MS - 1);
    });
    expect(selections(id)).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(selections(id).map((c) => c.selection!.text)).toEqual(["second try, longer"]);
    expect(selections(id)[0]!.selection!.source).toEqual({ kind: "latex", path: "paper/main.tex" });
    // Collapsing leaves it; two characters are not a selection.
    act(() => {
      select("");
      document.dispatchEvent(new Event("selectionchange"));
      vi.advanceTimersByTime(SELECTION_DELAY_MS);
      select("ab");
      document.dispatchEvent(new Event("selectionchange"));
      vi.advanceTimersByTime(SELECTION_DELAY_MS);
    });
    expect(selections(id).map((c) => c.selection!.text)).toEqual(["second try, longer"]);
  });

  it("adds nothing by itself when the setting is only Add to chat, or never", () => {
    vi.useFakeTimers();
    select("some words");
    for (const mode of ["manual", "never"] as const) {
      usePanelPrefs.getState().set({ selectedText: mode });
      const id = store().start();
      const view = renderHook(() => useSelectionContext(id));
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
        vi.advanceTimersByTime(SELECTION_DELAY_MS * 2);
      });
      expect(selections(id)).toHaveLength(0);
      view.unmount();
    }
  });

  it("Add to chat works in every mode and opens the chat", () => {
    usePanelPrefs.getState().set({ selectedText: "never" });
    useShell.setState({ chatOpen: false });
    select("keep this one");
    expect(addSelectionToChat()).toBe(true);
    expect(useShell.getState().chatOpen).toBe(true);
    const id = store().active!;
    expect(selections(id)[0]).toMatchObject({ origin: "added", selection: { pinned: true, text: "keep this one" } });
  });

  it("Add to chat with nothing selected says so; with only the automatic chip left, it keeps that", () => {
    const toast = vi.fn();
    useWorkspace.setState({ toast });
    select("");
    expect(addSelectionToChat()).toBe(false);
    expect(toast).toHaveBeenCalledWith("Select some text first, then add it to the chat");
    const id = store().start({ open: true });
    store().setSelection(id, selectionChip(snap("selected before the palette opened"), false));
    expect(addSelectionToChat()).toBe(true);
    expect(selections(id).map(originOf)).toEqual(["added"]);
  });

  it("says when the chat holds five already", () => {
    const toast = vi.fn();
    useWorkspace.setState({ toast });
    const id = store().start({ open: true });
    for (let i = 1; i <= MAX_KEPT; i++) store().keepSelection(id, selectionChip(snap(`snippet number ${i}`), true));
    select("a sixth snippet");
    expect(addSelectionToChat()).toBe(false);
    expect(toast).toHaveBeenCalledWith(`The chat holds ${MAX_KEPT} snippets already. Remove one first`);
  });
});

describe("where selections come from", () => {
  function select(el: Element) {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.addRange(range);
  }

  beforeEach(() => registerBuiltinSources());

  it("reads a page in the focused pane, with the heading above it", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "page", path: "library/plan.md" })), notes: [{ path: "library/plan.md", title: "Plan" } as never] });
    document.body.innerHTML = `<div class="kasten-pane is-focused"><div class="kasten-page-editor"><div class="ProseMirror"><h2>Intro</h2><p id="a">Pack the tent.</p><p id="b">Check the poles.</p></div></div></div>`;
    select(document.getElementById("b")!);
    expect(currentSelection()).toEqual({ source: { kind: "page", path: "library/plan.md" }, text: "Check the poles.", heading: "Intro", title: "Plan" });
  });

  it("skips a page kept ready out of sight, and one in a pane that is not in focus", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "page", path: "library/plan.md" })), notes: [] });
    document.body.innerHTML = `<div class="kasten-pane is-focused" style="display:none"><div class="kasten-page-editor"><div class="ProseMirror"><p id="a">Hidden words.</p></div></div></div>`;
    select(document.getElementById("a")!);
    expect(currentSelection()).toBeNull();
    document.body.innerHTML = `<div class="kasten-pane"><div class="kasten-page-editor"><div class="ProseMirror"><p id="a">Other pane words.</p></div></div></div><div class="kasten-pane is-focused"></div>`;
    select(document.getElementById("a")!);
    expect(currentSelection()).toBeNull();
  });

  it("reads a page in the only pane, though nothing marks it as focused", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "page", path: "library/plan.md" })), notes: [{ path: "library/plan.md", title: "Plan" } as never] });
    document.body.innerHTML = `<div class="kasten-pane"><div class="kasten-page-editor"><div class="ProseMirror"><p id="a">Alone in the window.</p></div></div></div>`;
    select(document.getElementById("a")!);
    expect(currentSelection()).toMatchObject({ source: { kind: "page", path: "library/plan.md" }, text: "Alone in the window." });
  });

  it("reads a PDF page, naming the page number", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "highlights", path: "papers/loops.pdf" })) });
    document.body.innerHTML = `<div class="kasten-reader"><div class="kasten-pdf-page" data-page="3"><span id="w">agents call tools in a loop</span></div></div>`;
    select(document.getElementById("w")!);
    expect(currentSelection()).toEqual({ source: { kind: "pdf", path: "papers/loops.pdf", id: "3" }, text: "agents call tools in a loop", title: "loops" });
  });

  it("reads the words selected in a slide's open text box", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "slides", path: "library/talk.deck" })) });
    document.body.innerHTML = `<div class="ks-text-layer" data-editing="el7"><div contenteditable="true"><span id="w">The loop</span></div></div>`;
    select(document.getElementById("w")!);
    expect(currentSelection()).toEqual({ source: { kind: "slide", path: "library/talk.deck", id: "el7" }, text: "The loop", title: "talk" });
  });

  it("names the slide the open text box is on, by its number, in the heading and in the chip", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "slides", path: "library/talk.deck" })) });
    document.body.innerHTML = `<div class="ks-stage" data-slide="s-9" data-slide-number="4"><div class="ks-text-layer" data-editing="el7"><div contenteditable="true"><span id="w">The loop</span></div></div></div>`;
    select(document.getElementById("w")!);
    const found = currentSelection()!;
    expect(found).toEqual({ source: { kind: "slide", path: "library/talk.deck", id: "el7" }, text: "The loop", heading: "Slide 4", title: "talk, slide 4" });
    // What the model is sent: the deck, the text box and the slide number, with the words.
    const chip = selectionChip(found, false);
    expect(chip.label).toBe("Selection · “The loop” · talk, slide 4");
    expect(chip.selection).toMatchObject({ source: { kind: "slide", path: "library/talk.deck", id: "el7" }, heading: "Slide 4", text: "The loop" });
  });

  it("is not offered for words selected on a slide that is only shown, or in a box that is not open", () => {
    useWorkspace.setState({ ...derive(initialLayout({ view: "slides", path: "library/talk.deck" })) });
    document.body.innerHTML = `<div class="ks-stage" data-slide-number="2"><div class="ks-text-layer"><span id="w">Only shown</span></div></div>`;
    select(document.getElementById("w")!);
    expect(currentSelection()).toBeNull();
  });

  it("asks a LaTeX editor's own source once it registers one", () => {
    const stop = registerSelectionSource("latex", () => snap("\\begin{align}", { source: { kind: "latex", path: "paper/main.tex" }, range: { from: 10, to: 23 }, title: "main" }));
    expect(currentSelection()).toMatchObject({ source: { kind: "latex" }, range: { from: 10, to: 23 } });
    stop();
    expect(currentSelection()).toBeNull();
  });
});
