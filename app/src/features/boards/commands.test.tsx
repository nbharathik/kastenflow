// The palette's whiteboard commands: they act on the board in front, hide
// themselves elsewhere, and are part of the palette's list.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { COMMANDS } from "../workspace/overlays/commands";
import { derive } from "../workspace/store-layout";
import { useWorkspace } from "../workspace/store";
import { initialLayout } from "../workspace/tabs";
import { useBoardPrefs } from "./board-prefs";
import { BoardCanvas } from "./canvas/BoardCanvas";
import { mockReactFlow } from "./canvas/test/flow-mocks";
import { forgetTrails } from "./canvas/trail";
import { BOARD_COMMANDS } from "./commands";
import { useBoards } from "./store";

const MAIN = "library/main.canvas";
const SEED = { [MAIN]: JSON.stringify({ nodes: [{ id: "g", type: "group", label: "Ideas", x: 0, y: 0, width: 400, height: 300 }], edges: [], "x-kasten": { title: "Main" } }) };

const command = (id: string) => COMMANDS.find((c) => c.id === id)!;

beforeAll(mockReactFlow);
beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  useBoardPrefs.setState({ alwaysToolbar: false, minimap: false, doubleClick: "card" });
  const vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

describe("whiteboard commands in the palette", () => {
  it("are part of the palette's list", () => {
    for (const { id } of BOARD_COMMANDS) expect(COMMANDS.some((c) => c.id === id), id).toBe(true);
  });

  it("show only while a whiteboard is in front, and act on it", async () => {
    expect(command("board-focus").when!()).toBe(false);
    const view = render(<BoardCanvas path={MAIN} />);
    const board = await view.findByLabelText(/^Whiteboard:/);
    // Open, but not what the pane shows.
    expect(command("board-focus").when!()).toBe(false);
    act(() => useWorkspace.getState().go({ view: "boards", path: MAIN }));
    await waitFor(() => expect(useWorkspace.getState().place).toEqual({ view: "boards", path: MAIN }));
    await waitFor(() => expect(command("board-focus").when!()).toBe(true));
    expect(command("board-present").when!()).toBe(true);

    await act(async () => command("board-focus").run());
    await waitFor(() => expect(board.classList.contains("is-focus")).toBe(true));
    await act(async () => command("board-focus").run());
    await waitFor(() => expect(board.classList.contains("is-focus")).toBe(false));

    await act(async () => command("board-present").run());
    await waitFor(() => expect(board.classList.contains("is-presenting")).toBe(true));

    view.unmount();
    expect(command("board-focus").when!()).toBe(false);
  });

  it("flip the switches Settings holds, with no board open", () => {
    command("board-minimap").run();
    expect(useBoardPrefs.getState().minimap).toBe(true);
    command("board-toolbar").run();
    expect(useBoardPrefs.getState().alwaysToolbar).toBe(true);
    command("board-double-click").run();
    expect(useBoardPrefs.getState().doubleClick).toBe("sticky");
    command("board-double-click").run();
    expect(useBoardPrefs.getState().doubleClick).toBe("card");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});
