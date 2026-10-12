// A section is a soft frame with its name on a small chip: written in place,
// folded from the chevron, and chosen without a panel (its colour is the
// dot's, in the bar over it).

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { mockReactFlow } from "./test/flow-mocks";
import { forgetTrails } from "./trail";

const MAIN = "library/main.canvas";
const SEED = {
  [MAIN]: JSON.stringify({
    nodes: [
      { id: "g", type: "group", label: "Ideas", x: 0, y: 0, width: 600, height: 400, color: "4" },
      { id: "s1", type: "text", text: "Inside", x: 40, y: 80, width: 200, height: 100 },
    ],
    edges: [],
    "x-kasten": { title: "Main" },
  }),
};

let vault: MemoryVault;

beforeAll(mockReactFlow);
beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

async function open() {
  const view = render(<BoardCanvas path={MAIN} />);
  await view.findByLabelText(/^Whiteboard:/);
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(2));
  const section = () => view.container.querySelector<HTMLElement>('.react-flow__node[data-id="g"]')!;
  return { view, section };
}

describe("a section", () => {
  it("is a tinted frame with its name on a small chip and no header bar", async () => {
    const { section } = await open();
    const frame = section().querySelector<HTMLElement>(".kasten-section")!;
    expect(frame.classList.contains("is-tinted")).toBe(true);
    expect(frame.style.getPropertyValue("--tint")).toBe("var(--board-c4)");
    const chip = frame.querySelector(".kasten-section-chip")!;
    expect(within(chip as HTMLElement).getByText("Ideas")).toBeTruthy();
    // The strip across the top only holds the chip: it draws no bar of its own.
    const bar = frame.querySelector(".kasten-section-bar")!;
    expect(bar.children).toHaveLength(1);
    expect(bar.firstElementChild).toBe(chip);
  });

  it("renames in place on a double-click, and folds from the chevron", async () => {
    const { section } = await open();
    fireEvent.doubleClick(section());
    const field = (await screen.findByRole("textbox", { name: "Section name" })) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Plans" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.find((n) => n.id === "g")?.label).toBe("Plans"));

    const fold = within(section()).getByRole("button", { name: "Fold section" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.click(fold));
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.find((n) => n.id === "g")?.collapsed).toBe(true));
    expect(await within(section()).findByText("1 inside")).toBeTruthy();
    expect(within(section()).getByRole("button", { name: "Unfold section" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows corner handles and a thin outline when chosen, and no panel", async () => {
    const { view, section } = await open();
    fireEvent.click(section(), { shiftKey: true });
    await waitFor(() => expect(section().classList.contains("selected")).toBe(true));
    // The bar over it is a few small buttons and one dot, not a row of swatches.
    const bar = await screen.findByRole("toolbar", { name: "Selection" });
    expect(bar.querySelectorAll(".kasten-board-swatch")).toHaveLength(0);
    expect(within(bar).getByRole("button", { name: "Colour: Green" })).toBeTruthy();
    // Resize handles, four corners, and the lines between them draw nothing.
    expect(view.container.querySelectorAll(".kasten-resize-handle").length).toBe(4);
    // Connection dots only appear under the pointer, not for a chosen frame.
    expect(view.container.querySelectorAll(".kasten-side-handle")).toHaveLength(0);
  });
});
