// A page in the smart layout (`layout: sections`): its cards and outline strip,
// switching the layout on and off from the menu's actions without a byte of the
// page changing but its frontmatter line, and presenting it.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { presentThisPage, sectionsToDeck, toggleSmartLayout } from "../../pages/present/actions";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { NotePage } from "./NotePage";
import { flushOpenPage } from "./use-note-session";

const BODY = "Opening words.\n\n---\n\n## Plan\n\n- flights\n- guesthouse\n\n***\n\n## Budget\n\nMoney words.\n";
const PLAIN = `---\ntitle: Talk\n---\n${BODY}`;
const SMART = `---\ntitle: Talk\nlayout: sections\n---\n${BODY}`;
const PATH = "library/talk.md";

let vault: MemoryVault;

async function open(text: string) {
  vault = new MemoryVault({ [PATH]: text });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(PATH);
  render(<NotePage client={vault} path={PATH} />);
  const editor = await screen.findByTestId("page-editor", {}, { timeout: 30_000 });
  await expect.poll(() => editor.querySelector(".ProseMirror") !== null, { timeout: 30_000 }).toBe(true);
  // The text is in the editor once it has been loaded into it.
  await expect.poll(() => editor.textContent, { timeout: 30_000 }).toContain("Opening words.");
  return editor;
}

const note = () => useWorkspace.getState().notes.find((n) => n.path === PATH)!;
const page = () => document.querySelector<HTMLElement>(".kasten-page")!;
const file = async () => (await vault.read(PATH)).text;
const saved = async () => {
  await act(flushOpenPage);
  return file();
};
/** The page without the frontmatter lines that changing its layout writes: the layout, and when it was updated. */
const withoutLayout = (text: string) => text.replace(/^(?:layout|updated): .*\n/gm, "");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("a page in the smart layout", () => {
  it("is drawn as cards with the outline strip when its layout says so", async () => {
    const editor = await open(SMART);
    expect(page().classList.contains("is-sections")).toBe(true);
    expect(editor.querySelector(".ProseMirror")!.classList.contains("kasten-sections-layout")).toBe(true);
    expect([...editor.querySelectorAll(".kasten-sec-head .kasten-sec-title")].map((t) => t.textContent)).toEqual(["Opening words.", "Plan", "Budget"]);
    const strip = screen.getByRole("navigation", { name: "Sections of this page" });
    await waitFor(() => expect(within(strip).getAllByRole("button").map((b) => b.textContent)).toEqual(["1Opening words.", "2Plan", "3Budget"]));
    // Nothing is written for looking at it.
    expect(await saved()).toBe(SMART);
  }, 60_000);

  it("is the plain page when it has no layout, with no strip", async () => {
    const editor = await open(PLAIN);
    expect(page().classList.contains("is-sections")).toBe(false);
    expect(editor.querySelector(".kasten-sec-head")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Sections of this page" })).toBeNull();
  }, 60_000);

  it("switches on and off with the page bytes the same but for the layout line", async () => {
    const editor = await open(PLAIN);
    act(() => toggleSmartLayout(note()));
    await waitFor(() => expect(page().classList.contains("is-sections")).toBe(true));
    expect(editor.querySelectorAll(".kasten-sec-head")).toHaveLength(3);
    expect(screen.getByRole("navigation", { name: "Sections of this page" })).toBeTruthy();
    const on = await saved();
    expect(on).toContain("layout: sections\n");
    expect(splitFrontmatter(on).body).toBe(BODY);
    expect(withoutLayout(on)).toBe(PLAIN);

    act(() => toggleSmartLayout(note()));
    await waitFor(() => expect(page().classList.contains("is-sections")).toBe(false));
    expect(editor.querySelector(".kasten-sec-head")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Sections of this page" })).toBeNull();
    // Off again: the page is what it was, byte for byte, but for the date of the change.
    const off = await saved();
    expect(off).not.toContain("layout:");
    expect(splitFrontmatter(off).body).toBe(BODY);
    expect(withoutLayout(off)).toBe(PLAIN);
  }, 60_000);

  it("is presented one slide at a time over the page, and Esc gives the page back", async () => {
    const editor = await open(PLAIN);
    const scroller = editor.closest(".kasten-page-main") as HTMLElement;
    scroller.scrollTop = 25;
    act(() => presentThisPage(note()));
    await waitFor(() => expect(page().classList.contains("is-presenting")).toBe(true));
    const bar = screen.getByRole("toolbar", { name: "Presentation" });
    expect(bar.textContent).toContain("1 / 3");
    expect([...editor.querySelectorAll(".kasten-slide-now")].map((n) => n.textContent)).toEqual(["Opening words."]);
    // The page is read, not written, while it is shown.
    expect(editor.querySelector(".ProseMirror")!.getAttribute("contenteditable")).toBe("false");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(bar.textContent).toContain("2 / 3"));
    expect([...editor.querySelectorAll(".kasten-slide-now")].map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())).toEqual(["Plan", "flights guesthouse"]);
    fireEvent.keyDown(document.body, { key: "End" });
    await waitFor(() => expect(bar.textContent).toContain("3 / 3"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(page().classList.contains("is-presenting")).toBe(false));
    expect(screen.queryByRole("toolbar", { name: "Presentation" })).toBeNull();
    expect(editor.querySelector(".kasten-slide-now")).toBeNull();
    expect(editor.querySelector(".ProseMirror")!.getAttribute("contenteditable")).toBe("true");
    await waitFor(() => expect(scroller.scrollTop).toBe(25));
    expect(await saved()).toBe(PLAIN);
  }, 60_000);

  it("says how to make slides when there is nothing to present, and makes no deck of nothing", async () => {
    vault = new MemoryVault({ [PATH]: "---\ntitle: Talk\n---\n" });
    await useWorkspace.getState().connect({ client: vault });
    useWorkspace.getState().openPath(PATH);
    render(<NotePage client={vault} path={PATH} />);
    await screen.findByTestId("page-editor", {}, { timeout: 30_000 });
    await expect.poll(() => document.querySelector(".ProseMirror") !== null, { timeout: 30_000 }).toBe(true);
    act(() => presentThisPage(note()));
    expect(useWorkspace.getState().toasts.map((t) => t.text).join(" ")).toContain("Nothing to present yet");
    expect(page().classList.contains("is-presenting")).toBe(false);
    act(() => sectionsToDeck(note()));
    await waitFor(() => expect(useWorkspace.getState().toasts.map((t) => t.text).join(" ")).toContain("nothing to turn into slides"));
  }, 60_000);
});
