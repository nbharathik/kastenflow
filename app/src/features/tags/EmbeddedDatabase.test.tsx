// A database inside a page: made from a name in the page, and
// shown there with the Tag Database's own tabs, "+ View", Properties and New.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { databaseLinks } from "../workspace/page/database-links";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { EmbeddedDatabase } from "./EmbeddedDatabase";
import { useTags } from "./store";

const PAPER = "name: paper\nproperties:\n  - {key: status, type: select, options: [Idea, Done]}\nviews:\n  - {name: All, type: table}\n";
const SEED = {
  "library/reading.md": "---\nid: 01K5Y2WE1C0MEPAGE000000009\ntitle: Reading\n---\n![[tags/paper.yaml]]\n",
  "tags/paper.yaml": PAPER,
  "library/a.md": "---\ntitle: Draft on sleep\ntags: [paper]\nprops:\n  status: Idea\n---\nA\n",
};

let vault: MemoryVault;
const schemaOf = async (name: string) => (await vault.tagSchemas()).find((s) => s.name === name)!;
const toasts = () => useWorkspace.getState().toasts.filter((t) => !t.text.startsWith("Added")).map((t) => t.text).join("\n");

beforeEach(async () => {
  localStorage.clear();
  useTags.setState({ schemas: null });
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  await useTags.getState().load();
});
afterEach(cleanup);

describe("Databases inside pages", () => {
  it("makes a database from a name, ready for every kind of view", async () => {
    const links = databaseLinks();
    expect(await links.createDatabase("Reading list", "gallery")).toEqual({ path: "tags/reading-list.yaml", view: "Gallery" });
    const made = await schemaOf("reading-list");
    // A status for a board and a date for a calendar, from the start.
    expect(made.properties.map((p) => [p.key, p.type])).toEqual([
      ["status", "select"],
      ["date", "date"],
    ]);
    expect(made.views).toEqual([{ name: "Gallery", type: "gallery" }]);
    expect(await links.createDatabase("!!!", "table")).toBeNull();

    // A view of a kind is the tag's own when it has one, else added.
    expect(await links.viewOf("paper", "table")).toBe("All");
    expect(await links.viewOf("paper", "kanban")).toBe("Board");
    expect((await schemaOf("paper")).views).toEqual([
      { name: "All", type: "table" },
      { name: "Board", type: "kanban", group_by: "status" },
    ]);
  });

  it("adds views, properties and notes from inside the page", async () => {
    render(<EmbeddedDatabase tag="paper" initial="" page={() => "library/reading.md"} />);
    expect(await screen.findByRole("tab", { name: /All/ })).toBeTruthy();
    expect(screen.getByText("Draft on sleep")).toBeTruthy();

    // + View: a gallery, shown at once.
    fireEvent.click(screen.getByRole("button", { name: "Add a view" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /Gallery/ })));
    expect(screen.getByRole("tab", { name: /Gallery/ }).getAttribute("aria-selected")).toBe("true");
    await expect.poll(async () => (await schemaOf("paper")).views.map((v) => v.name)).toEqual(["All", "Gallery"]);

    // Properties opens the tag's properties. It is an icon: the word and the count are its name.
    const properties = screen.getByRole("button", { name: /^Properties/ });
    expect(properties.getAttribute("aria-label")).toBe("Properties (1)");
    expect(properties.textContent).toBe("1");
    fireEvent.click(properties);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    // New is an icon too: a note carrying the tag.
    expect(screen.getByRole("button", { name: "New note" }).textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    const field = screen.getByRole("textbox", { name: "New note in #paper" });
    fireEvent.change(field, { target: { value: "Notes on dreams" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "Notes on dreams")?.tags).toEqual(["paper"]);
    // Made in the page, it is the page's sub-page, and lives under it.
    expect((await vault.list()).find((n) => n.title === "Notes on dreams")?.parent).toBe("01K5Y2WE1C0MEPAGE000000009");
    expect(within(document.body).getByText("Notes on dreams")).toBeTruthy();
  });

  it("files new notes under the page where it sits now, after the page is renamed", async () => {
    let page = "library/reading.md";
    render(<EmbeddedDatabase tag="paper" initial="" page={() => page} />);
    await screen.findByRole("tab", { name: /All/ });
    // The page is renamed: its file moves, and the notes list follows.
    const renamed = await vault.rename(page, "Reading list");
    page = renamed.note.meta.path;
    await act(() => useWorkspace.getState().refresh());
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    const field = screen.getByRole("textbox", { name: "New note in #paper" });
    fireEvent.change(field, { target: { value: "Notes on naps" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "Notes on naps")?.parent).toBe("01K5Y2WE1C0MEPAGE000000009");
    expect(toasts()).toBe("");
  });
});
