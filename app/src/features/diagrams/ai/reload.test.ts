// An editor that is open when an agent's change to its diagram is applied: it loads the file when nothing is unsaved, keeps the
// person's work when something is, and draws the picture of what it loaded without writing the source again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import type { EditorAction } from "../protocol";
import { DrawioSession } from "../session";
import { reloadFromDisk } from "./reload";

const XML = '<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';
const withBox = (xml: string, label: string) => xml.replace("</root>", `<mxCell id="2" value="${label}" vertex="1" parent="1"/></root>`);
const oneLine = (label: string) => `<mxfile host="embed"><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>`;
const dataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px"><text>drawn</text></svg>';

/** An open editor on a diagram: a session whose frame is a stand-in that answers an export with a picture. */
async function open(options: { slow?: Promise<void> } = {}) {
  const vault = new MemoryVault({});
  const path = await vault.createDiagram("Flow", null, XML);
  const file = await vault.diagram(path);
  const posted: EditorAction[] = [];
  const client = {
    diagram: (p: string) => vault.diagram(p),
    saveDiagramPreview: (...args: Parameters<MemoryVault["saveDiagramPreview"]>) => vault.saveDiagramPreview(...args),
    // With `slow`, the write lands in the file and its answer is held back.
    saveDiagram: async (...args: Parameters<MemoryVault["saveDiagram"]>) => {
      const saved = await vault.saveDiagram(...args);
      await options.slow;
      return saved;
    },
  };
  const session: DrawioSession = new DrawioSession({
    path,
    xml: file.xml,
    hash: file.hash,
    dark: false,
    client,
    post: (action) => {
      posted.push(action);
      if (action.action === "export") queueMicrotask(() => session.handle({ event: "export", format: action.format, data: dataUri(SVG), xml: null }));
    },
  });
  session.handle({ event: "init" });
  session.handle({ event: "load" });
  posted.length = 0;
  /** An agent's applied change: the file is written by someone else. */
  const agentWrites = async (label: string) => {
    const text = withBox((await vault.diagram(path)).xml, label);
    await vault.saveDiagram(path, text, null, (await vault.diagram(path)).hash);
    return text;
  };
  return { vault, path, session, posted, client, agentWrites };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the file compared with the open editor", () => {
  it("is the same when nobody changed it", async () => {
    const t = await open();
    expect(await reloadFromDisk(t.client, t.session)).toEqual({ outcome: "same" });
    expect(t.posted).toEqual([]);
    t.session.dispose();
  });

  it("is the same when it cannot be read", async () => {
    const t = await open();
    expect(await reloadFromDisk({ diagram: () => Promise.reject(new Error("gone")) }, t.session)).toEqual({ outcome: "same" });
    t.session.dispose();
  });

  it("is loaded into the editor when an agent's change was applied and nothing is unsaved", async () => {
    const t = await open();
    const text = await t.agentWrites("Cache");
    const hash = (await t.vault.diagram(t.path)).hash;
    expect(await reloadFromDisk(t.client, t.session)).toEqual({ outcome: "loaded", hash });
    // The editor is given what the file says, and the session now stands on it.
    expect(t.posted).toEqual([{ action: "load", xml: text, autosave: 1, dark: 0 }]);
    expect([t.session.hash, t.session.saved, t.session.latest]).toEqual([hash, text, text]);
    expect(t.session.unsaved).toBe(false);
    t.session.dispose();
  });

  it("draws the picture of what it loaded, once the editor has it, and does not write the source again", async () => {
    const t = await open();
    const text = await t.agentWrites("Cache");
    await reloadFromDisk(t.client, t.session);
    expect((await t.vault.diagram(t.path)).preview).not.toBe("fresh");
    expect(t.posted.filter((a) => a.action === "export")).toEqual([]);
    t.session.handle({ event: "load" });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.posted.filter((a) => a.action === "export")).toHaveLength(1);
    const now = await t.vault.diagram(t.path);
    expect(now.preview).toBe("fresh");
    // The agent's text, byte for byte: only the picture was written.
    expect(now.xml).toBe(text);
    expect(await t.vault.diagramPreview(t.path)).toContain("<svg");
    t.session.dispose();
  });

  it("is left alone when the person has drawn something that is not saved, and says which version it passed over", async () => {
    const t = await open();
    t.session.handle({ event: "autosave", xml: oneLine("Mine") });
    await t.agentWrites("Theirs");
    const hash = (await t.vault.diagram(t.path)).hash;
    expect(await reloadFromDisk(t.client, t.session)).toEqual({ outcome: "kept", hash });
    expect(t.posted).toEqual([]);
    expect(t.session.latest).toBe(oneLine("Mine"));
    t.session.dispose();
  });

  it("is not a change at all while the session's own save is landing", async () => {
    let release!: () => void;
    const t = await open({ slow: new Promise<void>((resolve) => (release = resolve)) });
    t.session.handle({ event: "autosave", xml: oneLine("Mine") });
    await vi.advanceTimersByTimeAsync(900);
    expect(t.session.writing).toBe(true);
    // The write has landed in the file but its answer has not come back: the file differs from what the session holds, and is its own.
    const landed = (await t.vault.diagram(t.path)).hash;
    expect(landed).not.toBe(t.session.hash);
    expect(await reloadFromDisk(t.client, t.session)).toEqual({ outcome: "same" });
    expect(t.posted).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.session.writing).toBe(false);
    expect(t.session.hash).toBe(landed);
    expect(await reloadFromDisk(t.client, t.session)).toEqual({ outcome: "same" });
    t.session.dispose();
  });
});

describe("loading a file into the session", () => {
  it("is refused before the editor is ready, and after it is closed", async () => {
    const vault = new MemoryVault({});
    const path = await vault.createDiagram("Flow", null, XML);
    const file = await vault.diagram(path);
    const posted: EditorAction[] = [];
    const session = new DrawioSession({ path, xml: file.xml, hash: file.hash, dark: false, client: vault, post: (a) => void posted.push(a) });
    expect(session.adopt(withBox(XML, "x"), "h")).toBe(false);
    session.handle({ event: "load" });
    session.dispose();
    expect(session.adopt(withBox(XML, "x"), "h")).toBe(false);
    expect(posted).toEqual([]);
  });

  it("is refused while the session has a change waiting, and nothing is posted", async () => {
    const t = await open();
    t.session.handle({ event: "autosave", xml: oneLine("Mine") });
    expect(t.session.unsaved).toBe(true);
    expect(t.session.adopt(withBox(XML, "x"), "h")).toBe(false);
    expect(t.posted).toEqual([]);
    t.session.dispose();
  });

  it("is refused for a session that only draws a picture: it never loads a file over a drawing", async () => {
    const vault = new MemoryVault({});
    const path = await vault.createDiagram("Flow", null, XML);
    const file = await vault.diagram(path);
    const session = new DrawioSession({ path, xml: file.xml, hash: file.hash, dark: false, client: vault, mode: "render", post: () => {} });
    session.handle({ event: "load" });
    expect(session.adopt(withBox(XML, "x"), "h")).toBe(false);
    session.dispose();
  });
});
