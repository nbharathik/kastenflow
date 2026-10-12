// The pages of the vault as the Slides host gives them to a deck, and the picker that chooses one.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { onPageFiles, pageFilesChanged } from "./events";
import { PagePickerHost } from "./PagePicker";
import { pageHost } from "./page-host";
import { usePagePicker } from "./page-picker";

const SEED = {
  "projects/trip/_project.md": "---\ntitle: Summer trip\ntype: project\n---\nPlans.\n",
  "projects/trip/route.md": "---\ntitle: Route\n---\n# Route\n\nDrive north.\n\n## Stops\n\n- Lake\n",
  "projects/trip/packing.md": "---\ntitle: Packing\n---\nTent and stove.\n",
  "library/ideas.md": "---\ntitle: Ideas\n---\nA thought about routes.\n",
};

async function open() {
  const vault = new MemoryVault(SEED);
  await useWorkspace.getState().connect({ client: vault });
  return { vault, host: pageHost(vault) };
}

beforeEach(() => {
  localStorage.clear();
  usePagePicker.setState({ waiting: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("reading a page for a deck", () => {
  it("gives its words without the frontmatter, with what the vault knows of it", async () => {
    const { host } = await open();
    const page = await host.readPage("projects/trip/route.md");
    expect(page).toMatchObject({ path: "projects/trip/route.md", title: "Route", project: "trip", markdown: "# Route\n\nDrive north.\n\n## Stops\n\n- Lake\n" });
    expect(page?.markdown).not.toContain("title: Route");
  });

  it("says there is no page, and does not throw, for one that was moved or trashed", async () => {
    const { host } = await open();
    await expect(host.readPage("projects/trip/gone.md")).resolves.toBeUndefined();
  });

  it("lists the pages the vault has, newest first, with their projects", async () => {
    const { host } = await open();
    const pages = await host.listPages();
    expect(pages.map((p) => p.path).sort()).toEqual(["library/ideas.md", "projects/trip/_project.md", "projects/trip/packing.md", "projects/trip/route.md"]);
    for (let i = 1; i < pages.length; i += 1) expect(pages[i - 1]!.modified ?? 0).toBeGreaterThanOrEqual(pages[i]!.modified ?? 0);
    expect(pages.find((p) => p.path === "library/ideas.md")?.project ?? null).toBeNull();
  });
});

describe("following a link to a page from a deck", () => {
  it("opens it in a peek unless the Open menu asks for another place", async () => {
    const { host } = await open();
    const openPath = vi.fn();
    useWorkspace.setState({ openPath });
    host.openPage("projects/trip/route.md");
    host.openPage("projects/trip/route.md", "tab");
    host.openPage("projects/trip/route.md", "right", "Stops");
    expect(openPath.mock.calls).toEqual([
      ["projects/trip/route.md", "peek"],
      ["projects/trip/route.md", "tab"],
      ["projects/trip/route.md", "right"],
    ]);
  });

  it("hears that a page changed, and not a deck", async () => {
    const { host } = await open();
    const heard = vi.fn();
    const stop = host.watchPages(heard);
    pageFilesChanged(["projects/trip/route.md", "decks/talk.deck", "assets/a.png"]);
    expect(heard).toHaveBeenCalledWith(["projects/trip/route.md"]);
    stop();
    pageFilesChanged(["library/ideas.md"]);
    expect(heard).toHaveBeenCalledTimes(1);
    const other = vi.fn();
    const off = onPageFiles(other);
    pageFilesChanged(["a.md"]);
    off();
    expect(other).toHaveBeenCalledWith(["a.md"]);
  });
});

/** The pages listed in the picker, by their words (the project menu has options of its own). */
const rows = (): string[] => within(screen.getByRole("listbox", { name: "Pages" })).getAllByRole("option").map((o) => o.textContent ?? "");

describe("choosing a page", () => {
  async function ask() {
    const { host } = await open();
    render(<PagePickerHost />);
    let chosen: Awaited<ReturnType<typeof host.pickPage>> | undefined;
    let asked: Promise<unknown> = Promise.resolve();
    await act(async () => {
      asked = host.pickPage().then((page) => void (chosen = page));
    });
    return { host, answer: async () => (await asked, chosen) };
  }

  it("lists the pages with where each lives, and answers the one picked", async () => {
    const { answer } = await ask();
    expect(screen.getByRole("dialog", { name: "Choose a page" })).toBeTruthy();
    const options = rows();
    expect(options.some((o) => o.startsWith("Route"))).toBe(true);
    expect(options.find((o) => o.startsWith("Route"))).toContain("Summer trip");
    expect(options.find((o) => o.startsWith("Ideas"))).toContain("library");
    fireEvent.click(screen.getByRole("option", { name: /Route/ }));
    await waitFor(async () => expect(await answer()).toMatchObject({ path: "projects/trip/route.md", title: "Route", project: "trip" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("searches by title, path and the first words, and answers the first match on Enter", async () => {
    const { answer } = await ask();
    const box = screen.getByRole("combobox", { name: "Find a page" });
    fireEvent.change(box, { target: { value: "routes" } });
    // "Ideas" says "routes" in its first words; "Route" is a title that does not contain it.
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatch(/^Ideas/);
    fireEvent.change(box, { target: { value: "pack" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(async () => expect(await answer()).toMatchObject({ path: "projects/trip/packing.md" }));
  });

  it("narrows the pages to a project", async () => {
    await ask();
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "trip" } });
    const paths = rows();
    expect(paths.some((p) => p.startsWith("Ideas"))).toBe(false);
    expect(paths.some((p) => p.startsWith("Packing"))).toBe(true);
  });

  it("puts the pages opened lately first, under a heading", async () => {
    const { host } = await open();
    useWorkspace.setState({ recent: ["projects/trip/packing.md", "library/ideas.md"] });
    render(<PagePickerHost />);
    await act(async () => void host.pickPage());
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(rows()[0]).toMatch(/^Packing/);
    expect(rows()[1]).toMatch(/^Ideas/);
    expect(screen.getAllByText("All pages").length).toBeGreaterThan(1);
  });

  it("answers none when it is closed, and a second ask cancels the first", async () => {
    const { host, answer } = await ask();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await answer()).toBeNull();
    let first: unknown = "waiting";
    await act(async () => {
      void host.pickPage().then((page) => (first = page));
      void host.pickPage();
    });
    await waitFor(() => expect(first).toBeNull());
  });
});
