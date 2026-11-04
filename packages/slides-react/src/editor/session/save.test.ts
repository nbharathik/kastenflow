import { describe, expect, it } from "vitest";

import type { SaveOutcome } from "../host.ts";
import { SaveQueue } from "./save.ts";
import type { SaveState } from "./types.ts";

function setup() {
  const state = { text: "one", saved: [] as string[], resolve: [] as Array<(outcome: SaveOutcome) => void>, reports: [] as SaveState[] };
  const queue = new SaveQueue({
    host: {
      save: (text) => {
        state.saved.push(text);
        return new Promise<SaveOutcome>((resolve) => state.resolve.push(resolve));
      },
    },
    text: () => state.text,
    report: (s) => state.reports.push(s),
    delay: 1000,
  });
  queue.markClean("one");
  return { state, queue };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("flush", () => {
  it("resolves for a caller who asked during a write only after the save of the changes made meanwhile", async () => {
    const { state, queue } = setup();
    state.text = "two";
    const first = queue.flush();
    await tick();
    expect(state.saved).toEqual(["two"]);
    // Changed while the first write is on its way, then asked to save.
    state.text = "three";
    let second = false;
    void queue.flush().then(() => (second = true));
    state.resolve[0]!({ status: "saved" });
    await tick();
    expect(state.saved).toEqual(["two", "three"]);
    expect(second).toBe(false);
    state.resolve[1]!({ status: "saved" });
    await first;
    await tick();
    expect(second).toBe(true);
    expect(queue.isOwn("three")).toBe(true);
  });
});
