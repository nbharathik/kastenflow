// Home's capture field: Enter keeps a thought, a web address is clipped, and
// "/" at the start lists what Home can start instead.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import type { NoteFile, NoteMeta, VaultClient } from "../../lib/vault/types";
import { usePlugins } from "../../plugins/registry";
import { useBoards } from "../boards/store";
import { useDecks } from "../slides/store";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { CaptureBar } from "./CaptureBar";

const meta = (title: string): NoteMeta => ({
  path: `inbox/${title.toLowerCase().replace(/\W+/g, "-")}.md`,
  id: null,
  title,
  kind: "card",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: Date.now(),
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
});
const file = (title: string): NoteFile => ({ meta: meta(title), text: "", hash: "h" });

const capture = vi.fn(async (markdown: string) => file(markdown.split("\n")[0]!));
const clipUrl = vi.fn(async (url: string) => file(url));

function setup(kind = "memory") {
  useWorkspace.setState({ client: { kind, capture, clipUrl } as unknown as VaultClient, notes: [], ...derive(initialLayout()), toasts: [], stack: [], stackOpen: false });
  render(<CaptureBar />);
  return screen.getByRole("textbox", { name: "Quick note" }) as HTMLTextAreaElement;
}

const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });
const options = () => within(screen.getByRole("listbox", { name: "Actions" })).getAllByRole("option");

beforeEach(async () => {
  // "New diagram" is the diagrams plugin's, which is on unless the person turned it off.
  await usePlugins.getState().enable("diagrams");
  // "New smart page" is offered once the person has turned smart pages on (they start off).
  usePlugins.setState({ on: { smart: true } });
  capture.mockClear();
  clipUrl.mockClear();
  useShell.setState({ paletteOpen: false, gallery: null });
  useDecks.setState({ creating: false, draftProject: null });
  useBoards.setState({ creating: false, draftProject: null });
});
afterEach(() => {
  cleanup();
  usePlugins.getState().disable("diagrams");
  usePlugins.setState({ on: {} });
});

describe("the capture field", () => {
  it("invites a thought, or a slash for actions", () => {
    const box = setup();
    expect(box.placeholder).toBe("Capture a thought, or type / for actions");
    expect(box.hasAttribute("data-capture-box")).toBe(true);
  });

  it("keeps what you typed in the Inbox with Enter, and empties the field", async () => {
    const box = setup();
    type(box, "Call the printer");
    await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
    expect(capture).toHaveBeenCalledWith("Call the printer", [], null);
    await waitFor(() => expect(box.value).toBe(""));
    expect(useWorkspace.getState().toasts.some((t) => t.text.includes("Saved “Call the printer” to the Inbox"))).toBe(true);
  });

  it("starts a new line with Shift+Enter instead of saving", () => {
    const box = setup();
    type(box, "One");
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(capture).not.toHaveBeenCalled();
  });

  it("keeps it and opens it with Ctrl+Enter", async () => {
    const box = setup();
    type(box, "Plan the week");
    await act(async () => void fireEvent.keyDown(box, { key: "Enter", ctrlKey: true }));
    await waitFor(() => expect(useWorkspace.getState().place).toEqual({ view: "page", path: "inbox/plan-the-week.md" }));
  });

  it("keeps a thought that was not saved, to try again", async () => {
    capture.mockRejectedValueOnce(new Error("The vault is read-only"));
    const box = setup();
    type(box, "Keep me");
    await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.value).toBe("Keep me");
  });

  it("clips a web address as a page in the desktop app", async () => {
    const box = setup("vault");
    type(box, "https://example.com/article");
    const clip = screen.getByRole("button", { name: "Clip the page" });
    await act(async () => void fireEvent.click(clip));
    expect(clipUrl).toHaveBeenCalledWith("https://example.com/article");
    expect(capture).not.toHaveBeenCalled();
  });

  it("keeps a web address as a thought where there is no desktop app to clip it", async () => {
    const box = setup("memory");
    type(box, "https://example.com/article");
    expect(screen.queryByRole("button", { name: "Clip the page" })).toBeNull();
    await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
    expect(capture).toHaveBeenCalled();
  });
});

describe("a slash at the start", () => {
  it("lists what Home can start, and narrows as you type", () => {
    const box = setup();
    expect(screen.queryByRole("listbox", { name: "Actions" })).toBeNull();
    type(box, "/");
    expect(options().map((o) => o.textContent?.replace(/Ctrl.*|Alt.*/, ""))).toEqual([
      "New page",
      "Quick note",
      "Today's journal",
      "From a template",
      "New deck",
      "New whiteboard",
      "New smart page",
      "Smart page: Dashboard",
      "Smart page: Tracker",
      "Smart page: Gallery",
      "Smart page: Map",
      "Smart page: Timeline",
      "Smart page: more…",
      "New diagram",
      "Search",
    ]);
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(box.getAttribute("aria-controls")).toBe(screen.getByRole("listbox", { name: "Actions" }).id);
    type(box, "/DEC");
    expect(options().map((o) => o.textContent)).toEqual(["New deck"]);
    type(box, "/draw");
    expect(options().map((o) => o.textContent)).toEqual(["New diagram"]);
  });

  it("moves with the arrows and runs one with Enter, emptying the field", () => {
    const box = setup();
    type(box, "/new");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(box.getAttribute("aria-activedescendant")).toBe(options()[1]!.id);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(options().at(-1)!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("");
    expect(screen.queryByRole("listbox", { name: "Actions" })).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    expect(useWorkspace.getState().place.view).toBe("home");
  });

  it("starts a deck, a whiteboard and a template choice", () => {
    const box = setup();
    type(box, "/deck");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useWorkspace.getState().place).toEqual({ view: "slides" });
    expect(useDecks.getState().creating).toBe(true);
    type(box, "/whiteboard");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useWorkspace.getState().place).toEqual({ view: "boards" });
    expect(useBoards.getState().creating).toBe(true);
    type(box, "/template");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useShell.getState().gallery).not.toBeNull();
  });

  it("runs an action picked with the pointer, and Escape closes the list and empties the field", () => {
    const box = setup();
    type(box, "/search");
    fireEvent.mouseDown(options()[0]!);
    expect(useShell.getState().paletteOpen).toBe(true);
    type(box, "/");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("");
    expect(screen.queryByRole("listbox", { name: "Actions" })).toBeNull();
  });

  it("is only a thought when it names no action", async () => {
    const box = setup();
    type(box, "/usr/local/bin is where it lives");
    expect(screen.queryByRole("listbox", { name: "Actions" })).toBeNull();
    await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
    expect(capture).toHaveBeenCalledWith("/usr/local/bin is where it lives", [], null);
  });
});
