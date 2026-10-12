// An agent brainstorm can be reviewed and fully undone from the window.
// In the whole app on the browser preview's vault: a brainstorm from the
// board's bar, "Review" from its toast, the session in
// History with its changes, then "Undo session" puts the board and the
// notes back exactly as they were.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../../lib/store";
import { AppShell } from "../../../shell/AppShell";
import { previewChat } from "../../chat/preview/fake-chat";
import { useChat } from "../../chat/store";
import { useReview } from "../../review/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { mockReactFlow } from "../canvas/test/flow-mocks";
import { forgetTrails } from "../canvas/trail";
import { useBrainstorms } from "./run";

const BOARD = "projects/trip/boards/hilltown.canvas";
const SEED = {
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  "projects/trip/cards/guesthouse.md": "---\ntitle: Guesthouse\ntype: card\n---\nNear the station.\n",
  [BOARD]: JSON.stringify({
    nodes: [
      { id: "a", type: "file", file: "projects/trip/cards/guesthouse.md", x: 0, y: 0, width: 320, height: 180 },
      { id: "b", type: "text", text: "Book early", x: 400, y: 0, width: 260, height: 120 },
    ],
    edges: [],
    "x-kasten": { title: "Hilltown" },
  }),
};

let vault: MemoryVault;

beforeAll(async () => {
  await mockReactFlow();
  await import("../canvas/BoardCanvas");
  await import("../../review/History");
}, 60_000);

beforeEach(() => {
  localStorage.clear();
  forgetTrails();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: null, ready: false, notes: [], place: { view: "home" }, back: [], forward: [], recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
  useReview.setState({ proposals: [], loaded: false, error: null });
  useBrainstorms.setState({ running: {}, errors: {}, forms: {} });
  useChat.setState({ threads: {}, order: [], active: null });
  useChat.getState().connect(previewChat(() => vault, { pace: 0 }));
});
afterEach(cleanup);

describe("an agent brainstorm", () => {
  it("can be reviewed and fully undone from the UI", async () => {
    const board = (await vault.board(BOARD)).nodes;
    const notes = (await vault.list()).map((n) => n.path);
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useWorkspace.getState().openPath(BOARD));
    const canvas = await screen.findByLabelText(/^Whiteboard:/, undefined, { timeout: 5000 });
    await waitFor(() => expect(canvas.querySelectorAll(".react-flow__node")).toHaveLength(2));

    // Brainstorm from the board's "More" menu.
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Brainstorm with AI/ }));
    const form = await screen.findByRole("dialog", { name: "Brainstorm on this board" });
    fireEvent.change(await within(form).findByLabelText("Ideas about"), { target: { value: "Day trips" } });
    fireEvent.click(within(form).getByRole("radio", { name: "4" }));
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Brainstorm" })));
    await waitFor(() => expect(canvas.querySelectorAll(".react-flow__node")).toHaveLength(7), { timeout: 5000 });

    // Review: the toast opens History on the session, with every change.
    const toast = await screen.findByRole("button", { name: "Review" });
    fireEvent.click(toast);
    const tab = await screen.findByRole("tab", { name: /Agent sessions/ });
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
    const panel = screen.getByRole("tabpanel");
    const session = await within(panel).findByRole("button", { expanded: true, name: /kasten-brainstorm/ });
    expect(session.textContent).toContain("10 changes");
    // The placing and the section, newest first, then each card.
    const rows = [...panel.querySelectorAll("li li [data-change]")].map((summary) => summary.textContent);
    expect(rows.slice(0, 4)).toEqual(["Hilltown Made the section Day trips", "Hilltown Added 4 cards", "A budget per day Edited", "A budget per day Created"]);

    // Undo: every card and the section go, as one step.
    fireEvent.click(within(panel).getByRole("button", { name: "Undo session" }));
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Undo session" })));
    expect((await within(panel).findByRole("status")).textContent).toBe("Reverted 10 changes.");
    expect((await vault.board(BOARD)).nodes).toEqual(board);
    expect((await vault.list()).map((n) => n.path)).toEqual(notes);
    expect((await vault.listTrash()).map((t) => t.original)).toHaveLength(4);
    expect((await vault.sessions())[0]).toMatchObject({ client: "kasten-brainstorm", undone: true });
  });
});
