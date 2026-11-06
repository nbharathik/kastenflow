import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { paletteItems } from "../dialogs/insert-items.ts";
import { commandItems } from "../dialogs/palette-commands.ts";
import { BLOCKS } from "../ideas/blocks.ts";
import { insertItems } from "../insert/model.ts";
import { MemoryHost } from "../memory-host.ts";
import { barMenus } from "../menus/bar-menus.ts";
import { flattenMenus } from "../menus/search.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { type CommandContext, commandOf, isEnabled, runCommand } from "./index.ts";

async function context(host = new MemoryHost()): Promise<CommandContext> {
  const session = new EditorSession(await newDeck("Extras", "Light"), host, { saveDelay: 60_000, onError: () => {} });
  session.slides.add({ layout: "blank" });
  return { session, ui: new EditorUi() };
}

describe("the panels", () => {
  it("open and close the design ideas and the undo history, one at a time, and say which is open", async () => {
    const c = await context();
    const ideas = commandOf("view.ideas-panel");
    const history = commandOf("view.history-panel");
    await runCommand("view.ideas-panel", c);
    expect(c.ui.state.panel).toBe("ideas");
    expect(ideas.checked?.(c.session.state, c.ui.state)).toBe(true);
    await runCommand("view.history-panel", c);
    expect(c.ui.state.panel).toBe("history");
    expect(ideas.checked?.(c.session.state, c.ui.state)).toBe(false);
    await runCommand("view.history-panel", c);
    expect(c.ui.state.panel).toBeNull();
    expect(history.checked?.(c.session.state, c.ui.state)).toBe(false);
  });

  it("are in the menus and the command palette", async () => {
    const c = await context();
    const hits = flattenMenus(barMenus(c));
    const ids = (menu: string) => hits.filter((hit) => hit.path[0] === menu).map((hit) => hit.id);
    expect(ids("View")).toEqual(expect.arrayContaining(["view.ideas-panel", "view.history-panel"]));
    expect(ids("Slide")).toContain("view.ideas-panel");
    expect(ids("Edit")).toContain("view.history-panel");
    const labels = commandItems(c).map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["Design ideas", "Undo history"]));
  });
});

describe("icons and blocks", () => {
  it("open the icon picker from Insert, under Media, and the palette lists it once", async () => {
    const c = await context();
    expect(insertItems(c, "media").map((item) => item.command)).toContain("insert.icon");
    await runCommand("insert.icon", c);
    expect(c.ui.state.dialog).toBe("icons");
    expect(paletteItems(c).filter((item) => item.label === "Icon…")).toHaveLength(1);
  });

  it("put each block on the slide from the command, listed under Smart parts and in the palette", async () => {
    const c = await context();
    const smart = insertItems(c, "smart").map((item) => item.command);
    for (const block of BLOCKS) {
      expect(smart, block.kind).toContain(`insert.block.${block.kind}`);
      expect(paletteItems(c).filter((item) => item.label === `${block.label} block`), block.kind).toHaveLength(1);
    }
    await runCommand("insert.block.timeline", c);
    expect(c.session.slide.elements).toHaveLength(1);
    expect(c.session.slide.elements[0]?.type).toBe("group");
  });
});

describe("the assistant and the brand kit", () => {
  it("are left out of Tools where the host has neither", async () => {
    const c = await context();
    const tools = flattenMenus(barMenus(c)).filter((hit) => hit.path[0] === "Tools");
    expect(tools.some((hit) => hit.id === "deck.brand-kit" || hit.id?.startsWith("ai."))).toBe(false);
    expect(isEnabled(commandOf("deck.brand-kit"), c)).toBe(false);
  });

  it("are in Tools where the host has them", async () => {
    const host = new MemoryHost();
    host.ai = { ask: async () => ({ status: "sent" }) };
    host.brand = { read: async () => null, save: async () => {} };
    const c = await context(host);
    const tools = flattenMenus(barMenus(c)).filter((hit) => hit.path[0] === "Tools");
    const ids = tools.map((hit) => hit.id);
    expect(ids).toEqual(expect.arrayContaining(["deck.brand-kit", "ai.layout", "ai.notes", "ai.check"]));
    expect(tools.find((hit) => hit.id === "ai.layout")?.path).toContain("Write with AI");
    expect(isEnabled(commandOf("deck.brand-kit"), c)).toBe(true);
    await runCommand("deck.brand-kit", c);
    expect(c.ui.state.dialog).toBe("brand");
  });
});
