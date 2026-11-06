import type { Deck } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { fontsForPage } from "./html-fonts.ts";

const deckWith = (fonts: unknown[]): Deck => ({ present: { fonts } }) as unknown as Deck;
const read = (files: Record<string, number[]>) => ({ readImage: async (path: string) => (files[path] ? new Uint8Array(files[path]) : undefined) });

describe("the fonts of an exported page", () => {
  it("are put in as data when the licence was marked as allowing it", async () => {
    const { css, notes } = await fontsForPage(deckWith([{ family: "Inter", src: "assets/fonts/Inter.woff2", embeddable: true }]), read({ "assets/fonts/Inter.woff2": [1, 2, 3] }));
    expect(notes).toEqual([]);
    expect(css).toContain('font-family: "Inter"');
    expect(css).toContain("url(\"data:font/woff2;base64,AQID\")");
  });

  it("are told of and left out when the licence was not marked", async () => {
    const { css, notes } = await fontsForPage(deckWith([{ family: "Lobster", src: "assets/fonts/Lobster.ttf" }]), read({ "assets/fonts/Lobster.ttf": [1] }));
    expect(css).toBe("");
    expect(notes[0]).toContain("Lobster");
    expect(notes[0]).toContain("licence");
  });

  it("are told of when the file cannot be read, and a deck with none gives nothing", async () => {
    const lost = await fontsForPage(deckWith([{ family: "Gone", src: "assets/fonts/Gone.otf", embeddable: true }]), read({}));
    expect(lost.css).toBe("");
    expect(lost.notes[0]).toContain("could not be read");
    expect(await fontsForPage(deckWith([]), read({}))).toEqual({ css: "", notes: [] });
    expect(await fontsForPage({ present: {} } as unknown as Deck, read({}))).toEqual({ css: "", notes: [] });
  });
});
