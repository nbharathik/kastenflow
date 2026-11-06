import { describe, expect, it, vi } from "vitest";

import { INK_WIDTH, type InkEvent, type LaserAt, type Stroke, readInk, readPointer, readStroke } from "./model.ts";
import { InkStore, LIVE_MS } from "./store.ts";

function made(now = () => 0) {
  const events: InkEvent[] = [];
  const lasers: (LaserAt | null)[] = [];
  const store = new InkStore({ ink: (event) => events.push(event), laser: (at) => lasers.push(at) }, now);
  store.setSlide("s1");
  return { store, events, lasers };
}

function draw(store: InkStore, points: [number, number][]) {
  const [first, ...rest] = points;
  if (!first) return;
  store.begin(...first);
  for (const point of rest) store.extend(...point);
  store.finish();
}

describe("drawing", () => {
  it("draws nothing until a tool is picked up", () => {
    const { store, events } = made();
    store.begin(0.1, 0.1);
    store.finish();
    expect(store.getSnapshot().strokes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("keeps a stroke with the tool, colour and width it was drawn with, and tells the other window it whole", () => {
    const { store, events } = made();
    store.setTool("highlighter");
    store.setColor("yellow");
    draw(store, [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]);
    const [stroke] = store.getSnapshot().strokes;
    expect(stroke).toMatchObject({ tool: "highlighter", color: "yellow", width: INK_WIDTH.highlighter, points: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] });
    expect(store.getSnapshot().live).toBeNull();
    expect(events.at(-1)).toMatchObject({ op: "add", slide: "s1" });
  });

  it("makes a dot of a touch that did not move", () => {
    const { store } = made();
    store.setTool("pen");
    draw(store, [[0.5, 0.5]]);
    expect(store.getSnapshot().strokes[0]?.points).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("tells the other window how a stroke grows, at most every few hundredths of a second", () => {
    let clock = 1000;
    const { store, events } = made(() => clock);
    store.setTool("pen");
    store.begin(0, 0);
    store.extend(0.1, 0.1);
    store.extend(0.2, 0.2);
    clock += LIVE_MS;
    store.extend(0.3, 0.3);
    expect(events.filter((event) => event.op === "live")).toHaveLength(2);
  });

  it("takes back the last stroke, one at a time, and clears the slide", () => {
    const { store, events } = made();
    store.setTool("pen");
    draw(store, [[0, 0], [0.1, 0.1]]);
    draw(store, [[0.2, 0.2], [0.3, 0.3]]);
    store.undo();
    expect(store.getSnapshot().strokes).toHaveLength(1);
    draw(store, [[0.4, 0.4], [0.5, 0.5]]);
    store.clear();
    expect(store.getSnapshot().strokes).toEqual([]);
    expect(events.map((event) => event.op).filter((op) => op !== "live" && op !== "add")).toEqual(["undo", "clear"]);
    // Nothing to take back, nothing said.
    events.length = 0;
    store.undo();
    store.clear();
    expect(events).toEqual([]);
  });

  it("keeps at most a few hundred strokes of a slide", () => {
    const { store } = made();
    store.setTool("pen");
    for (let i = 0; i < 410; i++) draw(store, [[0, 0], [0.1, 0.1]]);
    expect(store.getSnapshot().strokes.length).toBe(400);
  });
});

describe("the slide changing", () => {
  it("clears the ink by default", () => {
    const { store } = made();
    store.setTool("pen");
    draw(store, [[0, 0], [0.1, 0.1]]);
    store.setSlide("s2");
    expect(store.getSnapshot().strokes).toEqual([]);
    store.setSlide("s1");
    expect(store.getSnapshot().strokes).toEqual([]);
  });

  it("keeps each slide's ink for the rest of the show when it is asked to, and tells the other window", () => {
    const { store, events } = made();
    store.setKeep(true);
    expect(events).toEqual([{ op: "keep", keep: true }]);
    store.setTool("pen");
    draw(store, [[0, 0], [0.1, 0.1]]);
    store.setSlide("s2");
    expect(store.getSnapshot().strokes).toEqual([]);
    draw(store, [[0.2, 0.2], [0.3, 0.3]]);
    store.setSlide("s1");
    expect(store.getSnapshot().strokes).toHaveLength(1);
    store.setSlide("s2");
    expect(store.getSnapshot().strokes[0]?.points).toEqual([0.2, 0.2, 0.3, 0.3]);
  });

  it("drops a stroke that was half drawn", () => {
    const { store } = made();
    store.setTool("pen");
    store.begin(0, 0);
    store.setSlide("s2");
    expect(store.getSnapshot().live).toBeNull();
    store.finish();
    expect(store.getSnapshot().strokes).toEqual([]);
  });
});

describe("the other window's ink", () => {
  const stroke: Stroke = { id: "x-1", tool: "pen", color: "blue", width: 0.0045, points: [0, 0, 1, 1] };

  it("shows a stroke as it grows, then keeps it when it is done, and never says it back", () => {
    const { store, events } = made();
    store.receive({ op: "live", slide: "s1", stroke: { ...stroke, points: [0, 0, 0.5, 0.5] } });
    expect(store.getSnapshot().live?.points).toEqual([0, 0, 0.5, 0.5]);
    store.receive({ op: "add", slide: "s1", stroke: { ...stroke } });
    expect(store.getSnapshot().live).toBeNull();
    expect(store.getSnapshot().strokes).toEqual([stroke]);
    store.receive({ op: "undo", slide: "s1" });
    expect(store.getSnapshot().strokes).toEqual([]);
    store.receive({ op: "add", slide: "s1", stroke });
    store.receive({ op: "clear", slide: "s1" });
    expect(store.getSnapshot().strokes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("drops ink for a slide it is not on, unless ink is kept", () => {
    const { store } = made();
    store.receive({ op: "add", slide: "s9", stroke });
    store.setSlide("s9");
    expect(store.getSnapshot().strokes).toEqual([]);
    store.setKeep(true);
    store.receive({ op: "add", slide: "s3", stroke });
    store.setSlide("s3");
    expect(store.getSnapshot().strokes).toHaveLength(1);
  });

  it("takes the other window's choice to keep ink without saying it back", () => {
    const { store, events } = made();
    store.receive({ op: "keep", keep: true });
    expect(store.getSnapshot().keep).toBe(true);
    expect(events).toEqual([]);
  });

  it("shows the other window's laser on the slide it is on, and not on another", () => {
    const { store } = made();
    store.receiveLaser({ slide: "s1", x: 0.25, y: 0.75 });
    expect(store.getSnapshot().remoteLaser).toEqual({ x: 0.25, y: 0.75 });
    store.receiveLaser({ slide: "s2", x: 0.5, y: 0.5 });
    expect(store.getSnapshot().remoteLaser).toBeNull();
    store.receiveLaser({ slide: "s1", x: 0.5, y: 0.5 });
    store.setSlide("s2");
    expect(store.getSnapshot().remoteLaser).toBeNull();
  });
});

describe("the laser of this window", () => {
  it("tells the other window where it is while it is on, and that it went when it is off", () => {
    const { store, lasers } = made();
    store.pointAt(0.1, 0.1);
    expect(lasers).toEqual([]);
    store.setLaser(true);
    store.pointAt(0.1, 0.2);
    store.setLaser(false);
    expect(lasers).toEqual([{ slide: "s1", x: 0.1, y: 0.2 }, null]);
  });

  it("is put down when a pen is picked up, and the other way round", () => {
    const { store, lasers } = made();
    store.setLaser(true);
    store.setTool("pen");
    expect(store.getSnapshot().laser).toBe(false);
    expect(lasers).toEqual([null]);
    store.setLaser(true);
    expect(store.getSnapshot().tool).toBeNull();
  });

  it("is told to its listeners only when something changed", () => {
    const { store } = made();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTool("pen");
    store.setTool("pen");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("what a window says is checked before it is believed", () => {
  const good = { id: "a", tool: "pen", color: "red", width: 0.01, points: [0, 0, 1, 1] };

  it("accepts a stroke and an event that are well made", () => {
    expect(readStroke(good)).toEqual(good);
    expect(readInk({ op: "add", slide: "s1", stroke: good })).toEqual({ op: "add", slide: "s1", stroke: good });
    expect(readInk({ op: "keep", keep: false })).toEqual({ op: "keep", keep: false });
    expect(readPointer(null)).toBeNull();
    expect(readPointer({ slide: "s1", x: 2, y: -1 })).toEqual({ slide: "s1", x: 1, y: 0 });
  });

  it("refuses the rest", () => {
    const bad = [
      { ...good, tool: "brush" },
      { ...good, color: "#f00" },
      { ...good, width: 5 },
      { ...good, width: 0 },
      { ...good, points: [0, 0, 1] },
      { ...good, points: [0, "x"] },
      { ...good, points: new Array(7000).fill(0) },
      { ...good, id: "" },
    ];
    for (const stroke of bad) expect(readStroke(stroke)).toBeNull();
    for (const event of [null, {}, { op: "add", slide: "s1" }, { op: "zap", slide: "s1" }, { op: "undo" }, { op: "keep", keep: "yes" }]) expect(readInk(event)).toBeNull();
    expect(readPointer({ slide: "s1", x: "a", y: 0 })).toBeUndefined();
    expect(readPointer(4)).toBeUndefined();
  });
});
