// Tidy: the editor's own layout, laid over the diagram the editor holds. What is waiting is written first; the laid-out diagram comes
// back as an autosave and is saved like any change.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import type { EditorAction } from "../protocol";
import { DrawioSession } from "../session";

const XML = '<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';
const oneLine = (label: string, x = 0) => `<mxfile host="embed"><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;

async function open() {
  const vault = new MemoryVault({});
  const path = await vault.createDiagram("Flow", null, XML);
  const file = await vault.diagram(path);
  const posted: EditorAction[] = [];
  const session = new DrawioSession({ path, xml: file.xml, hash: file.hash, dark: false, client: vault, post: (action) => void posted.push(action) });
  return { vault, path, session, posted };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Tidy", () => {
  it("does nothing before the editor is ready", async () => {
    const t = await open();
    expect(await t.session.tidy("verticalFlow")).toBe(false);
    expect(t.posted).toEqual([]);
    t.session.dispose();
  });

  it("asks the editor for the layout when nothing is waiting", async () => {
    const t = await open();
    t.session.handle({ event: "load" });
    expect(await t.session.tidy("horizontalFlow")).toBe(true);
    expect(t.posted).toEqual([{ action: "layout", layouts: [{ layout: "mxHierarchicalLayout", config: { orientation: "west" } }] }]);
    t.session.dispose();
  });

  it("writes what is waiting before it asks, so History keeps the diagram as it was", async () => {
    const t = await open();
    t.session.handle({ event: "load" });
    t.session.handle({ event: "autosave", xml: oneLine("Before") });
    expect((await t.vault.diagram(t.path)).xml).toBe(XML);
    expect(await t.session.tidy("verticalTree")).toBe(true);
    // The change was written, and only then was the layout asked for.
    expect((await t.vault.diagram(t.path)).xml).toContain('value="Before"');
    expect(t.posted.at(-1)).toMatchObject({ action: "layout" });
    expect(t.session.unsaved).toBe(false);
    t.session.dispose();
  });

  it("saves the laid-out diagram that comes back, like any change", async () => {
    const t = await open();
    t.session.handle({ event: "load" });
    t.session.handle({ event: "autosave", xml: oneLine("Box") });
    await t.session.tidy("organic");
    t.session.handle({ event: "autosave", xml: oneLine("Box", 240) });
    expect(t.session.unsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    expect((await t.vault.diagram(t.path)).xml).toContain('x="240"');
    expect(t.session.unsaved).toBe(false);
    t.session.dispose();
  });

  it("is not offered to a session that only draws a picture", async () => {
    const vault = new MemoryVault({});
    const path = await vault.createDiagram("Flow", null, XML);
    const file = await vault.diagram(path);
    const posted: EditorAction[] = [];
    const session = new DrawioSession({ path, xml: file.xml, hash: file.hash, dark: false, client: vault, mode: "png", post: (a) => void posted.push(a) });
    session.handle({ event: "load" });
    expect(await session.tidy("organic")).toBe(false);
    // It draws its PNG and nothing else: no layout is asked for.
    expect(posted.filter((a) => a.action === "layout")).toEqual([]);
    session.dispose();
  });
});
