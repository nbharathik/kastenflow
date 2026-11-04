import { describe, expect, it } from "vitest";

import { EMOJI } from "./emoji.ts";
import { EMOJI_CATEGORIES, findEmoji } from "./emoji-groups.ts";

const names = EMOJI_CATEGORIES.flatMap((category) => category.items.flatMap((item) => item.names));

describe("the emoji of the picker", () => {
  it("hold every shortcode the text knows, each in one category, and no name it does not know", () => {
    expect([...names].sort()).toEqual(Object.keys(EMOJI).sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("have one entry for each picture, with every name that stands for it", () => {
    const all = EMOJI_CATEGORIES.flatMap((category) => category.items);
    expect(new Set(all.map((item) => item.glyph)).size).toBe(all.length);
    expect(all.find((item) => item.glyph === "👍")?.names).toEqual(["thumbsup", "+1"]);
    expect(all.find((item) => item.glyph === "✅")?.names).toEqual(["white_check_mark", "check"]);
    for (const item of all) expect(item.glyph).toBe(EMOJI[item.names[0] as string]);
  });

  it("are found by any of their names, with the underscores read as spaces, or by their category", () => {
    const glyphs = (search: string) => findEmoji(search).flatMap((category) => category.items.map((item) => item.glyph));
    expect(glyphs("rocket")).toEqual(["🚀"]);
    expect(glyphs(":rocket:")).toEqual(["🚀"]);
    expect(glyphs("sweat smile")).toEqual(["😅"]);
    expect(glyphs("check")).toEqual(["✅"]);
    expect(glyphs("+1")).toEqual(["👍"]);
    expect(glyphs("faces").length).toBe(EMOJI_CATEGORIES[0]?.items.length);
    expect(glyphs("no such thing")).toEqual([]);
  });

  it("drop a category with nothing left, and show everything for an empty search", () => {
    expect(findEmoji("rocket").map((category) => category.title)).toEqual(["Objects & food"]);
    expect(findEmoji("  ")).toHaveLength(EMOJI_CATEGORIES.length);
  });
});
