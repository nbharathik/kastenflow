import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { withoutHiddenAudio } from "./hidden-audio.ts";

const audio = (id: string, hidden?: boolean): Element => ({ type: "audio", id, src: "assets/a.mp3", ...(hidden ? { hidden } : {}) }) as unknown as Element;
const group = (id: string, children: Element[]): Element => ({ type: "group", id, children }) as unknown as Element;

describe("the sound chips a show leaves out", () => {
  it("takes out the hidden ones in a show, in groups too, and keeps the rest", () => {
    const list = [audio("a", true), audio("b"), group("g", [audio("c", true), audio("d")])];
    const shown = withoutHiddenAudio(list, "present");
    expect(shown.map((e) => e.id)).toEqual(["b", "g"]);
    expect((shown[1] as { children: Element[] }).children.map((e) => e.id)).toEqual(["d"]);
  });

  it("draws every chip in the editor, a thumbnail and an export, and gives the same list back when none is hidden", () => {
    const list = [audio("a", true), audio("b")];
    for (const mode of ["edit", "thumbnail", "export"] as const) expect(withoutHiddenAudio(list, mode)).toBe(list);
    const plain = [audio("x"), group("g", [audio("y")])];
    expect(withoutHiddenAudio(plain, "present")).toBe(plain);
  });
});
