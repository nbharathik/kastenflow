import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { contentHash } from "../workspace/preview/vault-text";
import { textOfDataUri, type EditorAction } from "./protocol";
import { DrawioSession, type EditorStatus } from "./session";

const XML = '<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';
const oneLine = (label: string) => `<mxfile host="embed"><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>`;
const svgOf = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px"><text>${label}</text></svg>`;
const dataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/** A stand-in for the editor: answers an export with a picture of the last source it was given. */
function setup(options: { mode?: "edit" | "render" | "png"; answer?: boolean; xml?: string; exportXml?: string; scale?: number } = {}) {
  const vault = new MemoryVault({});
  const pngs: (Uint8Array | null)[] = [];
  const posted: EditorAction[] = [];
  const statuses: EditorStatus[] = [];
  const links: string[] = [];
  const moved: string[] = [];
  const done: boolean[] = [];
  let shown = options.xml ?? XML;
  let session!: DrawioSession;
  const ready = (async () => {
    const path = await vault.createDiagram("Login flow", null, options.xml ?? XML);
    const file = await vault.diagram(path);
    session = new DrawioSession({
      path,
      xml: file.xml,
      hash: file.hash,
      dark: false,
      client: vault,
      mode: options.mode,
      ...(options.scale === undefined ? {} : { scale: options.scale }),
      onPng: (bytes) => pngs.push(bytes),
      post: (action) => {
        posted.push(action);
        if (action.action === "export" && options.answer !== false) {
          const data = action.format === "png" ? `data:image/png;base64,${btoa("PNG!")}` : dataUri(svgOf(shown.length.toString()));
          queueMicrotask(() => session.handle({ event: "export", format: action.format, data, xml: options.exportXml ?? shown }));
        }
      },
      onStatus: (s) => statuses.push(s),
      onLink: (href) => links.push(href),
      onMoved: (p) => moved.push(p),
      onDone: (ok) => done.push(ok),
    });
    return { path, file };
  })();
  const edit = (xml: string) => {
    shown = xml;
    session.handle({ event: "autosave", xml });
  };
  const show = (xml: string) => {
    shown = xml;
  };
  return { vault, posted, pngs, statuses, links, moved, done, ready, edit, show, get session() { return session; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a diagram's conversation with the editor", () => {
  it("answers configure with plain XML, and init with the diagram saved as it changes", async () => {
    const t = setup();
    await t.ready;
    t.session.handle({ event: "configure" });
    expect(t.posted.at(-1)).toEqual({ action: "configure", config: { compressXml: false, suppressNewWindows: true } });
    t.session.handle({ event: "init" });
    expect(t.posted.at(-1)).toEqual({ action: "load", xml: XML, autosave: 1, dark: 0 });
    expect(t.statuses.at(-1)).toEqual({ kind: "loading" });
    t.session.handle({ event: "load" });
    expect(t.session.ready).toBe(true);
    expect(t.statuses.at(-1)).toEqual({ kind: "ready" });
    t.session.handle(null);
  });

  it("saves the source 800 ms after the last change, once, as the latest text", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("a"));
    await vi.advanceTimersByTimeAsync(500);
    t.edit(oneLine("ab"));
    await vi.advanceTimersByTimeAsync(500);
    t.edit(oneLine("abc"));
    expect(t.statuses.at(-1)).toEqual({ kind: "unsaved" });
    await vi.advanceTimersByTimeAsync(799);
    expect((await t.vault.diagram(path)).xml).toBe(XML);
    await vi.advanceTimersByTimeAsync(2);
    const saved = await t.vault.diagram(path);
    expect(saved.xml).toContain('value="abc"');
    expect(saved.xml).not.toContain('value="ab"');
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
    expect(t.session.hash).toBe(saved.hash);
  });

  it("writes the source one element to a line, not as the editor's one long line", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("a"));
    await vi.advanceTimersByTimeAsync(900);
    const text = (await t.vault.diagram(path)).xml;
    expect(text.split("\n").length).toBeGreaterThan(5);
    expect(text).toContain('\n    <mxGraphModel>\n      <root>\n');
  });

  it("draws and saves the picture once the diagram has been still for 2 s, the source with it", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("a"));
    await vi.advanceTimersByTimeAsync(900);
    // The source is kept already; there is no picture yet.
    expect((await t.vault.diagram(path)).preview).toBe("missing");
    expect(t.posted.filter((a) => a.action === "export")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1200);
    expect(t.posted.filter((a) => a.action === "export")).toEqual([{ action: "export", format: "xmlsvg", embedImages: true, border: 10, background: "#ffffff", theme: "light" }]);
    const file = await t.vault.diagram(path);
    expect(file.preview).toBe("fresh");
    expect(textOfDataUri(dataUri(svgOf("x")))).toContain("<svg");
    expect(await t.vault.diagramPreview(path)).toContain("<svg");
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
  });

  it("keeps the source the editor sent as the diagram changed, not the compressed copy of it that an export carries", async () => {
    // The real editor answers an export with `xml` in its compressed form, whatever `configure` asked for.
    const t = setup({ exportXml: '<mxfile host="x"><diagram id="p1" name="Page-1">jZLBboQgEIafhrtI2+xea7fbS08e9kxgKiQoBseq+/TVMqwa06QXAt/MPzP8wERRj9cgW/PpNTiWZ3pk4o3l+Ymf53UBUwTnUxZBFayOiK+g</diagram></mxfile>' });
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("plain"));
    await vi.advanceTimersByTimeAsync(3000);
    const file = await t.vault.diagram(path);
    expect(file.xml).toContain('value="plain"');
    expect(file.xml).not.toContain("jZLBboQg");
    expect(file.preview).toBe("fresh");
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
    // Nothing is drawn again for a diagram that is as it was drawn.
    const exports = t.posted.filter((a) => a.action === "export").length;
    await t.session.flush();
    expect(t.posted.filter((a) => a.action === "export")).toHaveLength(exports);
  });

  it("leaves a picture that was drawn before the last change out, and draws the next one", async () => {
    const t = setup({ answer: false });
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("one"));
    await vi.advanceTimersByTimeAsync(2100);
    expect(t.posted.filter((a) => a.action === "export")).toHaveLength(1);
    // The diagram changes while that picture is being drawn, then the first picture arrives.
    t.edit(oneLine("two"));
    t.session.handle({ event: "export", format: "svg", data: dataUri(svgOf("one")), xml: null });
    await vi.advanceTimersByTimeAsync(100);
    expect((await t.vault.diagram(path)).preview).not.toBe("fresh");
    // The change's own picture follows.
    await vi.advanceTimersByTimeAsync(2100);
    expect(t.posted.filter((a) => a.action === "export")).toHaveLength(2);
    t.session.handle({ event: "export", format: "svg", data: dataUri(svgOf("two")), xml: null });
    await vi.advanceTimersByTimeAsync(100);
    const file = await t.vault.diagram(path);
    expect(file.xml).toContain('value="two"');
    expect(file.preview).toBe("fresh");
    expect(await t.vault.diagramPreview(path)).toContain("two");
  });

  it("loads a template the editor picked, and saves the plain copy the editor gives of it, not the compressed one it sent", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    const compressed = '<?xml version="1.0" encoding="UTF-8"?>\n<mxfile><diagram id="x">7VhZc9MwEP41WPoWtRGbtF</diagram></mxfile>';
    // What the editor will hold once it has loaded the template.
    t.show(oneLine("template box"));
    t.session.handle({ event: "template", xml: compressed, name: "Flowchart.drawio" });
    expect(t.posted.at(-1)).toMatchObject({ action: "load", xml: compressed, autosave: 1 });
    // Nothing is saved from what was sent.
    await vi.advanceTimersByTimeAsync(3000);
    expect((await t.vault.diagram(path)).xml).toBe(XML);
    // The editor says it has it: its own copy is asked for and saved, with the picture.
    t.session.handle({ event: "load" });
    await vi.advanceTimersByTimeAsync(3500);
    expect(t.posted.some((a) => a.action === "export" && a.format === "xml")).toBe(true);
    const file = await t.vault.diagram(path);
    expect(file.xml).toContain('value="template box"');
    expect(file.xml).not.toContain("7VhZc9M");
    expect(file.preview).toBe("fresh");
    // Another `load` is not another template.
    const asked = t.posted.length;
    t.session.handle({ event: "load" });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.posted).toHaveLength(asked);
  });

  it("draws a PNG once, as the editor draws it, and saves nothing", async () => {
    const t = setup({ mode: "png", scale: 1.5 });
    const { path, file } = await t.ready;
    t.session.handle({ event: "init" });
    // Nothing is saved as it changes in this mode: the diagram is only drawn.
    expect(t.posted.at(-1)).toEqual({ action: "load", xml: XML, autosave: 0, dark: 0 });
    t.session.handle({ event: "load" });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.posted.at(-1)).toEqual({ action: "export", format: "png", scale: 1.5, border: 10, background: "#ffffff" });
    expect(t.pngs).toHaveLength(1);
    expect(new TextDecoder().decode(t.pngs[0]!)).toBe("PNG!");
    expect(t.done).toEqual([true]);
    // An autosave after that is not heard, and nothing is written.
    t.session.handle({ event: "autosave", xml: oneLine("late") });
    await vi.advanceTimersByTimeAsync(5000);
    const after = await t.vault.diagram(path);
    expect(after.hash).toBe(file.hash);
    expect(after.preview).toBe("missing");
  });

  it("tells that no PNG came when the editor does not answer", async () => {
    const t = setup({ mode: "png", answer: false });
    await t.ready;
    t.session.handle({ event: "load" });
    await vi.advanceTimersByTimeAsync(10_500);
    expect(t.pngs).toEqual([null]);
    expect(t.done).toEqual([false]);
  });

  it("writes everything waiting, picture included, when the diagram is left", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("last words"));
    const flushed = t.session.flush();
    await vi.advanceTimersByTimeAsync(10);
    await flushed;
    const file = await t.vault.diagram(path);
    expect(file.xml).toContain("last words");
    expect(file.preview).toBe("fresh");
    // Nothing more is written by the timers that were waiting.
    const before = file.hash;
    await vi.advanceTimersByTimeAsync(5000);
    expect((await t.vault.diagram(path)).hash).toBe(before);
  });

  it("does not wait forever for a picture: the source is kept and the picture is drawn another time", async () => {
    const t = setup({ answer: false });
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("no picture"));
    const flushed = t.session.flush();
    await vi.advanceTimersByTimeAsync(1600);
    await flushed;
    const file = await t.vault.diagram(path);
    expect(file.xml).toContain("no picture");
    expect(file.preview).toBe("missing");
  });

  it("saves nothing for a diagram that did not change", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.session.handle({ event: "autosave", xml: XML });
    await vi.advanceTimersByTimeAsync(5000);
    await t.session.flush();
    expect(t.posted.filter((a) => a.action === "export")).toHaveLength(0);
    expect((await t.vault.diagram(path)).hash).toBe(contentHash(XML));
  });

  it("goes on with a copy when the file was changed elsewhere meanwhile", async () => {
    const t = setup();
    const { path, file } = await t.ready;
    t.session.handle({ event: "load" });
    // An agent saved the diagram after the editor read it.
    await t.vault.saveDiagram(path, oneLine("theirs"), null, file.hash);
    t.edit(oneLine("mine"));
    await vi.advanceTimersByTimeAsync(900);
    expect(t.moved).toHaveLength(1);
    const copy = t.moved[0]!;
    expect(copy).toMatch(/^library\/Login-flow \(conflict .*\)\.drawio$/);
    expect(t.session.path).toBe(copy);
    expect(t.statuses.at(-1)).toEqual({ kind: "copy", path: copy });
    expect((await t.vault.diagram(path)).xml).toContain("theirs");
    expect((await t.vault.diagram(copy)).xml).toContain("mine");
    // The next change goes to the copy, on top of what it holds, with no second conflict.
    t.edit(oneLine("mine again"));
    await vi.advanceTimersByTimeAsync(900);
    expect(t.moved).toHaveLength(1);
    expect((await t.vault.diagram(copy)).xml).toContain("mine again");
    expect((await t.vault.diagram(path)).xml).toContain("theirs");
  });

  it("tells a failed save and tries again with the next change", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    const real = t.vault.saveDiagram.bind(t.vault);
    let fail = true;
    t.vault.saveDiagram = async (...args) => {
      if (fail) throw new Error("The disk is full");
      return real(...args);
    };
    t.edit(oneLine("a"));
    await vi.advanceTimersByTimeAsync(900);
    expect(t.statuses.at(-1)).toEqual({ kind: "error", message: "The disk is full" });
    fail = false;
    t.edit(oneLine("ab"));
    await vi.advanceTimersByTimeAsync(900);
    expect(t.statuses.at(-1)).toEqual({ kind: "saved" });
    expect((await t.vault.diagram(path)).xml).toContain('value="ab"');
  });

  it("hands a clicked link to the app, and its own save shortcut writes at once", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.session.handle({ event: "openLink", href: "https://example.com", target: "_blank" });
    expect(t.links).toEqual(["https://example.com"]);
    shownSave(t, oneLine("saved by shortcut"));
    await vi.advanceTimersByTimeAsync(10);
    expect((await t.vault.diagram(path)).xml).toContain("saved by shortcut");
  });

  it("ignores the editor once it is disposed", async () => {
    const t = setup();
    const { path } = await t.ready;
    t.session.handle({ event: "load" });
    t.edit(oneLine("late"));
    t.session.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    t.session.handle({ event: "autosave", xml: oneLine("later") });
    expect((await t.vault.diagram(path)).xml).toBe(XML);
  });
});

