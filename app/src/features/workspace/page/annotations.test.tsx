// Comments and highlights on a page in the window: the column beside a
// sections page, the panel's Comments tab, the marks over a page kept from the
// web with their list in the Details tab, and the palette's commands. The page
// text is never written.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../../lib/store";
import { openWithPanel } from "../../panel/test-page";
import { COMMANDS } from "../overlays/commands";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { NotePage } from "./NotePage";
import { flushOpenPage } from "./use-note-session";

const SMART = "library/talk.md";
const CARD = "library/article.md";
const SEED = {
  [SMART]: "---\ntitle: Talk\nlayout: sections\n---\nOpening words.\n\n---\n\n## Plan\n\nBook the guesthouse.\n",
  [CARD]: "---\ntitle: An article\ntype: card\nurl: https://example.com/article\n---\nPress Ctrl+N anywhere to jot something down.\n\nIt lands in the inbox.\n",
  "library/plain.md": "---\ntitle: Plain\n---\nJust words here.\n",
};

let vault: MemoryVault;
const run = (id: string) => COMMANDS.find((c) => c.id === id)!.run();
const said = () => useWorkspace.getState().toasts.map((t) => t.text).join(" ");

async function openPage(path: string) {
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(path);
  render(<NotePage client={vault} path={path} />);
  const editor = await screen.findByTestId("page-editor", {}, { timeout: 30_000 });
  await expect.poll(() => editor.querySelector(".ProseMirror") !== null, { timeout: 30_000 }).toBe(true);
  await expect.poll(() => editor.textContent, { timeout: 30_000 }).not.toBe("");
  return editor;
}

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault({ ...SEED });
  useWorkspace.setState({ toasts: [] });
});
afterEach(cleanup);

describe("the comments column", () => {
  it("is beside a sections page, with a stack for each section, and not beside a plain page", async () => {
    await vault.addComment(SMART, { anchor: { section: "Plan", nth: 1 }, text: "Dates?" });
    await openPage(SMART);
    const column = await screen.findByRole("complementary", { name: "Comments" });
    await waitFor(() => expect(within(column).getByRole("region", { name: "Comments: Plan" })).toBeTruthy());
    expect(within(within(column).getByRole("region", { name: "Comments: Plan" })).getByText("Dates?")).toBeTruthy();
    expect(within(column).getByRole("region", { name: "Comments: Opening words." })).toBeTruthy();
    // Looking at them writes nothing.
    await act(flushOpenPage);
    expect((await vault.read(SMART)).text).toBe(SEED[SMART]);
    cleanup();
    await openPage("library/plain.md");
    expect(screen.queryByRole("complementary", { name: "Comments" })).toBeNull();
  }, 60_000);

  it("adds a comment from the column, kept beside the page", async () => {
    await openPage(SMART);
    const column = await screen.findByRole("complementary", { name: "Comments" });
    const plan = await within(column).findByRole("region", { name: "Comments: Plan" });
    fireEvent.change(within(plan).getByRole("textbox"), { target: { value: "Needs dates" } });
    fireEvent.click(within(plan).getByRole("button", { name: "Comment" }));
    await within(plan).findByText("Needs dates", { selector: ".kasten-comment-text" });
    expect((await vault.comments(SMART))[0]).toMatchObject({ text: "Needs dates", anchor: { section: "Plan", nth: 1 } });
    await act(flushOpenPage);
    expect((await vault.read(SMART)).text).toBe(SEED[SMART]);
  }, 60_000);
});

describe("the Comments tab", () => {
  it("lists a plain page's comments and adds one on the page", async () => {
    await vault.addComment("library/plain.md", { anchor: { section: "", nth: 1 }, text: "From before" });
    const { panel } = await openWithPanel(vault, "library/plain.md", "comments");
    const tab = await within(panel).findByRole("region", { name: "Comments" });
    expect(await within(tab).findByText("From before", { selector: ".kasten-comment-text" })).toBeTruthy();
    fireEvent.change(within(tab).getByRole("textbox", { name: "Comment on this page" }), { target: { value: "A new one" } });
    fireEvent.click(within(tab).getByRole("button", { name: "Comment" }));
    await within(tab).findByText("A new one", { selector: ".kasten-comment-text" });
    expect((await vault.comments("library/plain.md")).map((c) => c.text)).toEqual(["From before", "A new one"]);
  }, 60_000);

  it("opens from the palette", async () => {
    await openWithPanel(vault, "library/plain.md", "details");
    act(() => useShell.setState({ panels: [] }));
    act(() => run("page-comments"));
    expect(useShell.getState().panels).toEqual([useWorkspace.getState().layout.focus]);
    expect(screen.getByRole("tab", { name: "Comments" }).getAttribute("aria-selected")).toBe("true");
  }, 60_000);
});

