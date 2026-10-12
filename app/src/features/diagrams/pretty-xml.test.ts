import { describe, expect, it } from "vitest";

import { prettyXml } from "./pretty-xml";

const ONE_LINE = '<mxfile host="embed.diagrams.net" type="embed"><diagram id="p1" name="Page-1"><mxGraphModel dx="1" dy="2"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Hello" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';

describe("a diagram written one element to a line", () => {
  it("has each element on a line of its own, indented by its depth", () => {
    const text = prettyXml(ONE_LINE);
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe('<mxfile host="embed.diagrams.net" type="embed">');
    expect(lines[1]).toBe('  <diagram id="p1" name="Page-1">');
    expect(lines[2]).toBe('    <mxGraphModel dx="1" dy="2">');
    expect(lines[3]).toBe("      <root>");
    expect(lines.at(-1)).toBe("</mxfile>");
    expect(lines).toContain('          <mxGeometry x="10" y="20" width="80" height="40" as="geometry"/>');
    expect(text.endsWith("</mxfile>\n")).toBe(true);
  });

  it("changes nothing but the spacing between elements", () => {
    const strip = (xml: string) => xml.replace(/>\s+</g, "><").trim();
    expect(strip(prettyXml(ONE_LINE))).toBe(ONE_LINE);
    // And is a fixed point: formatted again, it is the same text.
    expect(prettyXml(prettyXml(ONE_LINE))).toBe(prettyXml(ONE_LINE));
  });

  it("keeps a label's own line breaks, quotes and markup in its attribute", () => {
    const source = '<mxfile><diagram name="a"><mxGraphModel><root><mxCell id="2" value="line one&#xa;line &quot;two&quot; &lt;b&gt;bold&lt;/b&gt; &amp; more" vertex="1"/></root></mxGraphModel></diagram></mxfile>';
    const text = prettyXml(source);
    const value = new DOMParser().parseFromString(text, "application/xml").querySelector("mxCell")?.getAttribute("value");
    expect(value).toBe('line one\nline "two" <b>bold</b> & more');
    const before = new DOMParser().parseFromString(source, "application/xml").querySelector("mxCell")?.getAttribute("value");
    expect(value).toBe(before);
  });

  it("keeps a single model as a model and a diagram with compressed pages as it came", () => {
    expect(prettyXml("<mxGraphModel><root><mxCell id=\"0\"/></root></mxGraphModel>")).toBe('<mxGraphModel>\n  <root>\n    <mxCell id="0"/>\n  </root>\n</mxGraphModel>\n');
    const compressed = '<mxfile><diagram id="a" name="Page-1">7VnbbtswDP2avpeC3/3a1gXbMKArsC9GJZmZrMiRqNBO8/WDLDsXZ+0whPKyUDwkJYo6+ChDYZ+W+L5w0kgPsU=</diagram></mxfile>';
    expect(prettyXml(compressed)).toBe(compressed);
  });

  it("keeps what is not a diagram, or not well formed, as it came", () => {
    for (const text of ["", "not xml", "<html><body/></html>", "<mxfile><diagram></mxfile>", '<svg xmlns="http://www.w3.org/2000/svg"/>']) expect(prettyXml(text), text).toBe(text);
  });
});
