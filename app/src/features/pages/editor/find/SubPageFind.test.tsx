// The find bar's options and its "+ sub-pages" scope: results by page, opening a
// result, and replacing across pages from the preview.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMatches } from "../../../../lib/vault/types";
import { useTestEditor } from "../../../../test/editor";
import { FindBar, type FindOpen } from "./FindBar";
import { clearFind, findState } from "./find";
import type { SubPageFind } from "./sub-pages";

const editor = useTestEditor();

const page = (path: string, count: number, extra: Partial<NoteMatches> = {}): NoteMatches => ({
  path,
  title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  hash: `hash-${path}`,
  count,
  samples: count > 0 ? [{ line: 3, before: "see the ", text: "plan", after: " for details" }] : [],
  titleHit: false,
  locked: false,
  ...extra,
});

const PAGES = [page("trip.md", 4), page("trip/packing.md", 5), page("trip/notes.md", 3), page("trip/title-only.md", 0, { titleHit: true }), page("trip/locked.md", 2, { locked: true })];

function scope(pages: NoteMatches[] = PAGES): SubPageFind & { find: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> } {
  return {
    find: vi.fn(async () => pages),
    replace: vi.fn(async () => ({ commit: "c0ffee", notes: [["trip.md", 4] as [string, number]], total: 12 })),
    open: vi.fn(),
    openMenu: vi.fn(() => true),
    rename: vi.fn(),
  };
}

const OPEN: FindOpen = { replace: false, seed: "", opened: 1 };
let onClose = vi.fn();

function bar(subPages?: SubPageFind, find: FindOpen = OPEN) {
  render(<FindBar view={editor.view} find={find} onClose={onClose} subPages={subPages} />);
  return screen.getByRole("search", { name: "Find in page" });
}
const type = async (text: string, label = "Find in page") => act(async () => void fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value: text } }));

beforeEach(() => {
  localStorage.clear();
  onClose = vi.fn();
  editor.open("Plan the trip. A plan, a PLAN, planned and plans.\n");
});
afterEach(() => {
  clearFind(editor.view);
  cleanup();
});

