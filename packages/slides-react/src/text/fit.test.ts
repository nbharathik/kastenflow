// @vitest-environment node

import { describe, expect, it } from "vitest";

import { fitHeight, fitScale, measureBox, measureRemembered } from "./fit.ts";

const insets = { left: 10, top: 5, right: 10, bottom: 5 };

describe("fitScale", () => {
  it("is 1 when the words fit as they are and the floor when they never do", () => {
    expect(fitScale(() => true)).toBe(1);
    expect(fitScale(() => false)).toBe(0.5);
    expect(fitScale(() => false, 0.3)).toBe(0.3);
  });

  it("finds the largest scale in hundredths", () => {
    expect(fitScale((s) => s <= 0.734)).toBe(0.73);
    expect(fitScale((s) => s <= 0.5)).toBe(0.5);
    expect(fitScale((s) => s <= 0.99)).toBe(0.99);
    expect(fitScale((s) => s <= 0.9999)).toBe(0.99);
  });

  it("tries few scales", () => {
    let tried = 0;
    fitScale((s) => {
      tried += 1;
      return s <= 0.61;
    });
    expect(tried).toBeLessThanOrEqual(10);
  });
});

/** A box that lays out words as a page would: the words are `chars` wide at the scale they have, wrapped to the width they get, in lines `line` tall. */
function fakeBox(chars: number, line: number, charWidth: number, shown = true) {
  const attributes = new Map<string, string>([["style", "width:100px;height:100px"]]);
  const style: Record<string, string> = {};
  const box = {
    style,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    get offsetHeight() {
      if (!shown) return 0;
      // A text box is placed with `inset: 0`: unless its bottom is let go as well, a height of `auto` is as tall as the space it is placed in, not as its words.
      if (style.bottom !== "auto") return 100;
      const width = Number.parseFloat(style.width ?? "0");
      const pad = Number.parseFloat((style.padding ?? "0px").split(" ")[0] ?? "0") * 2;
      const perLine = Math.max(1, Math.floor((width - 2 * Number.parseFloat((style.padding ?? "0px 0px").split(" ")[1] ?? "0")) / charWidth));
      return Math.ceil(chars / perLine) * line + pad;
    },
  };
  return { box: box as unknown as HTMLElement, attributes };
}

describe("measuring a box", () => {
  it("shrinks words until they fit and puts the style of the box back", () => {
    const { box, attributes } = fakeBox(400, 20, 8);
    const found = measureBox(box, { width: 200, height: 160, insets }, true);
    expect(found.measured).toBe(true);
    expect(found.scale).toBeLessThan(1);
    expect(found.scale).toBeGreaterThanOrEqual(0.5);
    expect(found.natural).toBeGreaterThan(160);
    expect(attributes.get("style")).toBe("width:100px;height:100px");
  });

  it("leaves words that fit alone, and says how tall words that may resize are", () => {
    const { box } = fakeBox(10, 20, 8);
    const found = measureBox(box, { width: 200, height: 160, insets }, true);
    expect(found.scale).toBe(1);
    const same = measureBox(box, { width: 200, height: 160, insets }, false);
    expect(same).toEqual({ scale: 1, natural: found.natural, measured: true });
  });

  it("finds nothing where there is no layout to ask", () => {
    const { box } = fakeBox(10, 20, 8, false);
    expect(measureBox(box, { width: 200, height: 160, insets }, true)).toEqual({ scale: 1, natural: 0, measured: false });
  });

  it("remembers what it found for what the layout depends on", () => {
    const { box } = fakeBox(400, 20, 8);
    const first = measureRemembered("same key", box, { width: 200, height: 160, insets }, true);
    const { box: other } = fakeBox(5, 20, 8);
    // The same key is the same layout, whatever box is asked.
    expect(measureRemembered("same key", other, { width: 200, height: 160, insets }, true)).toBe(first);
    expect(measureRemembered("another key", other, { width: 200, height: 160, insets }, true).scale).toBe(1);
  });

  it("works from the height words need at each scale", () => {
    // Drawn at a scale, the words are that much shorter; the insets in the height asked for were made as much bigger.
    const need = (scale: number) => 300 * scale + 10;
    expect(fitHeight({ width: 100, height: 200, insets }, need)).toBe(0.8);
  });
});
