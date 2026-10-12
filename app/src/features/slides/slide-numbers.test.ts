// Turning the slide numbers off in a deck that was made before new decks had them off: only that setting changes.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { withSlideNumbers, withoutSlideNumbers } from "./slide-numbers";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
});

/** A deck as one saved before the choice: its numbers on, and some slides. */
function older(): string {
  const engine = DeckEngine.create("Lecture", "Serif", 3);
  engine.apply("add_slide", { layout: "title-body", content: { title: "Results", body: "one" } });
  engine.apply("set_present", { slideNumbers: true });
  const text = engine.save();
  engine.dispose();
  return text;
}

describe("a deck's slide numbers", () => {
  it("are off in the text it gives back, and nothing else changed", async () => {
    const before = older();
    expect(JSON.parse(before).present.slideNumbers).toBe(true);
    const after = await withoutSlideNumbers(before);
    expect(after).not.toBeNull();
    const [was, now] = [JSON.parse(before), JSON.parse(after!)];
    expect(now.present.slideNumbers).toBe(false);
    expect({ ...now, present: { ...now.present, slideNumbers: true } }).toEqual(was);
    // It is the bytes the editor would have saved: opened and saved again, it does not change.
    const again = DeckEngine.open(after!);
    expect(again.save()).toBe(after);
    again.dispose();
  });

  it("need no saving when they are off already, and none is made", async () => {
    const off = (await withoutSlideNumbers(older()))!;
    expect(await withoutSlideNumbers(off)).toBeNull();
  });

  it("can be turned on again the same way", async () => {
    const off = (await withoutSlideNumbers(older()))!;
    const on = await withSlideNumbers(off, true);
    expect(JSON.parse(on!).present.slideNumbers).toBe(true);
    expect(on).toBe(older());
  });

  it("is refused in words when the text is not a deck", async () => {
    await expect(withoutSlideNumbers("not a deck")).rejects.toThrow();
  });
});
