import type { Deck, HeaderFooter, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { DATE_ID, FOOTER_ID, footerElements, formatDate, shownFooter } from "./footer.ts";

const day = new Date(2026, 10, 2); // Monday 2 November 2026

describe("a date in a format", () => {
  it("fills in the parts and keeps the rest", () => {
    expect(formatDate("d MMMM yyyy", day, "en-US")).toBe("2 November 2026");
    expect(formatDate("MMMM d, yyyy", day, "en-US")).toBe("November 2, 2026");
    expect(formatDate("dd/MM/yy", day, "en-US")).toBe("02/11/26");
    expect(formatDate("EEEE, MMM d", day, "en-US")).toBe("Monday, Nov 2");
    expect(formatDate("yyyy-MM-dd", day)).toBe("2026-11-02");
  });
});

describe("what a slide shows at its foot", () => {
  const deck: HeaderFooter = { footer: "Deck" };

  it("is the deck's, unless the slide has its own or hides it", () => {
    expect(shownFooter(deck, undefined, "title-body")).toEqual({ footer: "Deck" });
    expect(shownFooter(deck, { footer: "Mine" }, "title-body")).toEqual({ footer: "Mine" });
    expect(shownFooter(deck, { hidden: true }, "title-body")).toEqual({});
    expect(shownFooter(deck, { footer: "" }, "title-body")).toEqual({});
  });

  it("leaves the title slide out when the deck says so, unless the slide has its own", () => {
    const rule: HeaderFooter = { footer: "Deck", hideOnTitle: true };
    expect(shownFooter(rule, undefined, "title")).toEqual({});
    expect(shownFooter(rule, undefined, "section")).toEqual({ footer: "Deck" });
    expect(shownFooter(rule, { footer: "Cover" }, "title")).toEqual({ footer: "Cover" });
  });
});

describe("the footer boxes", () => {
  const slide = { id: "s-1", layout: "title-body", elements: [] } as unknown as Slide;
  const deck = (header: HeaderFooter | null) => ({ size: { w: 960, h: 540 }, present: { headerFooter: header } }) as unknown as Deck;

  it("are none for a deck without a footer", () => {
    expect(footerElements(deck(null), slide, day)).toEqual([]);
  });

  it("sit along the bottom, the date at the left and the footer in the middle", () => {
    const boxes = footerElements(deck({ footer: "Review", date: { format: "yyyy" } }), slide, day);
    expect(boxes.map((b) => b.id)).toEqual([DATE_ID, FOOTER_ID]);
    for (const b of boxes) {
      expect(b.y! > 540 * 0.85 && b.y! + b.h! <= 540).toBe(true);
    }
    expect(boxes[0]).toMatchObject({ text: { paragraphs: [{ runs: [{ t: "2026" }] }] } });
  });

  it("write a date typed by hand as it is", () => {
    const [date] = footerElements(deck({ date: { text: "Autumn term" } }), slide, day);
    expect(date).toMatchObject({ text: { paragraphs: [{ runs: [{ t: "Autumn term" }] }] } });
  });
});
