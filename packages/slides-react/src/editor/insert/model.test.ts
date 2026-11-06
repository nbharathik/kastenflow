import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { type CommandContext, COMMANDS } from "../commands/index.ts";
import { INSERTABLE } from "../composite-kinds.ts";
import { paletteItems } from "../dialogs/insert-items.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { INSERT_ENTRIES, INSERT_GROUPS, insertItems } from "./model.ts";

async function context(): Promise<CommandContext> {
  const session = new EditorSession(await newDeck("Insert model"), new MemoryHost(), { saveDelay: 60_000, onError: () => {} });
  session.slides.add({ layout: "blank" });
  return { session, ui: new EditorUi() };
}

describe("what Insert offers", () => {
  it("lists every kind of composite, the other charts and the emoji picker, each by a command that exists", () => {
    const listed = new Set(INSERT_ENTRIES.map((entry) => entry.command));
    for (const spec of INSERTABLE) expect(listed.has(`insert.${spec.kind}`), spec.kind).toBe(true);
    for (const id of ["insert.chart.line", "insert.chart.pie", "insert.emoji"]) expect(listed.has(id), id).toBe(true);
    for (const entry of INSERT_ENTRIES) expect(COMMANDS.has(entry.command), entry.command).toBe(true);
  });

  it("names a command once, and the groups an entry is also listed in are real groups", () => {
    const commands = INSERT_ENTRIES.map((entry) => entry.command);
    expect(new Set(commands).size).toBe(commands.length);
    const groups = INSERT_GROUPS.map((group) => group.id);
    for (const entry of INSERT_ENTRIES) for (const also of entry.alsoIn ?? []) expect(groups).toContain(also);
  });

  it("lists the web page under Media beside the video, and under Pages & links, but once overall", async () => {
    const c = await context();
    const media = insertItems(c, "media").map((item) => item.command);
    // Audio and icons joined the group, so the web page follows the video and the icon at the end.
    expect(media.indexOf("insert.embed")).toBeGreaterThan(media.indexOf("insert.video"));
    expect(media.at(-1)).toBe("insert.embed");
    expect(insertItems(c, "pages").map((item) => item.command)).toContain("insert.embed");
    expect(insertItems(c).filter((item) => item.command === "insert.embed")).toHaveLength(1);
  });

  it("puts a chart, a timer, a QR code and emoji in the insert palette, once each, and finds a chart by the words people use", async () => {
    const c = await context();
    const items = paletteItems(c);
    for (const label of ["Chart", "Line chart", "Pie chart", "Timer", "QR code", "Emoji…"]) {
      expect(items.filter((item) => item.label === label), label).toHaveLength(1);
    }
    expect(items.filter((item) => item.label === "Web page…")).toHaveLength(1);
    const chart = items.find((item) => item.label === "Chart");
    expect(chart?.group).toBe("Data");
    expect(chart?.keywords).toEqual(expect.arrayContaining(["graph", "plot"]));
    expect(items.find((item) => item.label === "Timer")?.group).toBe("Smart parts");
    // Every shape of the renderer is in the palette too.
    expect(items.filter((item) => item.shape !== undefined)).toHaveLength(34);
  });
});
