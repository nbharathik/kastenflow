// Present, the smart layout and a deck of the sections, reached from the page
// menu and from the palette.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TopBar } from "../../../shell/TopBar";
import { COMMANDS } from "../../workspace/overlays/commands";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { KEY_SECTIONS } from "../../shortcuts/catalog";

const PATH = "library/talk.md";
const said = () => useWorkspace.getState().toasts.map((t) => t.text).join(" ");
const run = (id: string) => COMMANDS.find((c) => c.id === id)!.run();

beforeEach(async () => {
  localStorage.clear();
  await useWorkspace.getState().connect({ client: new MemoryVault({ [PATH]: "---\ntitle: Talk\n---\nOne.\n\n---\n\nTwo.\n" }) });
  useWorkspace.getState().openPath(PATH);
  useWorkspace.setState({ toasts: [] });
});
afterEach(cleanup);

describe("the page menu", () => {
  const menu = () => {
    render(<TopBar pane={useWorkspace.getState().layout.panes[0]!} first />);
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    return screen.getByRole("menu", { name: "Page options" });
  };

  it("offers to present the page, to draw it in the smart layout, and to make a deck of its sections", () => {
    const options = menu();
    expect(within(options).getByRole("menuitem", { name: "Present this page" })).toBeTruthy();
    const layout = within(options).getByRole("menuitemcheckbox", { name: "Smart layout" });
    expect(layout.getAttribute("aria-checked")).toBe("false");
    expect(within(options).getByRole("menuitem", { name: "Turn sections into a deck" })).toBeTruthy();
    // They sit with the folding of sections.
    const labels = [...options.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent ?? "");
    const at = (label: string) => labels.findIndex((text) => text.includes(label));
    expect(at("Present this page")).toBeLessThan(at("Fold all sections"));
  });

  it("says how to make slides when the page is not open to present (nothing to show)", () => {
    const options = menu();
    fireEvent.click(within(options).getByRole("menuitem", { name: "Present this page" }));
    expect(said()).toContain("Nothing to present yet");
  });
});

describe("the palette", () => {
  it("has a command for each, listed with the other page commands for keys", () => {
    for (const id of ["present-page", "smart-layout", "sections-deck", "fold-sections", "unfold-sections"]) {
      expect(COMMANDS.some((c) => c.id === id), id).toBe(true);
      expect(KEY_SECTIONS.flatMap((s) => s.ids), id).toContain(id);
    }
    expect(COMMANDS.find((c) => c.id === "present-page")!.label).toBe("Present this page");
  });

  it("presents the open page, saying so when there is nothing to show, and does nothing off a page", () => {
    act(() => run("present-page"));
    expect(said()).toContain("Nothing to present yet");
    useWorkspace.setState({ toasts: [] });
    useWorkspace.getState().go({ view: "home" });
    act(() => run("present-page"));
    act(() => run("smart-layout"));
    act(() => run("sections-deck"));
    expect(said()).toBe("");
  });
});