describe("match case and whole word in the bar", () => {
  it("toggle from the buttons, narrow the matches and are remembered", async () => {
    bar();
    await type("plan");
    expect(screen.getByText("1 of 5")).toBeTruthy();
    const matchCase = screen.getByRole("button", { name: "Match case" });
    const whole = screen.getByRole("button", { name: "Whole word" });
    expect(matchCase.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(matchCase);
    expect(matchCase.getAttribute("aria-pressed")).toBe("true");
    // "Plan" and "PLAN" no longer count.
    expect(screen.getByText("1 of 3")).toBeTruthy();
    fireEvent.click(whole);
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("kasten.find")!)).toEqual({ matchCase: true, wholeWord: true });
    expect(findState(editor.view.state).options).toEqual({ matchCase: true, wholeWord: true });
    cleanup();
    // A new bar starts with what was chosen.
    bar();
    expect(screen.getByRole("button", { name: "Match case" }).getAttribute("aria-pressed")).toBe("true");
    expect(findState(editor.view.state).options).toEqual({ matchCase: true, wholeWord: true });
  });

  it("toggle with Alt+C and Alt+W in either field", async () => {
    bar(undefined, { replace: true, seed: "", opened: 1 });
    await type("plan");
    const field = screen.getByRole("textbox", { name: "Find in page" });
    fireEvent.keyDown(field, { key: "ç", code: "KeyC", altKey: true });
    expect(screen.getByRole("button", { name: "Match case" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Replace with" }), { key: "∑", code: "KeyW", altKey: true });
    expect(screen.getByRole("button", { name: "Whole word" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(field, { key: "ç", code: "KeyC", altKey: true });
    expect(screen.getByRole("button", { name: "Match case" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("has no scope switch without sub-pages", () => {
    bar();
    expect(screen.queryByRole("group", { name: "Look in" })).toBeNull();
  });
});

describe("looking through sub-pages", () => {
  it("lists the pages with their counts and the lines around the first matches", async () => {
    const pages = scope();
    bar(pages);
    fireEvent.click(screen.getByRole("button", { name: "+ sub-pages" }));
    await type("plan");
    await waitFor(() => expect(pages.find).toHaveBeenCalledWith({ query: "plan", matchCase: false, wholeWord: false }, 201));
    const list = await screen.findByRole("list", { name: "Pages that hold the text" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).getByRole("button", { name: "packing" })).toBeTruthy();
    const first = within(list).getAllByRole("listitem")[0]!;
    expect(first.textContent).toContain("see the ");
    expect(first.querySelector("mark")?.textContent).toBe("plan");
    // Only the pages with matches in their text count: 4 + 5 + 3, in 3 pages (the locked one and the title-only one are out).
    expect(screen.getByText("12 matches in 3 pages")).toBeTruthy();
    expect(within(list).getByText("Locked")).toBeTruthy();
    expect(within(list).getByText(/title holds it/i)).toBeTruthy();
  });

  it("looks again when the options change, and not while on this page", async () => {
    const pages = scope();
    bar(pages);
    await type("plan");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(pages.find).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "+ sub-pages" }));
    await waitFor(() => expect(pages.find).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Whole word" }));
    await waitFor(() => expect(pages.find).toHaveBeenLastCalledWith({ query: "plan", matchCase: false, wholeWord: true }, 201));
  });

  it("opens a result with the text to find, in the way the click asks", async () => {
    const pages = scope();
    bar(pages);
    fireEvent.click(screen.getByRole("button", { name: "+ sub-pages" }));
    await type("plan");
    const list = await screen.findByRole("list", { name: "Pages that hold the text" });
    fireEvent.click(within(list).getByRole("button", { name: "packing" }));
    expect(pages.open).toHaveBeenCalledWith("trip/packing.md", "plan", "here");
    fireEvent.click(within(list).getByRole("button", { name: "notes" }), { ctrlKey: true });
    expect(pages.open).toHaveBeenLastCalledWith("trip/notes.md", "plan", "tab");
    fireEvent.click(within(list).getAllByRole("button", { name: /see the\s*plan\s*for details/ })[0]!);
    expect(pages.open).toHaveBeenLastCalledWith("trip.md", "plan", "here");
    expect(fireEvent.contextMenu(within(list).getByRole("button", { name: "packing" }))).toBe(false);
    expect(pages.openMenu).toHaveBeenCalledWith(expect.anything(), "trip/packing.md");
  });

  it("offers Rename for a page whose title holds the text, never replacing a title", async () => {
    const pages = scope();
    bar(pages);
    fireEvent.click(screen.getByRole("button", { name: "+ sub-pages" }));
    await type("plan");
    const list = await screen.findByRole("list", { name: "Pages that hold the text" });
    const row = within(list).getByRole("button", { name: "title-only" }).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Rename…" }));
    const field = within(row).getByRole("textbox", { name: "New title for title-only" });
    fireEvent.change(field, { target: { value: "Packing list" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(pages.rename).toHaveBeenCalledWith("trip/title-only.md", "Packing list");
    expect(within(row).queryByRole("textbox")).toBeNull();
  });

  it("says when nothing is found, or what went wrong", async () => {
    const empty = scope([]);
    bar(empty);
    fireEvent.click(screen.getByRole("button", { name: "+ sub-pages" }));
    await type("zzz");
    expect(await screen.findByText("No page here holds this.")).toBeTruthy();
    cleanup();
    const broken = scope();
    broken.find.mockRejectedValue(new Error("The vault is busy"));
    bar(broken);
    fireEvent.click(screen.getByRole("button", { name: "+ sub-pages" }));
    await type("plan");
    expect((await screen.findByRole("alert")).textContent).toBe("The vault is busy");
  });
});

describe("replacing across sub-pages", () => {
  async function ready(pages = scope(), open: FindOpen = { ...OPEN, replace: true }) {
    bar(pages, open);
    fireEvent.click(screen.getByRole("button", { name: "+ sub-pages" }));
    await type("plan");
    await screen.findByRole("list", { name: "Pages that hold the text" });
    await type("route", "Replace with");
    return pages;
  }

  it("previews the pages, then replaces in them as the preview showed", async () => {
    const pages = await ready();
    const button = screen.getByRole("button", { name: "Replace all in 3 pages" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await act(async () => void fireEvent.click(button));
    expect(pages.replace).toHaveBeenCalledWith({
      spec: { query: "plan", matchCase: false, wholeWord: false },
      with: "route",
      // The locked page and the page with only its title are not in it.
      expect: [
        { path: "trip.md", hash: "hash-trip.md", count: 4 },
        { path: "trip/packing.md", hash: "hash-trip/packing.md", count: 5 },
        { path: "trip/notes.md", hash: "hash-trip/notes.md", count: 3 },
      ],
    });
    expect((await screen.findByRole("status")).textContent).toBe("Replaced 12 in 1 page.");
    // The preview is asked for again.
    await waitFor(() => expect(pages.find.mock.calls.length).toBeGreaterThan(1));
  });

  it("replaces with Enter in the replace field too", async () => {
    const pages = await ready();
    await act(async () => void fireEvent.keyDown(screen.getByRole("textbox", { name: "Replace with" }), { key: "Enter" }));
    expect(pages.replace).toHaveBeenCalledTimes(1);
  });

  it("says look again when a page changed since the preview, and writes nothing more", async () => {
    const pages = scope();
    pages.replace.mockRejectedValue(new Error("Not replaced: trip/packing.md changed since the preview, look again"));
    await ready(pages);
    const asked = pages.find.mock.calls.length;
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Replace all in 3 pages/ })));
    expect((await screen.findByRole("status")).textContent).toMatch(/changed since the preview.*Look again/);
    await waitFor(() => expect(pages.find.mock.calls.length).toBeGreaterThan(asked));
  });

  it("shows any other refusal as the core says it", async () => {
    const pages = scope();
    pages.replace.mockRejectedValue(new Error("Too many replacements"));
    await ready(pages);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Replace all in 3 pages/ })));
    expect((await screen.findByRole("status")).textContent).toBe("Too many replacements");
  });

  it("will not replace when more pages hold the text than are listed, or none has it in its text", async () => {
    const many = Array.from({ length: 201 }, (_, i) => page(`trip/p${i}.md`, 1));
    await ready(scope(many));
    expect(screen.getByText(/More pages hold this than are listed/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Replace all in 200 pages" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    await ready(scope([page("trip/title-only.md", 0, { titleHit: true })]));
    expect((screen.getByRole("button", { name: "Replace all" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("looks through the page alone, with the page's own buttons, back on This page", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "This page" }));
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Pages that hold the text" })).toBeNull();
  });

  it("closes with Esc", async () => {
    await ready();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find in page" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
