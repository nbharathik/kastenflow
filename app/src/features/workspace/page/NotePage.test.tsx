import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { NotePage } from "./NotePage";
import { flushOpenPage } from "./use-note-session";

const WELCOME = "---\nid: 01K5Y2WE1C0MEPAGE000000001\ntitle: Welcome\nicon: 👋\ncover: gradient-dawn\n---\nGetting around\n";
const SEED = {
  "library/welcome.md": WELCOME,
  "library/child.md": "---\ntitle: First steps\nparent: 01K5Y2WE1C0MEPAGE000000001\n---\nInside.\n",
  "library/links.md": "---\ntitle: Links\n---\nStart at [[Welcome]] today.\n",
};

let vault: MemoryVault;

async function open(path: string) {
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(path);
  render(<NotePage client={vault} path={path} />);
  const editor = await screen.findByTestId("page-editor", {}, { timeout: 20_000 });
  await expect.poll(() => editor.querySelector(".ProseMirror") !== null, { timeout: 20_000 }).toBe(true);
  return editor;
}

const text = async (path: string) => (await vault.read(path)).text;

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
});
afterEach(cleanup);

describe("NotePage", () => {
  it("shows the page header from the frontmatter and writes nothing when nothing changed", async () => {
    const editor = await open("library/welcome.md");
    await expect.poll(() => editor.textContent).toContain("Getting around");
    expect((screen.getByRole("textbox", { name: "Page title" }) as HTMLTextAreaElement).value).toBe("Welcome");
    expect(screen.getByRole("button", { name: "Change icon" }).textContent).toBe("👋");
    await act(flushOpenPage);
    cleanup();
    await act(flushOpenPage);
    expect(await text("library/welcome.md")).toBe(WELCOME);
  });

  it("renames the page when the title field is left, moving the file and its links", async () => {
    await open("library/welcome.md");
    const title = screen.getByRole("textbox", { name: "Page title" });
    fireEvent.change(title, { target: { value: "Start here" } });
    await act(async () => {
      fireEvent.blur(title);
      await flushOpenPage();
    });
    expect(await text("library/start-here.md")).toContain("title: Start here\n");
    expect(await text("library/links.md")).toContain("Start at [[Start here]] today.");
    expect(useWorkspace.getState().place.path).toBe("library/start-here.md");
  });

  it("saves a new icon and removes the cover", async () => {
    await open("library/welcome.md");
    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    fireEvent.click(screen.getByRole("button", { name: "🚀" }));
    // The cover's two tools are icons with a name and a tooltip.
    expect(screen.getByRole("button", { name: "Change cover" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Remove cover" }).title).toBe("Remove cover");
    fireEvent.click(screen.getByRole("button", { name: "Remove cover" }));
    await act(flushOpenPage);
    const saved = await text("library/welcome.md");
    expect(saved).toContain("icon: 🚀\n");
    expect(saved).not.toContain("cover:");
  });

  it("follows a [[link]] into the side stack with Shift and to a new tab with Ctrl", async () => {
    const editor = await open("library/links.md");
    await expect.poll(() => editor.querySelector(".kasten-mention")).not.toBeNull();
    const mention = editor.querySelector<HTMLElement>(".kasten-mention")!;
    fireEvent.mouseDown(mention, { shiftKey: true });
    expect(useWorkspace.getState().stack).toEqual(["library/welcome.md"]);
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "library/links.md" });
    fireEvent.mouseDown(mention, { ctrlKey: true });
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.path)).toEqual(["library/links.md", "library/welcome.md"]);
  });

  it("folds sub-pages, the pages that link here and details into toggles", async () => {
    await open("library/welcome.md");
    const footer = screen.getByRole("contentinfo", { name: "About this page" });
    // Closed until asked: only the toggles show.
    expect(footer.textContent).not.toContain("First steps");
    const subpages = screen.getByRole("button", { name: /Sub-pages/ });
    expect(subpages.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(subpages);
    expect(footer.textContent).toContain("First steps");
    fireEvent.click(await screen.findByRole("button", { name: "1 page links here" }));
    expect(footer.textContent).toContain("Links");
    expect(footer.textContent).toContain("Start at Welcome today.");
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(footer.textContent).toContain("library/welcome.md");
    // A toggle left open stays open on the next page.
    cleanup();
    await open("library/links.md");
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("true");
  });
});
