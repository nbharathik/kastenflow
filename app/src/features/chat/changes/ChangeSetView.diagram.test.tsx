// A staged change to a diagram, looked at as two pictures: before and after, what changed in words, and the XML one button away.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { ChangesView, FileChange } from "../types";
import { ChangeSetView } from "./ChangeSetView";

const model = (cells: string) => `<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n${cells}      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`;
const box = (id: string, label: string, x: number) => `        <mxCell id="${id}" value="${label}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="40" as="geometry"/></mxCell>\n`;
const BEFORE = model(box("api", "API", 0));
const AFTER = model(box("api", "API", 0) + box("cache", "Cache", 120));
const svgOf = (word: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><text>${word}</text></svg>`;

const diagram = (rest: Partial<FileChange> = {}): FileChange => ({ path: "library/Login-flow.drawio", kind: "diagram", title: "Login flow", new: false, before: BEFORE, after: AFTER, diff: "", stale: false, ...rest });

let chat: Scripted;

async function show(files: FileChange[]) {
  chat.view = { id: "set-1", files, pictures: [], steps: [] } satisfies ChangesView;
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  useChat.getState().setChanges(id, { id: "set-1", count: files.length, paths: files.map((f) => f.path) });
  const view = render(<ChangeSetView thread={useChat.getState().threads[id]!} />);
  return { ...view, article: await screen.findByRole("article") };
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  const made: Blob[] = [];
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => `blob:picture-${made.push(blob as Blob)}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("a staged diagram change", () => {
  it("shows the diagram before and after as two pictures, each through an image", async () => {
    const { article } = await show([diagram({ beforeSvg: svgOf("BEFORE"), afterSvg: svgOf("AFTER") })]);
    expect(article.getAttribute("aria-label")).toBe("Changed diagram Login flow");
    const pair = within(article).getByRole("group", { name: "Login flow: before and after" });
    expect(within(pair).getByText("Before")).toBeTruthy();
    expect(within(pair).getByText("After")).toBeTruthy();
    const before = await within(pair).findByRole("img", { name: "Login flow, before the change" });
    const after = await within(pair).findByRole("img", { name: "Login flow, after the change" });
    expect(before.getAttribute("src")).not.toBe(after.getAttribute("src"));
    // Each picture is a blob of SVG text for an `<img>`; the SVG itself is never put in the page.
    const blobs = vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => blob as Blob);
    expect(blobs.map((b) => b.type)).toEqual(["image/svg+xml", "image/svg+xml"]);
    expect(document.body.innerHTML).not.toContain("BEFORE");
    expect(document.body.innerHTML).not.toContain("alert(1)");
  });

  it("shows only the new diagram when the chat made it", async () => {
    const { article } = await show([diagram({ new: true, before: null, afterSvg: svgOf("NEW") })]);
    expect(article.getAttribute("aria-label")).toBe("New diagram Login flow");
    const pair = within(article).getByRole("group", { name: "Login flow: the new diagram" });
    expect(within(pair).getByText("New diagram")).toBeTruthy();
    expect(within(pair).queryByText("Before")).toBeNull();
    expect(await within(pair).findByRole("img", { name: "Login flow, as the chat drew it" })).toBeTruthy();
  });

  it("says what changed in words, from the cells", async () => {
    const { article } = await show([diagram({ afterSvg: svgOf("A"), beforeSvg: svgOf("B") })]);
    const words = within(article).getByRole("list", { name: "What changed" });
    expect(words.textContent).toContain("Shapes: 1 → 2.");
    expect(words.textContent).toContain("Added “Cache”.");
  });

  it("keeps the file's XML one button away, as a diff", async () => {
    const { article } = await show([diagram({ afterSvg: svgOf("A"), beforeSvg: svgOf("B") })]);
    expect(within(article).queryByRole("table")).toBeNull();
    const show_ = within(article).getByRole("button", { name: "Show XML" });
    expect(show_.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show_);
    const diff = await within(article).findByRole("table", { name: "XML changes to Login flow" });
    expect(diff.textContent).toContain("Cache");
    expect(within(article).getByRole("button", { name: "Hide XML" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(article).getByRole("button", { name: "Hide XML" }));
    expect(within(article).queryByRole("table")).toBeNull();
  });

  it("says so when the program could not draw a version, and the XML still shows the change", async () => {
    const { article } = await show([diagram({ afterSvg: svgOf("AFTER") })]);
    expect(await within(article).findAllByRole("img")).toHaveLength(1);
    expect(within(article).getByText(/No picture\. The program could not draw this version/)).toBeTruthy();
    fireEvent.click(within(article).getByRole("button", { name: "Show XML" }));
    expect(await within(article).findByRole("table", { name: "XML changes to Login flow" })).toBeTruthy();
  });

  it("tells that the pictures are a draft the editor will redraw", async () => {
    const { article } = await show([diagram({ afterSvg: svgOf("A"), beforeSvg: svgOf("B") })]);
    expect(article.textContent).toContain("Drawn by KastenFlow as a draft");
  });

  it("frees a picture's address when the view goes away", async () => {
    const { unmount } = await show([diagram({ afterSvg: svgOf("A"), beforeSvg: svgOf("B") })]);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    act(() => unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("leaves a note as its text diff", async () => {
    const note: FileChange = { path: "library/welcome.md", kind: "note", title: "Welcome", new: false, before: "One\n", after: "One\nTwo\n", diff: "", stale: false };
    const { article } = await show([note]);
    expect(within(article).getByRole("table", { name: "Changes to Welcome" })).toBeTruthy();
    expect(within(article).queryByRole("group")).toBeNull();
  });
});
