// Getting to Collections through the app: the palette's "Go to Collections"
// and its "Save “…” as a collection…" row, with the view's code loaded the
// first time it is wanted (given time on a busy machine).

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { AppShell } from "../../shell/AppShell";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { useCollectionRequests } from "./requests";

const SEED = {
  "library/a.md": "---\ntitle: Spark\ntags: [reading]\n---\nA bright idea.\n",
  "library/b.md": "---\ntitle: Plain\n---\nNothing tagged.\n",
};
const LOAD = { timeout: 60_000 };

beforeEach(() => {
  localStorage.clear();
  useCollectionRequests.getState().clear();
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: ["library/b.md"], toasts: [] });
  useShell.setState({ sidebarOpen: true, paletteOpen: false, gallery: null });
});
afterEach(cleanup);

async function palette(text: string) {
  render(<AppShell connect={async () => ({ client: new MemoryVault(SEED) })} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
  act(() => useShell.getState().setPalette(true));
  const dialog = await screen.findByRole("dialog", { name: "Search and commands" });
  const box = within(dialog).getByRole("textbox", { name: "Search" });
  fireEvent.change(box, { target: { value: text } });
  return { dialog, box };
}

describe("reaching Collections", () => {
  it("opens from the palette, which names it", async () => {
    const { dialog, box } = await palette("go to collections");
    expect(within(dialog).getAllByRole("option")[0]!.textContent).toContain("Go to Collections");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(await screen.findByRole("navigation", { name: "Collections" }, LOAD)).toBeTruthy();
    expect(useWorkspace.getState().place.view).toBe("collections");
    expect(await screen.findByRole("heading", { name: "Keep a search" })).toBeTruthy();
  }, 120_000);

  it("keeps what was searched as a collection, starting the dialog from the search", async () => {
    const { dialog } = await palette("tag:reading");
    const row = within(dialog).getByRole("option", { name: /as a collection/ });
    expect(row.textContent).toContain("Save “tag:reading” as a collection…");
    await act(async () => fireEvent.click(row));
    const form = await screen.findByRole("dialog", { name: "Save as collection" }, LOAD);
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("tag:reading");
    expect(within(form).getByText("tag:reading", { selector: "code" })).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(useCollectionRequests.getState().pending).toBeNull();
  }, 120_000);
});
