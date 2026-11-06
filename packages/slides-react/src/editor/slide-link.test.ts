import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { slideLink } from "./slide-link.ts";

const box = { x: 0, y: 0, w: 100, h: 40 };
const words = (t: string, link?: string): Element => ({ type: "text", id: "t", ...box, text: { paragraphs: [{ runs: [{ t, ...(link ? { link } : {}) }] }] } }) as Element;
const shape = (link?: string): Element => ({ type: "shape", id: "s", shape: "rect", ...box, ...(link ? { link } : {}) }) as Element;

describe("the address a slide links to", () => {
  it("is the first web address linked from a box, in the order of the elements", () => {
    expect(slideLink({ elements: [shape("https://a.example/one"), shape("https://b.example/two")] })).toBe("https://a.example/one");
  });

  it("is also found in the words of a text box, and inside a group", () => {
    expect(slideLink({ elements: [words("Docs", "http://docs.example/")] })).toBe("http://docs.example/");
    const group = { type: "group", id: "g", ...box, children: [shape(), words("In", "https://deep.example/")] } as unknown as Element;
    expect(slideLink({ elements: [words("plain"), group] })).toBe("https://deep.example/");
  });

  it("leaves out links to a slide or a page of the host, which a phone cannot open", () => {
    expect(slideLink({ elements: [shape("slide:abc"), words("x", "page:notes/a.md")] })).toBeUndefined();
    expect(slideLink({ elements: [] })).toBeUndefined();
  });
});
