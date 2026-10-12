import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pageFor } from "../../workspace/page/open-page";
import { useWorkspace } from "../../workspace/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { openWithPanel, toasts } from "../test-page";

const PAPER =
  "name: paper\ncolor: blue\nproperties:\n" +
  "  - {key: status, type: select, options: [Idea, Drafting, Submitted]}\n" +
  "  - {key: venue, type: text}\n" +
  "  - {key: deadline, type: date}\n" +
  "  - {key: coauthors, type: multi_select}\n" +
  "  - {key: pages, type: number}\n" +
  "  - {key: done, type: checkbox}\n" +
  "  - {key: repo, type: url}\n" +
  "  - {key: related, type: relation}\n";
const DRAFT = "---\nid: 01K5Y2DRAFT000000000000001\ntitle: Draft\ntags: [paper]\nprops:\n  status: Idea\n  deadline: 2026-12-01\n  mood: calm\n---\nIntro text\n";
const SEED = {
  "tags/paper.yaml": PAPER,
  "tags/idea.yaml": "name: idea\ncolor: yellow\nproperties:\n  - {key: spark, type: text}\n",
  "library/draft.md": DRAFT,
  "library/reading.md": "---\nid: 01K5Y2READING00000000000001\ntitle: Reading notes\ntags: [travel]\n---\nSome notes\n",
};
const PATH = "library/draft.md";

let vault: MemoryVault;
const text = async () => (await vault.read(PATH)).text;
const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
});
afterEach(cleanup);

