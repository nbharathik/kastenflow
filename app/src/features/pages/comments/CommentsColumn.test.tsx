// The comments beside a sections page: a stack for each section and for the
// page as a whole, adding, resolving and reopening, comments on selected
// words, and the detached ones with "Attach here". The editor is a stand-in
// that answers with a page's text; the vault is the preview's.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pageTextOf, wordsOf, type Words } from "../../annotations/anchor";
import type { EditorText } from "../../annotations/doc-text";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { CommentsColumn } from "./CommentsColumn";
import type { CommentsEditor } from "./use-comments";

const PATH = "library/plan.md";
const SEED = { [PATH]: "---\ntitle: Plan\nlayout: sections\n---\nOpening words about hashing.\n\n---\n\n## Plan\n\nBook the guesthouse.\n" };

const text = pageTextOf([
  { title: "Opening words about hashing.", text: "Opening words about hashing." },
  { title: "Plan", text: "Plan\nBook the guesthouse." },
]);

let vault: MemoryVault;
let selected: Words | null;
let caret = 0;
const showWords = vi.fn(() => true);
const showSection = vi.fn(() => true);
const editor = {
  current: {
    annotationText: () => ({ ...text, pos: [] }) as EditorText,
    selectedWords: () => (selected ? { words: selected, text: { ...text, pos: [] } as EditorText } : null),
    showWords,
    showSection,
    caretSection: () => caret,
  } satisfies CommentsEditor,
};

const sidecars = () => (vault as unknown as { data: { sidecars: Record<string, string> } }).data.sidecars;
const words = (quote: string) => {
  const from = text.full.indexOf(quote);
  return wordsOf(text.full, from, from + quote.length, 400)!;
};
const stack = (name: string) => screen.getByRole("region", { name: `Comments: ${name}` });
const select = (picked: Words | null) => {
  selected = picked;
  act(() => void document.dispatchEvent(new Event("selectionchange")));
};

async function open() {
  vault = new MemoryVault({ ...SEED });
  await useWorkspace.getState().connect({ client: vault });
  render(<CommentsColumn client={vault} path={PATH} editor={editor} ready={1} body="x" />);
  await screen.findByRole("region", { name: "Comments: Whole page" });
}

async function type(box: HTMLElement, words: string) {
  fireEvent.change(box, { target: { value: words } });
  fireEvent.click(within(box.closest("form")!).getByRole("button", { name: "Comment" }));
}

beforeEach(() => {
  localStorage.clear();
  selected = null;
  caret = 0;
  showWords.mockClear();
  showSection.mockClear();
  useWorkspace.setState({ toasts: [] });
});
afterEach(cleanup);

