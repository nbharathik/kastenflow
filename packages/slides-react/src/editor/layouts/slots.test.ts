import { describe, expect, it } from "vitest";

import { sampleSlide } from "./sample.ts";
import { SLOT_KINDS, boxOfKind, freeRole, kindOfRole, promptOf, slotElement, slotLabel } from "./slots.ts";

describe("the slots a person puts on a layout", () => {
  it("number a role that is taken, the way slides-core does", () => {
    expect(freeRole("body", [])).toBe("body");
    expect(freeRole("body", ["body", "body2"])).toBe("body3");
    expect(freeRole("picture", ["image"])).toBe("image2");
    expect(freeRole("title", ["subtitle"])).toBe("title");
  });

  it("know the kind of a role with a number after it, and take anything else for words", () => {
    expect(kindOfRole("body2")).toBe("body");
    expect(kindOfRole("label")).toBe("subtitle");
    expect(kindOfRole("image3")).toBe("picture");
    expect(kindOfRole("something")).toBe("text");
    expect(SLOT_KINDS.map((choice) => slotLabel(choice.kind))).toEqual(["Title", "Subtitle", "Body (bullets)", "Text", "Picture", "Caption"]);
  });

  it("start in the places the built-in layouts put theirs, whatever the slide's shape", () => {
    expect(boxOfKind("title", { w: 960, h: 540 })).toEqual({ x: 64, y: 36, w: 832, h: 96 });
    const square = boxOfKind("title", { w: 720, h: 720 });
    expect(square.w).toBe(624);
    expect(square.y).toBe(48);
  });

  it("are elements that hold the words they ask for, set in the style their kind starts from", () => {
    const title = slotElement("title", "title", { x: 1, y: 2, w: 3, h: 4 });
    expect(title).toMatchObject({ type: "text", placeholder: "title", x: 1, text: { valign: "middle", paragraphs: [{ style: "title", runs: [{ t: promptOf("title") }] }] } });
    const body = slotElement("body", "body2", { x: 1, y: 2, w: 3, h: 4 });
    expect(body).toMatchObject({ placeholder: "body2", text: { paragraphs: [{ list: "bullet", style: "body" }] } });
    expect(slotElement("picture", "image", { x: 1, y: 2, w: 3, h: 4 })).toMatchObject({ type: "image", src: "", placeholder: "image" });
  });
});

describe("a layout's thumbnail slide", () => {
  const layout = {
    name: "poster",
    label: "Poster",
    placeholders: [
      { role: "title", kind: "text", x: 40, y: 30, w: 880, h: 100, style: "title", prompt: "Click to add title" },
      { role: "body", kind: "text", x: 40, y: 150, w: 500, h: 300, style: "body", list: "bullet", prompt: "Click to add text" },
      { role: "image", kind: "image", x: 560, y: 150, w: 360, h: 300, style: "caption", prompt: "Click to add image" },
      { role: "stat", kind: "text", x: 0, y: 0, w: 100, h: 40, style: "body", prompt: "Click to add a figure" },
    ],
  } as const;

  it("holds a word or a few points for each slot and a panel where a picture goes", () => {
    const slide = sampleSlide(layout as never);
    expect(slide.layout).toBe("poster");
    const [title, body, image, stat] = slide.elements as never as { type: string; placeholder?: string; text?: { paragraphs: { runs: { t: string }[]; list?: string }[] } }[];
    expect(title?.text?.paragraphs).toEqual([{ runs: [{ t: "Title" }] }]);
    expect(body?.text?.paragraphs.map((p) => p.runs[0]?.t)).toEqual(["Text", "Second point", "Third point"]);
    expect(body?.text?.paragraphs.every((p) => p.list === "bullet")).toBe(true);
    expect(image?.type).toBe("shape");
    expect(stat?.text?.paragraphs[0]?.runs[0]?.t, "any other role says what it asks for").toBe("A figure");
  });

  it("is the same slide for the same layout, so a thumbnail is drawn once", () => {
    expect(sampleSlide(layout as never)).toBe(sampleSlide(layout as never));
  });
});
