// What a page's sections become as slides.

import { describe, expect, it } from "vitest";

import { slideOf, slidesOfSections } from "./section-slides";

const slide = (title: string, markdown: string) => slideOf({ title, markdown });

describe("a section as a slide", () => {
  it("puts its list on the slide and its prose in the speaker notes", () => {
    const made = slide("Plan", "## Plan\n\nBook the guesthouse before spring.\n\n- flights\n- guesthouse\n  - near the station\n\nConfirm with Ana.");
    expect(made).toEqual({
      title: "Plan",
      layout: null,
      body: "- flights\n- guesthouse\n  - near the station",
      notes: "Book the guesthouse before spring.\n\nConfirm with Ana.",
      pictures: 0,
    });
  });

  it("takes every kind of list item, and a to-do's words without its box", () => {
    const made = slide("T", "* star\n+ plus\n1. one\n2) two\n- [ ] open task\n- [x] done task");
    expect(made.body).toBe("- star\n- plus\n- one\n- two\n- open task\n- done task");
  });

  it("uses a first sentence of the prose when the section has no list, the rest staying in the notes", () => {
    const made = slide("Why", "It saves time. It also saves money, and a good deal of worry.\n\nSecond paragraph.");
    expect(made.body).toBe("- It saves time.");
    expect(made.layout).toBeNull();
    expect(made.notes).toBe("It saves time. It also saves money, and a good deal of worry.\n\nSecond paragraph.");
    expect(slide("Long", `${"word ".repeat(80)}end.`).body.length).toBeLessThan(205);
  });

  it("is a divider slide when it has no words at all", () => {
    expect(slide("Part two", "## Part two")).toEqual({ title: "Part two", layout: "section", body: "", notes: "", pictures: 0 });
    expect(slide("Pictures", "![a chart](assets/chart.png)").layout).toBe("section");
  });

  it("does not say its own title twice, but keeps the other headings as bold lines", () => {
    expect(slide("Plan", "## Plan\n\n### Dates\n\n- May").body).toBe("- **Dates**\n- May");
    expect(slide("Plan", "# Intro\n\n- a").body).toBe("- **Intro**\n- a");
    // A title that only looks the same later in the section is a line of it.
    expect(slide("Plan", "- a\n\n## Plan").body).toBe("- a\n- **Plan**");
  });

  it("counts its pictures and embeds, which a slide does not take, and keeps links as the words they show", () => {
    const made = slide("Results", "![chart](assets/a.png)\n\n![[talk.deck]]\n\n![another](assets/b.png)\n\n- see [[Trip plan|the trip]] and [[Budget]]");
    expect(made.pictures).toBe(2);
    expect(made.body).toBe("- see the trip and Budget");
    expect(made.notes).toBe("");
  });

  it("keeps code whole, in the notes, and lists in code are not on the slide", () => {
    const made = slide("Code", "- real item\n\n```ts\n- not an item\nlet x = 1;\n\nlet y = 2;\n```\n\nafter");
    expect(made.body).toBe("- real item");
    expect(made.notes).toBe("```ts\n- not an item\nlet x = 1;\n\nlet y = 2;\n```\n\nafter");
    // An unclosed fence holds the rest.
    expect(slide("Open", "- a\n```\nstill code\n").notes).toBe("```\nstill code");
  });

  it("reads quotes as prose, and indents nested items by two spaces to a depth of three", () => {
    expect(slide("Q", "> a quoted line\n\n- a").notes).toBe("a quoted line");
    expect(slide("N", "- a\n    - b\n        - c\n                - d\n                        - e").body).toBe("- a\n  - b\n    - c\n      - d\n      - e");
  });

  it("turns every section of a page into a slide, in order", () => {
    expect(slidesOfSections([{ title: "One", markdown: "- a" }, { title: "Two", markdown: "" }]).map((s) => [s.title, s.layout])).toEqual([["One", null], ["Two", "section"]]);
  });
});
