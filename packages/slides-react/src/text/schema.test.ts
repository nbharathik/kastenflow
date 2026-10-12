import type { Paragraph, Run, Text, Theme } from "@kasten-slides/wasm";
import { DOMParser as PMParser, DOMSerializer } from "prosemirror-model";
import { beforeAll, describe, expect, it } from "vitest";

import { docToText, textToDoc } from "./convert.ts";
import { MARK_ORDER } from "./marks.ts";
import { type TextSchema, createTextSchema } from "./schema.ts";
import { themeNamed } from "./test-support.ts";

let theme: Theme;
let schema: TextSchema;

beforeAll(async () => {
  theme = await themeNamed("Light");
  schema = createTextSchema(theme, "body");
});

const p = (...runs: Run[]): Paragraph => ({ runs });
const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });

/** A document written to the page and read back. */
function throughThePage(t: Text): { html: string; back: ReturnType<typeof textToDoc> } {
  const doc = textToDoc(t, schema);
  const holder = document.createElement("div");
  holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  return { html: holder.innerHTML, back: PMParser.fromSchema(schema).parse(holder) };
}

describe("the schema", () => {
  it("is a document of one or more paragraphs of text", () => {
    expect(schema.topNodeType.name).toBe("doc");
    expect(Object.keys(schema.nodes)).toEqual(["doc", "paragraph", "text"]);
    expect(schema.nodes.paragraph?.isTextblock).toBe(true);
    expect(() => schema.nodes.doc?.createChecked(null, [])).toThrow();
    expect(() => schema.nodes.doc?.createChecked(null, [schema.nodes.paragraph!.create()])).not.toThrow();
  });

  it("has a mark for each thing a run can set, nested in a fixed order", () => {
    expect(Object.keys(schema.marks)).toEqual([...MARK_ORDER]);
    for (const name of ["bold", "italic", "underline", "strike", "color", "size", "font", "link", "code", "math", "field"]) expect(schema.marks[name as keyof typeof schema.marks], name).toBeDefined();
  });

  it("does not carry a link or a field on to words typed after it", () => {
    const marked = (mark: "link" | "field" | "bold") => {
      const type = schema.marks[mark];
      const attrs = mark === "link" ? { href: "https://x.y" } : mark === "field" ? { name: "slideNumber" } : null;
      const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("abc", [type.create(attrs)])])]);
      return doc.resolve(4).marks().map((m) => m.type.name);
    };
    expect(marked("link")).toEqual([]);
    expect(marked("field")).toEqual([]);
    expect(marked("bold")).toEqual(["bold"]);
  });

  it("has a paragraph attribute for each setting of a paragraph, and one for what it does not know", () => {
    expect(Object.keys(schema.nodes.paragraph!.create().attrs)).toEqual(["align", "list", "level", "style", "spaceBefore", "spaceAfter", "lineSpacing", "step", "listStyle", "start", "bulletColor", "bulletSize", "marginLeft", "indent", "mark", "extra"]);
  });
});