describe("Properties tab", () => {
  it("shows tags, the schema's properties with typed editors, and other properties", async () => {
    await openWithPanel(vault, PATH, "details");
    const paper = await screen.findByRole("region", { name: "#paper properties" });
    expect((within(paper).getByRole("combobox", { name: "status" }) as HTMLSelectElement).value).toBe("Idea");
    expect((within(paper).getByLabelText("deadline") as HTMLInputElement).value).toBe("2026-12-01");
    expect((within(paper).getByLabelText("done") as HTMLInputElement).type).toBe("checkbox");
    expect((within(paper).getByLabelText("pages") as HTMLInputElement).type).toBe("number");
    expect(within(paper).getByRole("option", { name: "—" })).toBeTruthy();
    expect(within(section("Tags")).getByRole("button", { name: "Remove tag paper" })).toBeTruthy();
    expect((within(section("Other properties")).getByLabelText("mood") as HTMLInputElement).value).toBe("calm");
  });

  it("leaves a page's own view settings (home sections, overview tables) out of the property list", async () => {
    const views =
      "---\nid: 01K5Y2VIEWS000000000000001\ntitle: Views\nprops:\n  mood: calm\n  home: [summary, pages]\n" +
      '  overview:\n    - \'{"name":"Table","type":"table","scope":"project","filter":[],"sort":[],"columns":["type"]}\'\n---\nBody\n';
    vault = new MemoryVault({ ...SEED, "library/views.md": views });
    await openWithPanel(vault, "library/views.md", "details");
    const others = await screen.findByRole("region", { name: "Other properties" });
    expect(within(others).getByLabelText("mood")).toBeTruthy();
    expect(within(others).queryByLabelText("home")).toBeNull();
    expect(within(others).queryByLabelText("overview")).toBeNull();
    // They stay in the file.
    const kept = (await vault.read("library/views.md")).text;
    expect(kept).toContain("home: [summary, pages]");
    expect(kept).toContain("overview:");
  });

  it("opens a tag's database from its group", async () => {
    await openWithPanel(vault, PATH, "details");
    const paper = await screen.findByRole("region", { name: "#paper properties" });
    fireEvent.click(within(paper).getByRole("button", { name: "#paper" }));
    expect(useWorkspace.getState().place).toEqual({ view: "tags", path: "#paper" });
  });

  it("sets a select property and a tag through the client, and the page takes them in", async () => {
    await openWithPanel(vault, PATH, "details");
    const paper = await screen.findByRole("region", { name: "#paper properties" });
    await act(async () => fireEvent.change(within(paper).getByRole("combobox", { name: "status" }), { target: { value: "Submitted" } }));
    await expect.poll(text).toContain("props:\n  status: Submitted\n  deadline: 2026-12-01\n  mood: calm\n");

    fireEvent.click(within(section("Tags")).getByRole("button", { name: "+ Add tag" }));
    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "ide" } });
    expect(screen.getByRole("option", { name: /#idea/ }).getAttribute("aria-selected")).toBe("true");
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(text).toContain("tags: [paper, idea]\n");
    // The new tag's schema brings its properties.
    expect(await screen.findByRole("region", { name: "#idea properties" })).toBeTruthy();

    // The open page adopted both edits, so typing next saves without a conflict.
    const session = pageFor(PATH)!;
    expect(session.currentHash).toBe((await vault.read(PATH)).hash);
    session.editBody("Intro text, and more\n");
    await act(() => session.flush());
    const saved = await text();
    expect(saved).toContain("status: Submitted");
    expect(saved).toContain("Intro text, and more\n");
    expect((await vault.list()).some((n) => n.path.includes("conflict"))).toBe(false);
  });

  it("rolls back and shows the core's message when a value is refused", async () => {
    await openWithPanel(vault, PATH, "details");
    const paper = await screen.findByRole("region", { name: "#paper properties" });
    vi.spyOn(vault, "updateProps").mockRejectedValueOnce(new Error("Property “repo” (url) must be a URL"));
    const repo = within(paper).getByLabelText("repo") as HTMLInputElement;
    fireEvent.change(repo, { target: { value: "not a link" } });
    await act(async () => fireEvent.blur(repo));
    await expect.poll(toasts).toContain("Property “repo” (url) must be a URL");
    expect(repo.value).toBe("");
    expect(await text()).toBe(DRAFT);
  });

  it("edits list, checkbox, number and relation values", async () => {
    await openWithPanel(vault, PATH, "details");
    const paper = await screen.findByRole("region", { name: "#paper properties" });

    const coauthor = within(paper).getByRole("textbox", { name: "Add to coauthors" });
    fireEvent.change(coauthor, { target: { value: "Ada" } });
    await act(async () => fireEvent.keyDown(coauthor, { key: "Enter" }));
    await expect.poll(text).toContain("  coauthors: [Ada]\n");

    await act(async () => fireEvent.click(within(paper).getByLabelText("done")));
    await expect.poll(text).toContain("  done: true\n");

    const pages = within(paper).getByLabelText("pages");
    fireEvent.change(pages, { target: { value: "12" } });
    await act(async () => fireEvent.keyDown(pages, { key: "Enter" }));
    await expect.poll(text).toContain("  pages: 12\n");

    fireEvent.click(within(paper).getByRole("button", { name: "Add a page to related" }));
    const find = screen.getByRole("textbox", { name: "Find a page" });
    fireEvent.change(find, { target: { value: "read" } });
    await act(async () => fireEvent.keyDown(find, { key: "Enter" }));
    // Stored by id, shown by title.
    await expect.poll(text).toContain("  related: [01K5Y2READING00000000000001]\n");
    expect(within(paper).getByRole("button", { name: "Reading notes" })).toBeTruthy();
  });

  it("relates the page picked among pages that share a title, and says where each lives", async () => {
    vault = new MemoryVault({
      ...SEED,
      "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
      "projects/trip/pages/readme.md": "---\ntitle: README\n---\n",
      "library/readme.md": "---\ntitle: README\n---\n",
    });
    await openWithPanel(vault, PATH, "details");
    const paper = await screen.findByRole("region", { name: "#paper properties" });
    fireEvent.click(within(paper).getByRole("button", { name: "Add a page to related" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find a page" }), { target: { value: "readme" } });
    const row = screen.getByRole("option", { name: /README\s*Trip/ });
    expect(screen.getByRole("option", { name: /README\s*Pages/ })).toBeTruthy();
    await act(async () => fireEvent.mouseDown(row));
    await expect.poll(async () => (await vault.read("projects/trip/pages/readme.md")).meta.id).toBeTruthy();
    const { id } = (await vault.read("projects/trip/pages/readme.md")).meta;
    await expect.poll(text).toContain(`  related: [${id}]\n`);
    expect((await vault.read("library/readme.md")).meta.id).toBeNull();
    expect(within(paper).getByRole("button", { name: "README" }).title).toBe("Open README (Trip)");
  });

  it("keeps the time a date has when its day changes", async () => {
    vault = new MemoryVault({ ...SEED, [PATH]: DRAFT.replace("  deadline: 2026-12-01\n", "  deadline: 2026-12-01T17:00\n") });
    await openWithPanel(vault, PATH, "details");
    const paper = await screen.findByRole("region", { name: "#paper properties" });
    const deadline = within(paper).getByLabelText("deadline") as HTMLInputElement;
    expect(deadline.value).toBe("2026-12-01");
    fireEvent.change(deadline, { target: { value: "2026-12-03" } });
    await act(async () => fireEvent.blur(deadline));
    await expect.poll(text).toMatch(/\n {2}deadline: "?2026-12-03T17:00"?\n/);
  });

  it("removes a tag, and adds and removes other properties", async () => {
    await openWithPanel(vault, PATH, "details");
    const others = await screen.findByRole("region", { name: "Other properties" });
    await act(async () => fireEvent.click(within(others).getByRole("button", { name: "Remove mood" })));
    await expect.poll(text).not.toContain("mood");

    fireEvent.click(within(others).getByRole("button", { name: "+ Add property" }));
    fireEvent.change(within(others).getByRole("textbox", { name: "Property name" }), { target: { value: "source" } });
    fireEvent.change(within(others).getByRole("textbox", { name: "Property value" }), { target: { value: "The web" } });
    await act(async () => fireEvent.submit(within(others).getByRole("form", { name: "New property" })));
    await expect.poll(text).toContain("  source: The web\n");

    await act(async () => fireEvent.click(within(section("Tags")).getByRole("button", { name: "Remove tag paper" })));
    await expect.poll(text).not.toContain("tags:");
    expect(screen.queryByRole("region", { name: "#paper properties" })).toBeNull();
  });
});
