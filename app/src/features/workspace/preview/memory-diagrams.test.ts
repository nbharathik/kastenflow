import { describe, expect, it } from "vitest";

import { contentHash } from "./vault-text";
import { checkSvg, checkXml, contentOfSvg, diagramInPng, retarget, stamped, stampOf } from "./diagram-text";
import { MemoryVault } from "./memory-vault";

const XML = '<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
const withLabel = (label: string) => XML.replace('<mxCell id="1" parent="0" />', `<mxCell id="1" parent="0" /><mxCell id="2" value="${label}" vertex="1" parent="1" />`);

const PROJECT = "projects/trip/_project.md";
const ready = () => new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", "library/embeds.md": "# Embeds\n\n![[Login-flow.drawio]]\n\nSee [[library/Login-flow.drawio|the flow]] and [[Login-flow.drawio#x]].\n" });

describe("the checks of a diagram and its picture", () => {
  it("accept a diagram and say how many pages it has", () => {
    expect(checkXml(XML)).toBe(1);
    expect(checkXml("<mxGraphModel><root/></mxGraphModel>")).toBe(1);
    expect(checkXml('<mxfile><diagram name="a"/><diagram name="b"/></mxfile>')).toBe(2);
  });

  it("refuse what is not one", () => {
    for (const [text, why] of [
      ["", "Not a well-formed"],
      ["<html/>", "not a diagram"],
      ["<mxfile><diagram></mxfile>", "Not a well-formed"],
      ["<!DOCTYPE mxfile><mxfile/>", "declaration"],
    ] as const) expect(() => checkXml(text), text).toThrow(why);
    expect(() => checkXml(`<mxfile>${"x".repeat(5 * 1024 * 1024)}</mxfile>`)).toThrow("too large");
  });

  it("accept a picture only when it is an SVG that runs nothing", () => {
    checkSvg(SVG);
    expect(() => checkSvg("<mxfile/>")).toThrow("not an SVG");
    expect(() => checkSvg("<svg><script>alert(1)</script></svg>")).toThrow("script");
    expect(() => checkSvg("<svg><g></svg>")).toThrow("Not a well-formed");
  });

  it("stamp a picture with the hash of its source", () => {
    const s = stamped(SVG, "abc");
    expect(s.startsWith(SVG) && s.endsWith("-->\n")).toBe(true);
    expect(stampOf(s)).toBe("abc");
    expect(stampOf(SVG)).toBeNull();
    const again = stamped(s, "def");
    expect(stampOf(again)).toBe("def");
    expect(again.match(/kasten-source/g)).toHaveLength(1);
    checkSvg(again);
  });

  it("read the diagram out of a picture or a PNG the editor made", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${XML.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\n", "&#xa;")}"/>`;
    expect(contentOfSvg(svg)).toBe(XML);
    expect(contentOfSvg(SVG)).toBeNull();
    const chunk = (kind: string, data: number[]) => [(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...[...kind].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const text = (key: string, value: string) => chunk("tEXt", [...[...key].map((c) => c.charCodeAt(0)), 0, ...[...value].map((c) => c.charCodeAt(0))]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", Array(13).fill(0)), ...text("Software", "x"), ...text("mxfile", encodeURIComponent(XML)), ...chunk("IEND", [])]);
    expect(diagramInPng(png)).toBe(XML);
    expect(diagramInPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IEND", [])]))).toBeNull();
    expect(diagramInPng(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("keep links to a file where they went, by path always and by file name when nothing else has it", () => {
    const body = "![[Login-flow.drawio]]\nSee [[library/Login-flow.drawio|the flow]], [[Login-flow.drawio#x]], [[Login flow.md]] and `[[Login-flow.drawio]]`.\n";
    expect(retarget(body, "library/Login-flow.drawio", "library/Sign-in.drawio", true)).toBe("![[Sign-in.drawio]]\nSee [[library/Sign-in.drawio|the flow]], [[Sign-in.drawio#x]], [[Login flow.md]] and `[[Login-flow.drawio]]`.\n");
    expect(retarget(body, "library/Login-flow.drawio", "library/Sign-in.drawio", false)).toContain("[[library/Sign-in.drawio|the flow]]");
    expect(retarget(body, "library/Login-flow.drawio", "library/Sign-in.drawio", false)).toContain("![[Login-flow.drawio]]");
    expect(retarget("nothing here", "a.drawio", "b.drawio", true)).toBeNull();
  });
});

describe("diagrams in the preview", () => {
  it("creates diagrams where boards go and never replaces one", async () => {
    const vault = ready();
    expect(await vault.createDiagram("Login flow", null)).toBe("library/Login-flow.drawio");
    expect(await vault.createDiagram("Login flow", null)).toBe("library/Login-flow-2.drawio");
    expect(await vault.createDiagram("Q3 map", "trip")).toBe("projects/trip/diagrams/Q3-map.drawio");
    expect((await vault.diagram("library/Login-flow.drawio")).xml).toContain("<mxfile");
    await expect(vault.createDiagram("X", "nope")).rejects.toThrow("No project called nope");
    for (const bad of ["  ", "A|B", "A[1]"]) await expect(vault.createDiagram(bad, null)).rejects.toThrow("title");
    await expect(vault.createDiagram("X", null, "<html/>")).rejects.toThrow("not a diagram");
  });

  it("lists them by title with their project, pages and picture", async () => {
    const vault = ready();
    const a = await vault.createDiagram("Login flow", null, XML);
    await vault.createDiagram("annual map", "trip");
    await vault.saveDiagram(a, XML, SVG, contentHash(XML));
    const list = await vault.diagrams();
    expect(list.map((d) => [d.title, d.project, d.pages, d.preview])).toEqual([
      ["annual map", "trip", 1, "missing"],
      ["Login flow", null, 1, "fresh"],
    ]);
    expect(await vault.diagramPreview(a)).toContain("<svg");
    expect(await vault.diagramPreview("projects/trip/diagrams/annual-map.drawio".replace("annual-map", "annual-map"))).toBeNull();
  });

  it("writes the source and the picture together, and knows a picture that is out of date", async () => {
    const vault = ready();
    const path = await vault.createDiagram("Login flow", null);
    const blank = (await vault.diagram(path)).xml;
    const one = withLabel("One");
    const saved = await vault.saveDiagram(path, one, SVG, contentHash(blank));
    expect(saved.status).toBe("written");
    expect((await vault.diagram(path)).preview).toBe("fresh");
    const two = withLabel("Two");
    await vault.saveDiagram(path, two, null, contentHash(one));
    expect((await vault.diagram(path)).preview).toBe("stale");
    expect((await vault.saveDiagram(path, two, null, contentHash(two))).status).toBe("unchanged");
    await expect(vault.saveDiagram(path, "<html/>", SVG, contentHash(two))).rejects.toThrow("not a diagram");
    await expect(vault.saveDiagram(path, one, "<svg><g></svg>", contentHash(two))).rejects.toThrow("Not a well-formed");
    expect((await vault.diagram(path)).xml).toBe(two);
  });

  it("puts a save from an older read in a copy beside the file", async () => {
    const vault = ready();
    const path = await vault.createDiagram("Login flow", null);
    const base = contentHash((await vault.diagram(path)).xml);
    const theirs = withLabel("Theirs");
    await vault.saveDiagram(path, theirs, null, base);
    const mine = withLabel("Mine");
    const result = await vault.saveDiagram(path, mine, SVG, base);
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") return;
    expect(result.diagram.xml).toBe(theirs);
    expect((await vault.diagram(path)).xml).toBe(theirs);
    expect(result.copy).toMatch(/^library\/Login-flow \(conflict \d{4}-\d{2}-\d{2} \d{2}-\d{2}\)\.drawio$/);
    expect((await vault.diagram(result.copy)).preview).toBe("fresh");
  });

  it("keeps a picture only for the source it was drawn from", async () => {
    const vault = ready();
    const path = await vault.createDiagram("Login flow", null, XML);
    const hash = contentHash(XML);
    expect((await vault.saveDiagramPreview(path, SVG, hash)).preview).toBe("fresh");
    await vault.saveDiagram(path, withLabel("Moved"), null, hash);
    await expect(vault.saveDiagramPreview(path, SVG, hash)).rejects.toThrow("changed");
  });

  it("renames, moves and copies both files, and keeps the embeds and cards pointing at them", async () => {
    const vault = ready();
    const path = await vault.createDiagram("Login flow", null, XML);
    await vault.saveDiagram(path, XML, SVG, contentHash(XML));
    const board = await vault.createBoard("Map", null);
    await vault.addToBoard(board, [path]);

    const moved = await vault.renameDiagram(path, "Sign in");
    expect(moved.path).toBe("library/Sign-in.drawio");
    expect(moved.moves).toEqual([
      ["library/Login-flow.drawio", "library/Sign-in.drawio"],
      ["library/Login-flow.drawio.svg", "library/Sign-in.drawio.svg"],
    ]);
    expect((await vault.diagram(moved.path)).preview).toBe("fresh");
    await expect(vault.diagram(path)).rejects.toThrow();
    expect((await vault.read("library/embeds.md")).text).toBe("# Embeds\n\n![[Sign-in.drawio]]\n\nSee [[library/Sign-in.drawio|the flow]] and [[Sign-in.drawio#x]].\n");
    expect((await vault.board(board)).nodes.find((n) => n.file)?.file).toBe("library/Sign-in.drawio");
    expect(moved.relinked).toContain("library/embeds.md");
    expect((await vault.renameDiagram(moved.path, "Sign in")).moves).toEqual([]);
    await expect(vault.renameDiagram(moved.path, "A|B")).rejects.toThrow("title");

    const inProject = await vault.moveDiagram(moved.path, "trip");
    expect(inProject.path).toBe("projects/trip/diagrams/Sign-in.drawio");
    expect((await vault.diagram(inProject.path)).preview).toBe("fresh");
    expect((await vault.moveDiagram(inProject.path, "trip")).moves).toEqual([]);
    const back = await vault.moveDiagram(inProject.path, null);
    expect(back.path).toBe("library/Sign-in.drawio");

    const copy = await vault.duplicateDiagram(back.path);
    expect(copy).toBe("library/Sign-in-copy.drawio");
    expect((await vault.diagram(copy)).preview).toBe("fresh");
  });

  it("takes both files to the trash as one thing and brings them back together", async () => {
    const vault = ready();
    const path = await vault.createDiagram("Login flow", "trip", XML);
    await vault.saveDiagram(path, XML, SVG, contentHash(XML));
    const trashed = await vault.trash(path);
    expect(await vault.diagrams()).toEqual([]);
    const listed = (await vault.listTrash()).filter((t) => t.original.includes(".drawio"));
    expect(listed.map((t) => [t.title, t.original])).toEqual([["Login flow", path]]);
    expect(await vault.readTrashed(trashed)).toBe(XML);
    await expect(vault.restore(trashed)).rejects.toThrow("restore it as one");
    // Something took its place meanwhile: both come back beside it.
    await vault.createDiagram("Login flow", "trip", withLabel("Other"));
    const back = await vault.restoreDiagram(trashed);
    expect(back).toBe("projects/trip/diagrams/Login-flow-2.drawio");
    expect((await vault.diagram(back)).preview).toBe("fresh");
    expect((await vault.listTrash()).filter((t) => t.original.includes(".drawio"))).toEqual([]);
    await expect(vault.restoreDiagram(trashed)).rejects.toThrow();
  });

  it("imports what the editor and other tools write", async () => {
    const vault = ready();
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(await vault.importDiagram("Flow chart.drawio", bytes(XML), null)).toBe("library/Flow-chart.drawio");
    expect(await vault.importDiagram("export.xml", bytes(XML), "trip")).toBe("projects/trip/diagrams/export.drawio");
    expect(await vault.importDiagram("Flow chart.drawio", bytes(XML), null)).toBe("library/Flow-chart-2.drawio");
    const escaped = XML.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\n", "&#xa;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="81px" content="${escaped}"><g/></svg>`;
    const pictured = await vault.importDiagram("sketch.drawio.svg", bytes(svg), null);
    expect(pictured).toBe("library/sketch.drawio");
    expect((await vault.diagram(pictured)).preview).toBe("fresh");
    for (const [name, content, why] of [
      ["x.drawio", "<html/>", "not a diagram"],
      ["x.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", "no diagram"],
      ["x.vsdx", "PK", "editor"],
      ["x.drawio", "", "Not a well-formed"],
    ] as const) await expect(vault.importDiagram(name, bytes(content), null), name).rejects.toThrow(why);
    await expect(vault.importDiagram("x.drawio", new Uint8Array([0xff, 0xfe]), null)).rejects.toThrow("UTF-8");
  });
});
