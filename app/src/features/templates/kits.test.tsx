// Starter kits in the app: the gallery's Starter kits tab adds one in a
// step and opens its home page, the palette opens that tab, and a page can
// be saved as a template from the gallery.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import type { KitInfo } from "../../lib/vault/types";
import { AppShell } from "../../shell/AppShell";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { kitContents } from "./kits";

const STOCK = import.meta.glob<string>(["../../../../crates/kasten-core/defaults/templates/*.md", "../../../../crates/kasten-core/defaults/tags/*.yaml"], { query: "?raw", import: "default", eager: true });
const SEED = {
  ...Object.fromEntries(Object.entries(STOCK).map(([key, text]) => [key.slice(key.indexOf("defaults/") + 9), text])),
  "library/welcome.md": "---\ntitle: Welcome\ntags: [meeting]\n---\nHello there.\n",
};

let vault: MemoryVault;

// The gallery loads when it is opened; its load time is not what these tests are about.
beforeAll(async () => {
  await import("./TemplateGallery");
}, 60_000);

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, gallery: null });
});
afterEach(cleanup);

async function gallery(kits: boolean) {
  render(<AppShell connect={async () => ({ client: vault })} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
  act(() => useShell.getState().openGallery(kits ? { kits: true } : {}));
  // The gallery's code loads when it is opened.
  return screen.findByRole("dialog", { name: "Templates" }, { timeout: 5000 });
}

describe("starter kits", () => {
  it("say what they add", () => {
    const kit = (files: string[]): KitInfo => ({ id: "k", icon: "", name: "K", summary: "", home: files[0]!, recommended: false, files });
    expect(kitContents(kit(["library/a.md", "library/b.md", "templates/journal.md", "tags/task.yaml"]))).toBe("2 pages, a journal template and 1 tag database");
    expect(kitContents(kit(["library/a.md", "library/map.canvas", "templates/x.md"]))).toBe("1 page, 1 template and 1 whiteboard");
  });

  it("are added from the gallery in one step, which opens the kit's page", async () => {
    const dialog = await gallery(true);
    const list = await within(dialog).findByRole("list", { name: "Starter kits" });
    await within(list).findByText("Getting Things Done");
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(within(list).getAllByRole("listitem")[0]!.textContent).toContain("Recommended");
    await act(async () => fireEvent.click(within(list).getByRole("button", { name: "Add Daily planner and journal" })));
    await expect.poll(() => useWorkspace.getState().place.path).toBe("library/daily-planner.md");
    expect(screen.queryByRole("dialog", { name: "Templates" })).toBeNull();
    expect((await vault.read("templates/journal.md")).text).toBe('---\ntitle: "{{date}}"\ntype: journal\n---\n');
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toContain("Added Daily planner and journal.");

    // Added once: the gallery offers to open it instead.
    act(() => useShell.getState().openGallery({ kits: true }));
    const again = await screen.findByRole("dialog", { name: "Templates" }, { timeout: 5000 });
    expect(await within(again).findByRole("button", { name: "Open Daily planner and journal" })).toBeTruthy();
  });

  it("switch with templates in the gallery", async () => {
    const dialog = await gallery(false);
    expect(within(dialog).getByRole("textbox", { name: "Search templates" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Starter kits" }));
    expect(await within(dialog).findByRole("list", { name: "Starter kits" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Templates" }));
    expect(within(dialog).queryByRole("list", { name: "Starter kits" })).toBeNull();
  });
});

describe("saving a page as a template", () => {
  it("makes a template from the page in front, with its tags", async () => {
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useWorkspace.getState().openPath("library/welcome.md"));
    act(() => useShell.getState().openGallery({}));
    const dialog = await screen.findByRole("dialog", { name: "Templates" }, { timeout: 5000 });
    expect(within(dialog).getByText("“Welcome” as a new template")).toBeTruthy();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
    await expect.poll(async () => (await vault.list()).some((n) => n.path === "templates/welcome.md")).toBe(true);
    expect((await vault.read("templates/welcome.md")).text).toBe('---\ntitle: "{{title}}"\ntype: page\ntags: [meeting]\n---\nHello there.\n');
    expect(within(dialog).getByRole("option", { selected: true }).textContent).toContain("Welcome");
  });
});

describe("a new vault made with a kit", () => {
  it("opens on the kit's page once, then as usual", async () => {
    localStorage.setItem("kasten.first-page", "library/welcome.md");
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    await expect.poll(() => useWorkspace.getState().place.path).toBe("library/welcome.md");
    expect(localStorage.getItem("kasten.first-page")).toBeNull();
  });
});