describe("the comments column", () => {
  it("has a stack for the page as a whole and one for each section, named as the section strip names them", async () => {
    await open();
    for (const name of ["Whole page", "Opening words about hashing.", "Plan"]) expect(stack(name)).toBeTruthy();
    expect(screen.getByText("No comments yet")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Comments: Detached" })).toBeNull();
  });

  it("adds a comment to a section and keeps it beside the page", async () => {
    await open();
    await type(within(stack("Plan")).getByRole("textbox", { name: "Comment on section 2, Plan" }), "  Book early  ");
    const item = await within(stack("Plan")).findByText("Book early", { selector: ".kasten-comment-text" });
    expect(item.closest("li")!.textContent).toContain("You");
    expect(within(stack("Plan")).getByText("1 open")).toBeTruthy();
    const kept = await vault.comments(PATH);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ text: "Book early", author: "you", anchor: { section: "Plan", nth: 1 } });
    // The page's text did not change.
    expect((await vault.read(PATH)).text).toBe(SEED[PATH]);
    // The box is empty again for the next.
    expect((within(stack("Plan")).getByRole("textbox", { name: "Comment on section 2, Plan" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("adds a comment on the whole page, and Ctrl+Enter sends it", async () => {
    await open();
    const box = within(stack("Whole page")).getByRole("textbox", { name: "Comment on the whole page" });
    fireEvent.change(box, { target: { value: "Overall: good" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await within(stack("Whole page")).findByText("Overall: good");
    expect((await vault.comments(PATH))[0]!.anchor).toEqual({ section: "", nth: 1 });
  });

  it("will not send an empty comment", async () => {
    await open();
    const box = within(stack("Plan")).getByRole("textbox", { name: "Comment on section 2, Plan" });
    fireEvent.change(box, { target: { value: "   " } });
    expect((within(stack("Plan")).getByRole("button", { name: "Comment" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await vault.comments(PATH)).toEqual([]);
  });

  it("comments on the words selected in a section, and the comment shows them", async () => {
    await open();
    select(words("guesthouse"));
    expect(within(stack("Plan")).getByText("“guesthouse”")).toBeTruthy();
    // Another section's form is not about those words.
    expect(within(stack("Opening words about hashing.")).queryByText("“guesthouse”")).toBeNull();
    await type(within(stack("Plan")).getByRole("textbox", { name: "Comment on section 2, Plan" }), "Which one?");
    const quote = await within(stack("Plan")).findByRole("button", { name: /guesthouse/ });
    expect((await vault.comments(PATH))[0]!.anchor).toMatchObject({ section: "Plan", nth: 1, quote: "guesthouse" });
    // Clicking the quote shows the words in the page.
    fireEvent.click(quote);
    expect(showWords).toHaveBeenCalledWith({ from: text.full.indexOf("guesthouse"), to: text.full.indexOf("guesthouse") + "guesthouse".length }, "guesthouse");
  });

  it("resolves a comment, hides it until asked, and reopens it", async () => {
    await open();
    await type(within(stack("Plan")).getByRole("textbox", { name: "Comment on section 2, Plan" }), "Check this");
    fireEvent.click(await within(stack("Plan")).findByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(within(stack("Plan")).queryByText("Check this")).toBeNull());
    expect((await vault.comments(PATH))[0]!.resolved).not.toBeNull();
    expect(within(stack("Plan")).getByText("all resolved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show resolved" }));
    const item = (await within(stack("Plan")).findByText("Check this")).closest("li")!;
    expect(item.textContent).toContain("Resolved");
    fireEvent.click(within(item).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(within(stack("Plan")).getByText("1 open")).toBeTruthy());
    expect((await vault.comments(PATH))[0]!.resolved).toBeNull();
  });

  it("shows an agent's comment with its name", async () => {
    vault = new MemoryVault({ ...SEED });
    sidecars()["library/plan.comments.json"] = '{"comments": [{"id": "c-agent", "anchor": {"section": "Plan", "nth": 1}, "text": "Please add dates", "author": "agent:claude-code", "created": "2026-10-10T09:12:00Z"}]}';
    await useWorkspace.getState().connect({ client: vault });
    render(<CommentsColumn client={vault} path={PATH} editor={editor} ready={1} body="x" />);
    const item = (await within(await screen.findByRole("region", { name: "Comments: Plan" })).findByText("Please add dates")).closest("li")!;
    expect(item.classList.contains("is-agent")).toBe(true);
    expect(within(item).getByText("Agent · claude-code")).toBeTruthy();
  });

  it("goes to a section from its name", async () => {
    await open();
    fireEvent.click(within(stack("Plan")).getByRole("button", { name: "Plan" }));
    expect(showSection).toHaveBeenCalledWith(1);
  });

  async function openDetached() {
    vault = new MemoryVault({ ...SEED });
    sidecars()["library/plan.comments.json"] = '{"comments": [{"id": "c-1", "anchor": {"section": "Old name", "nth": 1}, "text": "Lost its section", "author": "you"}]}';
    await useWorkspace.getState().connect({ client: vault });
    render(<CommentsColumn client={vault} path={PATH} editor={editor} ready={1} body="x" />);
    const detached = await screen.findByRole("region", { name: "Comments: Detached" });
    expect(within(detached).getByText("Lost its section")).toBeTruthy();
    return detached;
  }

  it("keeps a comment whose section is gone apart, and attaches it to the section the cursor is in", async () => {
    const detached = await openDetached();
    caret = 1;
    expect(within(detached).getByRole("button", { name: "Attach here" }).getAttribute("title")).toContain("section the cursor is in");
    fireEvent.click(within(detached).getByRole("button", { name: "Attach here" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Comments: Detached" })).toBeNull());
    expect(within(stack("Plan")).getByText("Lost its section")).toBeTruthy();
    expect((await vault.comments(PATH))[0]!.anchor).toEqual({ section: "Plan", nth: 1 });
  });

  it("attaches a detached comment to the words selected, when there are any", async () => {
    const detached = await openDetached();
    select(words("Book the"));
    expect(within(detached).getByRole("button", { name: "Attach here" }).getAttribute("title")).toContain("Book the");
    fireEvent.click(within(detached).getByRole("button", { name: "Attach here" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Comments: Detached" })).toBeNull());
    expect(within(stack("Plan")).getByText("Lost its section")).toBeTruthy();
    expect((await vault.comments(PATH))[0]!.anchor).toMatchObject({ section: "Plan", nth: 1, quote: "Book the" });
  });

  it("resolves a detached comment from where it is", async () => {
    const detached = await openDetached();
    fireEvent.click(within(detached).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Comments: Detached" })).queryByText("Lost its section")).toBeNull());
    expect((await vault.comments(PATH))[0]!.resolved).not.toBeNull();
  });

  it("says why the comments cannot be read when the file is broken", async () => {
    vault = new MemoryVault({ ...SEED });
    sidecars()["library/plan.comments.json"] = "not json";
    await useWorkspace.getState().connect({ client: vault });
    render(<CommentsColumn client={vault} path={PATH} editor={editor} ready={1} body="x" />);
    expect((await screen.findByText(/could not be read/)).textContent).toContain("Not a comments file");
  });
});