describe("highlights on a page kept from the web", () => {
  const marks = (editor: HTMLElement) => [...editor.querySelectorAll<HTMLElement>(".kasten-text-hl")].map((el) => [el.textContent, el.classList.contains("is-pink") ? "pink" : el.classList.contains("is-blue") ? "blue" : "yellow"] as const);

  it("are painted over their words and listed in the Details tab, and change with it", async () => {
    await vault.addTextHighlight(CARD, { anchor: { quote: "jot something down", prefix: "anywhere to ", suffix: "." }, color: "pink", comment: "worth a card" });
    const { editor, panel } = await openWithPanel(vault, CARD, "details");
    await waitFor(() => expect(marks(editor)).toEqual([["jot something down", "pink"]]));
    const section = await within(panel).findByRole("region", { name: "Highlights" });
    expect(within(section).getByRole("button", { name: "jot something down" })).toBeTruthy();
    expect((within(section).getByRole("textbox", { name: /Comment on/ }) as HTMLTextAreaElement).value).toBe("worth a card");

    // A new colour repaints; the page is not written.
    fireEvent.click(within(section).getByRole("radio", { name: "Blue" }));
    await waitFor(() => expect(marks(editor)).toEqual([["jot something down", "blue"]]));
    await act(flushOpenPage);
    expect((await vault.read(CARD)).text).toBe(SEED[CARD]);

    // Removing takes the mark away.
    fireEvent.click(within(section).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(marks(editor)).toEqual([]));
    expect(await vault.textHighlights(CARD)).toEqual([]);
    expect(within(section).getByText("Select words on this page to highlight them.")).toBeTruthy();
  }, 60_000);

  it("whose words are gone are listed apart and painted nowhere", async () => {
    await vault.addTextHighlight(CARD, { anchor: { quote: "words that were edited away" }, color: "yellow" });
    const { editor, panel } = await openWithPanel(vault, CARD, "details");
    const section = await within(panel).findByRole("region", { name: "Highlights" });
    expect(await within(section).findByText("These words are not on the page any more.")).toBeTruthy();
    expect(marks(editor)).toEqual([]);
    // Nothing is selected, so it cannot be attached yet.
    expect((within(section).getByRole("button", { name: "Attach here" }) as HTMLButtonElement).disabled).toBe(true);
  }, 60_000);

  it("are offered only on a page kept from the web", async () => {
    const { panel } = await openWithPanel(vault, "library/plain.md", "details");
    await within(panel).findByRole("region", { name: "Backlinks" });
    expect(within(panel).queryByRole("region", { name: "Highlights" })).toBeNull();
  }, 60_000);

  it("are offered in the editor's own selection bar, not a second floating one", async () => {
    const editor = await openPage(CARD);
    const page = () => editor.closest<HTMLElement>(".kasten-page")!;
    await waitFor(() => expect(page().dataset.captured).toBe(""));
    // Selecting words raises the editor's toolbar only: no bar of the page's own.
    const text = editor.querySelector(".ProseMirror p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    expect(document.querySelector(".kasten-sel-bar")).toBeNull();
    expect(document.querySelector(".kasten-text-hl-host")).toBeNull();
    cleanup();
    const plain = await openPage("library/plain.md");
    expect(plain.closest<HTMLElement>(".kasten-page")!.dataset.captured).toBeUndefined();
  }, 60_000);

  it("can be made from the palette, which says what is missing", async () => {
    await openWithPanel(vault, CARD, "details");
    await act(async () => void (await run("highlight-selection")));
    await waitFor(() => expect(said()).toContain("Select some words in the page first"));
  }, 60_000);
});