describe("the page", () => {
  it("writes a paragraph as a div with the class ks-p and its style", () => {
    const { html } = throughThePage(text({ runs: [{ t: "Hi" }], align: "center", list: "bullet", level: 1 }));
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const paragraph = holder.firstElementChild as HTMLElement;
    expect(paragraph.tagName).toBe("DIV");
    expect(paragraph.className).toBe("ks-p");
    expect(paragraph.style.textAlign).toBe("center");
    // The first level has no list of its own here, so it keeps 24; the second needs 30 for its circle at 22 pt.
    expect(paragraph.style.paddingLeft).toBe("54px");
    expect(paragraph.style.textIndent).toBe("-30px");
    expect(paragraph.getAttribute("data-ks-p")).toBe('{"align":"center","list":"bullet","level":1}');
  });

  it("writes each mark as an element with the style the read-only drawing gives it", () => {
    const { html } = throughThePage(text(p({ t: "x", b: true, i: true, u: true, s: true, color: "accent2", size: 12, font: "Georgia", link: "https://x.y", code: true, math: true, field: "slideNumber" })));
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const names = [...holder.querySelectorAll("[data-ks]")].map((element) => element.getAttribute("data-ks"));
    expect(names).toEqual(["size", "code", "font", "bold", "italic", "math", "color", "link", "underline", "strike", "field"]);
    expect(holder.querySelector<HTMLElement>("[data-ks=size]")!.style.fontSize).toBe("16px");
    expect(holder.querySelector<HTMLElement>("[data-ks=bold]")!.style.fontWeight).toBe("700");
    expect(holder.querySelector<HTMLElement>("[data-ks=color]")!.style.color).toBe("rgb(234, 67, 53)");
    expect(holder.querySelector("[data-ks=link]")!.tagName).toBe("A");
    expect(holder.querySelector("[data-ks=link]")!.getAttribute("data-href")).toBe("https://x.y");
    expect(holder.querySelector("[data-ks=link]")!.hasAttribute("href")).toBe(false);
    expect(holder.querySelector("[data-ks=field]")!.getAttribute("data-field")).toBe("slideNumber");
  });

  it("reads back the same document for any text", () => {
    const shapes: Text[] = [
      text(p({ t: "plain" })),
      text(p({ t: "a", b: true }, { t: "b", i: true, color: "#12ab34" }, { t: "c", size: 8.5, font: 'Odd "Name"', link: "slide:s-1" })),
      text({ runs: [{ t: "x", u: true, s: true, code: true, math: true, field: "stepLabel", lang: "en", note: { a: [1, null] } } as Run], list: "number", level: 2, align: "justify", style: "caption", spaceBefore: 1.5, spaceAfter: 2, lineSpacing: 1.15, step: 3, bulletColor: "red" } as Paragraph),
      text(p({ t: "line one\nline two\n" }), p({ t: "" }), p({ t: "  spaced   out  " }), p({ t: "<b>&amp; \"quoted\" ; }</b>" })),
      text(p({ t: "日本語 😀 é" }, { t: "ok", b: true })),
    ];
    for (const shape of shapes) {
      const doc = textToDoc(shape, schema);
      const { back } = throughThePage(shape);
      expect(back.eq(doc), JSON.stringify(shape)).toBe(true);
      expect(docToText(back, shape)).toBe(shape);
    }
  });

  it("does not take a size, colour, font, link, field or extra fields it cannot make sense of from the page", () => {
    const holder = document.createElement("div");
    holder.innerHTML =
      '<div data-ks-p="{}">' +
      '<span data-ks="size" data-v="0">zero</span>' +
      '<span data-ks="size" data-v="abc">abc</span>' +
      '<span data-ks="color">nocolour</span>' +
      '<a data-ks="link" data-v="">nolink</a>' +
      '<span data-ks="unknown" data-v="1">unknown</span>' +
      "</div>";
    const doc = PMParser.fromSchema(schema).parse(holder);
    const runs = docToText(doc, { paragraphs: [] }).paragraphs[0]?.runs;
    expect(runs).toEqual([{ t: "zeroabcnocolournolinkunknown" }]);
  });

  it("reads a paragraph's settings from the page only when they are valid", () => {
    const holder = document.createElement("div");
    holder.innerHTML = `<div data-ks-p='{"align":"diagonal","list":"roman","level":-3,"spaceBefore":"x","lineSpacing":null,"step":1.5,"style":"caption"}'>one</div><div data-ks-p="not json">two</div><div data-ks-p="[1]">three</div>`;
    const doc = PMParser.fromSchema(schema).parse(holder);
    expect(docToText(doc, { paragraphs: [] }).paragraphs.map((paragraph) => paragraph)).toEqual([
      { runs: [{ t: "one" }], style: "caption" },
      { runs: [{ t: "two" }] },
      { runs: [{ t: "three" }] },
    ]);
  });

  it("keeps the text of a run whose html would be misread", () => {
    const { back } = throughThePage(text(p({ t: "</div><script>alert(1)</script>" })));
    expect(back.textContent).toBe("</div><script>alert(1)</script>");
  });
});
