// The Captures table inside a project: `/database` offers the capture tag's
// "This project" view in a project's page, and the embed shows only what is
// filed in that project (a view saved with `scope: project`).

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import capture from "../../../../crates/kasten-core/defaults/tags/capture.yaml?raw";
import type { LinkProvider } from "../pages/editor/links";
import { databaseSections } from "../pages/editor/menus/database-menu";
import { EmbeddedDatabase } from "../tags/EmbeddedDatabase";
import { projectFolderOf } from "../tags/model";
import { useTags } from "../tags/store";
import { TagDatabase } from "../tags/TagDatabase";
import { databaseLinks } from "../workspace/page/database-links";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";

const PLAN = "projects/trip/pages/plan.md";
const SEED = {
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\nA trip.\n",
  [PLAN]: "---\ntitle: Plan\n---\nRoute.\n",
  "projects/work/_project.md": "---\ntitle: Work\ntype: project\n---\nWork.\n",
  "projects/trip/cards/lighthouse.md": "---\ntitle: Lighthouse guide\ntype: card\ntags: [capture]\nprops:\n  site: example.com\n  captured: 2026-09-24\n---\nA page.\n",
  "projects/work/cards/report.md": "---\ntitle: Quarterly report\ntype: card\ntags: [capture]\n---\nA page.\n",
  "inbox/loose.md": "---\ntitle: Loose clip\ntype: card\ntags: [capture]\n---\nCaught.\n",
  "inbox/plain.md": "---\ntitle: Not a capture\ntype: card\n---\nA thought.\n",
  "tags/capture.yaml": capture,
};

beforeEach(async () => {
  localStorage.clear();
  useTags.setState({ schemas: null });
  await useWorkspace.getState().connect({ client: new MemoryVault(SEED) });
  await useTags.getState().load();
});
afterEach(cleanup);

describe("a page in a project", () => {
  it("is told its project from its path", () => {
    expect(projectFolderOf(PLAN)).toBe("trip");
    expect(projectFolderOf("projects/trip/_project.md")).toBe("trip");
    expect(projectFolderOf("inbox/loose.md")).toBeNull();
    expect(projectFolderOf("library/projects/x.md")).toBeNull();
    expect(projectFolderOf(null)).toBeNull();
  });

  it("is offered the capture database's view of its own project, with how many are filed there", () => {
    const here = databaseLinks(() => PLAN).databases();
    expect(here.find((d) => d.tag === "capture")).toEqual({ tag: "capture", path: "tags/capture.yaml", count: 3, inThisProject: { view: "This project", count: 1 } });
    // Outside a project there is no such view to offer.
    const elsewhere = databaseLinks(() => "inbox/plain.md").databases();
    expect(elsewhere.find((d) => d.tag === "capture")).toEqual({ tag: "capture", path: "tags/capture.yaml", count: 3 });
    expect(databaseLinks().databases().find((d) => d.tag === "capture")?.inThisProject).toBeUndefined();
  });

  it("lists that view first in /database, and picks it as the embed of that view", () => {
    const provider = (page: string): LinkProvider => ({ pages: () => [], open: () => {}, ...databaseLinks(() => page) });
    const links = provider(PLAN);
    const pick = vi.fn();
    const sections = databaseSections("", links, undefined, pick);
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual([undefined, "In this project", "Show a tag database"]);
    const item = sections[1]!.items[0]!;
    expect(item.label).toBe("#capture in this project");
    expect(item.hint).toBe("1 note");
    item.onPick?.();
    expect(pick).toHaveBeenCalledWith("tags/capture.yaml#This project");
    // Typing narrows it like the rest; a view kind asks for the usual list.
    expect(databaseSections("zzz", links, undefined, pick).map((s) => s.title)).toEqual([undefined, "Show a tag database"]);
    expect(databaseSections("", links, "table", pick).map((s) => s.title)).toEqual([undefined, "Show a database as a table"]);
    // Nothing to offer outside a project.
    expect(databaseSections("", provider("inbox/plain.md"), undefined, pick).map((s) => s.title)).toEqual([undefined, "Show a tag database"]);
  });
});

describe("the capture database embedded in a page", () => {
  it("shows only the captures filed in the page's project on its This project view", async () => {
    render(<EmbeddedDatabase tag="capture" initial="This project" page={() => PLAN} />);
    expect(await screen.findByText("Lighthouse guide")).toBeTruthy();
    expect(screen.queryByText("Quarterly report")).toBeNull();
    expect(screen.queryByText("Loose clip")).toBeNull();
    expect(screen.queryByText("Not a capture")).toBeNull();
  });

  it("shows nothing on that view in a page that is in no project, and everything on All", async () => {
    const { unmount } = render(<EmbeddedDatabase tag="capture" initial="This project" page={() => "inbox/plain.md"} />);
    await screen.findByRole("tab", { name: /This project/ });
    expect(screen.queryByText("Lighthouse guide")).toBeNull();
    expect(screen.queryByText("Loose clip")).toBeNull();
    unmount();
    render(<EmbeddedDatabase tag="capture" initial="All" page={() => "inbox/plain.md"} />);
    for (const title of ["Lighthouse guide", "Quarterly report", "Loose clip"]) expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByText("Not a capture")).toBeNull();
  });
});

describe("the Captures table on its own", () => {
  it("lists every capture, and explains the view that belongs to a project's page", async () => {
    localStorage.setItem("kasten.tagview.capture", "All");
    const { unmount } = render(<TagDatabase tag="capture" />);
    for (const title of ["Lighthouse guide", "Quarterly report", "Loose clip"]) expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /By site/ })).toBeTruthy();
    unmount();

    localStorage.setItem("kasten.tagview.capture", "This project");
    render(<TagDatabase tag="capture" />);
    const body = await screen.findByText(/lists the notes filed in one project/);
    expect(within(body.parentElement!).queryByText("Lighthouse guide")).toBeNull();
  });
});
