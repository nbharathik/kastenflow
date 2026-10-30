// A very long title breaks no layout and is never lost. Rows cut it with an
// ellipsis (the CSS says so) and keep all of it in their `title`, which the
// window's tooltip layer shows on hover and on keyboard focus; the palette's
// chosen row, which the keyboard holds by arrows, wraps it instead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatDock } from "../features/chat/ChatDock";
import { resetChat, scriptedChat } from "../features/chat/test-kit";
import { RecentRow } from "../features/home/RecentRow";
import { useBoards } from "../features/boards/store";
import { useTags } from "../features/tags/store";
import { Palette } from "../features/workspace/overlays/Palette";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { derive } from "../features/workspace/store-layout";
import { useWorkspace } from "../features/workspace/store";
import { initialLayout } from "../features/workspace/tabs";
import { noteAt } from "../features/workspace/tree";

const LONG = `An unreasonably long title ${"that keeps going and going ".repeat(25)}end`;
const css = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

afterEach(cleanup);

describe("a very long page title", () => {
  let vault: MemoryVault;
  beforeEach(async () => {
    localStorage.clear();
    vault = new MemoryVault({
      "library/long.md": `---\ntitle: ${LONG}\n---\nBody.\n`,
      "library/short.md": "---\ntitle: Short one\n---\nBody.\n",
    });
    resetChat(scriptedChat());
    useBoards.setState({ list: [], loaded: false });
    useTags.setState({ schemas: null });
    useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
  });

  it("in Home keeps its whole text in the row's tooltip, and the row cuts it with an ellipsis", () => {
    render(
      <ul>
        <RecentRow item={{ path: "library/long.md", type: "page", title: LONG, icon: "", project: null, modified: Date.now() }} project={null} tab onFocus={() => {}} />
      </ul>,
    );
    const row = screen.getByRole("button");
    expect(row.getAttribute("title")).toContain(LONG);
    expect(row.textContent).toContain(LONG);
    expect(css("features/home/recent.css")).toMatch(/\.kasten-home-row-title[\s\S]*?overflow: hidden;\s*text-overflow: ellipsis;\s*white-space: nowrap/);
  });

  it("in the palette is in the row's tooltip and name, and wraps while the arrows hold the row", () => {
    render(<Palette />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "unreasonably long" } });
    const option = screen.getAllByRole("option")[0]!;
    expect(option.getAttribute("title")).toContain(LONG);
    expect(option.textContent).toContain(LONG);
    const sheet = css("features/workspace/overlays/overlays.css");
    expect(sheet).toMatch(/\.kasten-palette-label \{[^}]*text-overflow: ellipsis/);
    expect(sheet).toMatch(/\.kasten-palette-row\[aria-selected="true"\] :is\(\.kasten-palette-label[^{]*\{[^}]*white-space: normal/);
  });

  it("in a context chip is in the chip's tooltip and in its buttons' names", async () => {
    useWorkspace.getState().openPath(noteAt(useWorkspace.getState().notes, "library/long.md")!.path);
    render(<ChatDock />);
    const chips = await screen.findByRole("group", { name: "Context" });
    const chip = chips.querySelector<HTMLElement>(".kasten-chat-chip")!;
    expect(chip.getAttribute("title")).toBe(LONG);
    expect(within(chips).getByRole("button", { name: `Remove ${LONG}` })).toBeTruthy();
    expect(css("features/chat/composer.css")).toMatch(/\.kasten-chat-chip-label \{[^}]*text-overflow: ellipsis/);
    expect(css("features/chat/composer.css")).toMatch(/\.kasten-chat-chip \{[^}]*max-width: 240px/);
  });

  it("in a table cell is in the cell's tooltip", () => {
    const cell = readFileSync(join(process.cwd(), "src", "features/tags/views/table/Cell.tsx"), "utf8");
    expect(cell).toContain("title={titleOf(note)}");
    expect(css("features/tags/views/table/cells.css")).toMatch(/\.kasten-table-title,[\s\S]*?overflow: hidden;\s*text-overflow: ellipsis/);
  });
});
