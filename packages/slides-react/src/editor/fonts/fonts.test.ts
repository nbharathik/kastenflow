import type { DeckFont } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { fontEntry } from "./fonts-file.ts";
import { rowsOf } from "./FontsDialog.tsx";

const carried = [{ family: "Lobster", src: "assets/fonts/Lobster.ttf" }] as DeckFont[];

describe("the rows of the font browser", () => {
  it("list the deck's fonts first, then the bundled ones, then the computer's, each family once", () => {
    const rows = rowsOf(carried, ["Arial", "inter", "Zapfino"], "");
    expect(rows[0]).toEqual({ family: "Lobster", where: "deck" });
    expect(rows.filter((row) => row.family.toLowerCase() === "inter")).toEqual([{ family: "Inter", where: "bundled" }]);
    expect(rows.at(-1)).toEqual({ family: "Zapfino", where: "system" });
    expect(rows.map((row) => row.family).indexOf("Arial")).toBeGreaterThan(rows.map((row) => row.family).indexOf("Inter"));
  });

  it("keep the ones that match what was typed, whatever its case", () => {
    expect(rowsOf(carried, ["Arial", "Garamond"], "ROBOTO").map((row) => row.family)).toEqual(["Roboto", "Roboto Mono"]);
    expect(rowsOf(carried, [], "nothing like this")).toEqual([]);
  });
});

describe("the entry for a font file", () => {
  it("takes the family, weight and style from the name, and leaves the licence flag off", () => {
    expect(fontEntry("Inter-BoldItalic.woff2", "assets/Inter-BoldItalic.woff2")).toEqual({ family: "Inter", src: "assets/Inter-BoldItalic.woff2", bold: true, italic: true });
    expect(fontEntry("Lobster.ttf", "assets/Lobster.ttf")).toEqual({ family: "Lobster", src: "assets/Lobster.ttf" });
  });
});