function shownSave(t: ReturnType<typeof setup>, xml: string) {
  t.show(xml);
  t.session.handle({ event: "save", xml, exit: false });
}

describe("a diagram drawn again for its picture", () => {
  it("is loaded without autosave, exported once, and its picture kept for that source", async () => {
    const t = setup({ mode: "render" });
    const { path } = await t.ready;
    t.session.handle({ event: "init" });
    expect(t.posted.at(-1)).toEqual({ action: "load", xml: XML, autosave: 0, dark: 0 });
    t.session.handle({ event: "load" });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.done).toEqual([true]);
    expect((await t.vault.diagram(path)).preview).toBe("fresh");
    // Changes the editor reports mean nothing to a render.
    t.session.handle({ event: "autosave", xml: oneLine("x") });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await t.vault.diagram(path)).xml).toBe(XML);
  });

  it("gives up quietly when the source changed meanwhile or the editor never answers", async () => {
    const changed = setup({ mode: "render", answer: false });
    const { path, file } = await changed.ready;
    changed.session.handle({ event: "load" });
    await changed.vault.saveDiagram(path, oneLine("moved"), null, file.hash);
    changed.session.handle({ event: "export", format: "xmlsvg", data: dataUri(svgOf("x")), xml: XML });
    await vi.advanceTimersByTimeAsync(10);
    expect(changed.done).toEqual([false]);
    const silent = setup({ mode: "render", answer: false });
    await silent.ready;
    silent.session.handle({ event: "load" });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(silent.done).toEqual([false]);
  });
});
