// "Edit code": the files on the left, the open file in a code editor, the page
// beside it loaded again after each save, a conflict offered as a choice, and
// the page's errors under the editor.

import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeBackend } from "../test-support/fake-frame";
import { FakeObserver } from "../test-support/observer";
import { AuthorPane } from "./AuthorPane";
import { FakeAuthor } from "./test-support/fake-author";

const PAGE = "library/tracker.md";

function mount(author = new FakeAuthor(), backend = new FakeBackend()) {
  const view = render(<AuthorPane pagePath={PAGE} pageId="01SMART" title="Tracker" backend={backend} author={author} />);
  return { author, backend, ...view };
}

const editorOf = (container: HTMLElement): EditorView => {
  const dom = container.querySelector<HTMLElement>(".cm-editor");
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) throw new Error("no editor yet");
  return view;
};
const type = (container: HTMLElement, text: string) => {
  const view = editorOf(container);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
};
const frameSrc = (container: HTMLElement) => container.querySelector("iframe")?.getAttribute("src") ?? null;

beforeEach(() => {
  FakeObserver.reset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ready(container: HTMLElement) {
  await waitFor(() => {
    FakeObserver.show(true);
    expect(container.querySelector(".cm-content")).not.toBeNull();
    expect(container.querySelector("iframe")).not.toBeNull();
  });
}

describe("the files and the editor", () => {
  it("lists the files, opens index.html in the editor and shows the page beside it", async () => {
    const { container } = mount();
    await ready(container);
    const tree = screen.getByRole("navigation", { name: "Files of this page" });
    expect(within(tree).getAllByRole("button").map((b) => b.textContent)).toEqual(["index.html", "app.js", "smart.yaml", "New file"]);
    expect(within(tree).getByRole("button", { name: "index.html" }).getAttribute("aria-current")).toBe("true");
    expect(editorOf(container).state.doc.toString()).toBe("<h1>Hi</h1>");
    expect(screen.getByRole("status", { name: "" }).textContent).toBeTruthy();
    expect(frameSrc(container)).toMatch(/\/01SMART\/index\.html$/);
  });

  it("switches to another file from the list, with that file's text", async () => {
    const { container } = mount();
    await ready(container);
    fireEvent.click(screen.getByRole("button", { name: "app.js" }));
    await waitFor(() => expect(editorOf(container).state.doc.toString()).toBe("var a = 1;"));
    expect(container.querySelector(".kasten-author-name")?.textContent).toBe("app.js");
  });

  it("makes a new file from the name typed right in the list", async () => {
    const { container, author } = mount();
    await ready(container);
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    const field = screen.getByRole("textbox", { name: "File name" });
    fireEvent.change(field, { target: { value: "style.css" } });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(author.disk.has("style.css")).toBe(true));
    await waitFor(() => expect(container.querySelector(".kasten-author-name")?.textContent).toBe("style.css"));
  });

  it("answers a sentence when the name is not allowed, and keeps the field", async () => {
    const { container } = mount();
    await ready(container);
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    const field = screen.getByRole("textbox", { name: "File name" });
    fireEvent.change(field, { target: { value: "app.js" } });
    fireEvent.submit(field.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/already there/);
    expect(screen.getByRole("textbox", { name: "File name" })).toBeTruthy();
  });

  it("offers to add an index.html when the folder is empty", async () => {
    const { author } = mount(new FakeAuthor({}));
    fireEvent.click(await screen.findByRole("button", { name: "Add index.html" }));
    await waitFor(() => expect(author.disk.has("index.html")).toBe(true));
  });

  it("says why the folder could not be read, with a way to try again", async () => {
    const author = new FakeAuthor();
    author.failListing = "The folder is locked.";
    mount(author);
    expect(await screen.findByText("The folder is locked.")).toBeTruthy();
    author.failListing = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Files of this page" })).toBeTruthy());
  });
});

describe("saving and the page beside it", () => {
  it("saves 500 ms after typing, against the hash it read, and loads the page again", async () => {
    const { container, author } = mount();
    await ready(container);
    const read = author.disk.get("index.html")!.hash;
    const before = frameSrc(container);
    type(container, "<h1>New</h1>");
    expect(author.writes).toEqual([]);
    await waitFor(() => expect(author.writes).toEqual([{ path: "index.html", text: "<h1>New</h1>", base: read }]), { timeout: 3000 });
    await waitFor(() => expect(frameSrc(container)).not.toBe(before), { timeout: 3000 });
    expect(frameSrc(container)).toMatch(/\/01SMART\/index\.html$/);
    await waitFor(() => expect(screen.getByRole("status", { name: "" }).textContent).toBe("All changes saved"));
  });

  it("saves at once on Ctrl+S", async () => {
    const { container, author } = mount();
    await ready(container);
    type(container, "now");
    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "s", ctrlKey: true });
    await waitFor(() => expect(author.writes).toHaveLength(1));
  });

  it("offers Keep mine or Use the file on disk when the file changed behind the editor", async () => {
    const { container, author } = mount();
    await ready(container);
    author.changeOnDisk("index.html", "<h1>from outside</h1>");
    type(container, "<h1>mine</h1>");
    const bar = await screen.findByText(/changed on disk while you were editing it/, undefined, { timeout: 3000 });
    expect(bar.closest("[role=alert]")).toBeTruthy();
    expect(author.disk.get("index.html")!.text).toBe("<h1>from outside</h1>");
    fireEvent.click(screen.getByRole("button", { name: "Use the file on disk" }));
    await waitFor(() => expect(editorOf(container).state.doc.toString()).toBe("<h1>from outside</h1>"));
    expect(screen.queryByText(/changed on disk/)).toBeNull();
  });

  it("Keep mine writes the editor's text", async () => {
    const { container, author } = mount();
    await ready(container);
    author.changeOnDisk("index.html", "<h1>from outside</h1>");
    type(container, "<h1>mine</h1>");
    fireEvent.click(await screen.findByRole("button", { name: "Keep mine" }, { timeout: 3000 }));
    await waitFor(() => expect(author.disk.get("index.html")!.text).toBe("<h1>mine</h1>"));
  });

  it("says why a save did not work, and Try saving again does it", async () => {
    const { container, author } = mount();
    await ready(container);
    author.failNext = "That file is too large.";
    type(container, "big");
    expect((await screen.findByText("That file is too large.", undefined, { timeout: 3000 })).closest("[role=alert]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try saving again" }));
    await waitFor(() => expect(author.disk.get("index.html")!.text).toBe("big"));
  });

  it("takes a file to the trash without asking, keeping index.html and smart.yaml out of reach", async () => {
    const { container, author } = mount();
    await ready(container);
    expect(screen.queryByRole("button", { name: "Move to trash" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "app.js" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(author.removed).toEqual(["app.js"]));
  });
});

describe("the page's errors", () => {
  it("are listed under the editor, not under the page", async () => {
    const backend = new FakeBackend();
    backend.log = { records: [{ kind: "error", message: "x is not defined", time: "2026-10-23T10:00:00Z" }] };
    const { container } = mount(new FakeAuthor(), backend);
    await ready(container);
    const code = container.querySelector(".kasten-author-code")!;
    const chip = await within(code as HTMLElement).findByRole("button", { name: /error/ });
    fireEvent.click(chip);
    expect(within(code as HTMLElement).getByText("x is not defined")).toBeTruthy();
    expect(container.querySelector(".kasten-author-preview .kasten-smart-errors")).toBeNull();
  });
});
