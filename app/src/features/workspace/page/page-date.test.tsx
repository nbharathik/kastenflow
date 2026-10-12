// A date on any page: `@` in the title sets the page's `date`, a chip shows it
// beside the title, and the chip's button clears it.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dayFrom, shortDay } from "../../../lib/dates";
import { useShell } from "../../../lib/store";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { NotePage } from "./NotePage";

const PATH = "library/trip.md";
let vault: MemoryVault;

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault({ [PATH]: "---\ntitle: Trip\n---\nPack the tent.\n" });
  useWorkspace.setState({ place: { view: "home" }, back: [], forward: [], toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(PATH);
  useShell.setState({ panels: [] });
});
afterEach(cleanup);

const title = async () => (await screen.findByRole("textbox", { name: "Page title" }, { timeout: 20_000 })) as HTMLTextAreaElement;
const dateOf = async () => (await vault.read(PATH)).meta.props.date;

describe("a page's date from its title", () => {
  it("sets the date through the vault, takes the typed words out and shows a chip", async () => {
    render(<NotePage client={vault} path={PATH} />);
    const field = await title();
    // The title is "Trip"; typing " @tomorrow" after it opens the date menu.
    await act(async () => void fireEvent.change(field, { target: { value: "Trip @tomorrow" } }));
    expect(document.querySelector(".kasten-menu")?.getAttribute("aria-label")).toBe("Date");
    await act(async () => void fireEvent.keyDown(field, { key: "Enter" }));
    const tomorrow = dayFrom(1);
    await waitFor(async () => expect(await dateOf()).toBe(tomorrow), { timeout: 5_000 });
    expect(field.value).toBe("Trip");
    const chip = await screen.findByRole("group", { name: /^Date:/ });
    expect(chip.textContent).toContain(shortDay(tomorrow));
  });

  it("clears the date from the chip", async () => {
    await vault.updateProps(PATH, { date: dayFrom(2) });
    await useWorkspace.getState().refresh();
    render(<NotePage client={vault} path={PATH} />);
    await title();
    const chip = await screen.findByRole("group", { name: /^Date:/ });
    await act(async () => void fireEvent.click(within(chip).getByRole("button", { name: "Remove date" })));
    await waitFor(async () => expect(await dateOf()).toBeUndefined(), { timeout: 5_000 });
    await waitFor(() => expect(screen.queryByRole("group", { name: /^Date:/ })).toBeNull());
  });
});
