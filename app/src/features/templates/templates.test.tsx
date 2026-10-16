import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadNotePage } from "../workspace/page/LazyNotePage";

// The editor and the gallery load on demand; their load time is not what these tests are about.
beforeAll(async () => {
  await loadNotePage();
  await import("./TemplateGallery");
}, 60_000);

import { useShell } from "../../lib/store";
import { AppShell } from "../../shell/AppShell";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { catalog, filterCatalog } from "./catalog";
import { previewBlocks } from "./TemplatePreview";

const TRIP = [
  "---",
  'title: "{{title}}"',
  "icon: ✈️",
  "---",
  "> [!tip] Trip at a glance",
  "> **Where:** city on {{date}}",
  "",
  "## Itinerary",
  "",
  "<details>",
  "<summary>Day 1</summary>",
  "",
  "- Hidden inside",
  "",
  "</details>",
  "",
  "- [ ] Passport",
  "  - [x] Visa",
  "1. First",
  "",
  "| What | Cost |",
  "| --- | --- |",
  "| Stay | 0 |",
  "",
  "Plain words.",
].join("\n");

const SEED = {
  "templates/travel.md": TRIP,
  "templates/meeting.md": '---\ntitle: "{{title}}"\ntags: [meeting]\n---\n## Agenda\n',
  "templates/journal.md": '---\ntitle: "{{date}}"\ntype: journal\n---\n## Morning\n',
  "templates/my-own.md": '---\ntitle: "{{title}}"\n---\nMy own start.\n',
  "library/welcome.md": "---\ntitle: Welcome\n---\nHello.\n",
};

describe("template catalog", () => {
  it("groups starter templates, keeps the owner's own, hides the journal", async () => {
    const notes = await new MemoryVault(SEED).list();
    const list = catalog(notes);
    expect(list.map((t) => [t.name, t.category])).toEqual([
      ["meeting", "Work"],
      ["travel", "Travel"],
      ["my-own", "Your templates"],
    ]);
    expect(list[1]!.icon).toBe("✈️");
    expect(list[2]!.description).toBe("My own start.");
    expect(filterCatalog(list, "trip").map((t) => t.name)).toEqual(["travel"]);
    expect(filterCatalog(list, "work").map((t) => t.name)).toEqual(["meeting"]);
  });

  it("previews blocks with placeholders filled and toggles folded", () => {
    const blocks = previewBlocks(TRIP, "2026-09-24");
    expect(blocks).toEqual([
      { kind: "callout", tone: "tip", title: "Trip at a glance", lines: ["**Where:** city on 2026-09-24"] },
      { kind: "heading", level: 2, text: "Itinerary" },
      { kind: "toggle", summary: "Day 1" },
      { kind: "item", depth: 0, marker: "todo", n: 0, text: "Passport" },
      { kind: "item", depth: 1, marker: "done", n: 0, text: "Visa" },
      { kind: "item", depth: 0, marker: "number", n: 1, text: "First" },
      { kind: "table", head: ["What", "Cost"], rows: [["Stay", "0"]] },
      { kind: "para", text: "Plain words." },
    ]);
  });
});

describe("template gallery", () => {
  let vault: MemoryVault;
  beforeEach(() => {
    localStorage.clear();
    vault = new MemoryVault(SEED);
    useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
    useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, gallery: null });
  });
  afterEach(cleanup);

  it("finds a template, previews it and starts a titled page from it", async () => {
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useShell.getState().openGallery({}));
    const dialog = await screen.findByRole("dialog", { name: "Templates" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search templates" }), { target: { value: "trip" } });
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Trip plan")]);
    expect(await within(dialog).findByRole("article", { name: "Preview of Trip plan" })).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Title for the new page" }), { target: { value: "Seaside in May" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use template" })));
    expect(screen.queryByRole("dialog", { name: "Templates" })).toBeNull();
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "Seaside in May")?.icon).toBe("✈️");
  });

  it("opens a template's own page to edit it, with its name kept", async () => {
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useShell.getState().openGallery({}));
    const dialog = await screen.findByRole("dialog", { name: "Templates" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search templates" }), { target: { value: "trip" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Edit template" })));
    expect(screen.queryByRole("dialog", { name: "Templates" })).toBeNull();
    await expect.poll(() => useWorkspace.getState().place.path).toBe("templates/travel.md");
    const title = await screen.findByRole("textbox", { name: "Page title" }, { timeout: 5000 });
    expect((title as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it("closes on Escape from anywhere in it", async () => {
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useShell.getState().openGallery({}));
    const dialog = await screen.findByRole("dialog", { name: "Templates" });
    const option = within(dialog).getAllByRole("option")[0]!;
    option.focus();
    fireEvent.keyDown(option, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Templates" })).toBeNull();
  });

  it("offers starter templates a saved vault lacks", async () => {
    // A preview saved before recipes shipped: the seed has one, the stored files do not.
    const stored = { files: { "library/welcome.md": { text: SEED["library/welcome.md"], modified: 1 } }, trash: {} };
    vault = new MemoryVault({ ...SEED, "templates/recipe.md": '---\ntitle: "{{title}}"\n---\n## Ingredients\n' }, { load: () => JSON.stringify(stored), save: () => {} });
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useShell.getState().openGallery({}));
    const dialog = await screen.findByRole("dialog", { name: "Templates" });
    expect(await within(dialog).findByText("5 new templates for this vault")).toBeTruthy();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Add" })));
    await expect.poll(async () => (await vault.missingTemplates()).length).toBe(0);
    expect(await within(dialog).findByRole("option", { name: /Recipe/ })).toBeTruthy();
  });
});
