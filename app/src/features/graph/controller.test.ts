import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOUBLE_CLICK_MS, GraphController, type Handlers, type Settings } from "./controller";
import { SHOW_ALL, modelOf, type Model } from "./graph-model";

/** a - b, a - c: a at the origin, b to its right, c below. */
const graph = {
  nodes: [
    { id: "a.md", path: "a.md", title: "Alpha", kind: "page", project: null, links: 2 },
    { id: "b.md", path: "b.md", title: "Beta", kind: "page", project: null, links: 1 },
    { id: "c.md", path: "c.md", title: "Gamma", kind: "card", project: null, links: 1 },
  ],
  edges: [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
  ],
};
const PLACES = Float32Array.from([0, 0, 120, 0, 0, 120]);

/** Records what is drawn and answers what drawing asks. */
function fakeContext() {
  const calls: string[] = [];
  const record = (name: string) => (...args: unknown[]) => void calls.push(`${name}${args.length ? ` ${args.map(String).join(",")}` : ""}`);
  const ctx = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 6 }) },
    {
      get: (target, key: string) => (key in target ? (target as Record<string, unknown>)[key] : record(key)),
      set: (_target, key: string, value) => (calls.push(`${key}=${String(value)}`), true),
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

class FakePath {
  moveTo() {}
  lineTo() {}
  arc() {}
}

let frames: (() => void)[] = [];
const flush = () => {
  const run = frames;
  frames = [];
  for (const frame of run) frame();
};

interface Rig {
  canvas: HTMLCanvasElement;
  control: GraphController;
  calls: string[];
  log: Record<keyof Handlers, ReturnType<typeof vi.fn>>;
  places: { current: Float32Array | null };
  set(settings: Partial<Settings>): void;
  at(index: number): { x: number; y: number };
}

function rig(over: Partial<Settings> = {}, model: Model = modelOf(graph, SHOW_ALL)): Rig {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) });
  const { ctx, calls } = fakeContext();
  canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
  const log = { select: vi.fn(), open: vi.fn(), openHere: vi.fn(), context: vi.fn(), createAt: vi.fn(), linkTo: vi.fn() };
  const places = { current: PLACES as Float32Array | null };
  const control = new GraphController(canvas, log as unknown as Handlers, () => places.current);
  let settings: Settings = { colourBy: "kind", selected: -1, nameAll: true, editable: true, ...over };
  control.update(model, settings);
  control.frame();
  flush();
  return {
    canvas,
    control,
    calls,
    log,
    places,
    set(change) {
      settings = { ...settings, ...change };
      control.update(model, settings);
      flush();
    },
    at: (index) => control.screenOf(index)!,
  };
}

const mouse = (type: string, x: number, y: number, init: MouseEventInit = {}) => new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...init });
const press = (r: Rig, x: number, y: number, init: MouseEventInit = {}) => {
  r.canvas.dispatchEvent(mouse("mousedown", x, y, init));
};
const release = (x: number, y: number) => window.dispatchEvent(mouse("mouseup", x, y));
const click = (r: Rig, x: number, y: number, init: MouseEventInit = {}) => {
  press(r, x, y, init);
  release(x, y);
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("Path2D", FakePath);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.documentElement.dataset.motion = "off";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.motion;
  document.body.replaceChildren();
});

describe("the graph canvas", () => {
  it("draws the nodes and links, and nothing while the layout has no places", () => {
    const r = rig();
    expect(r.calls.some((c) => c.startsWith("fill "))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("stroke "))).toBe(true);
    expect(r.calls.filter((c) => c.startsWith("fillText")).map((c) => c.split(" ")[1]!.split(",")[0])).toEqual(expect.arrayContaining(["Alpha", "Beta", "Gamma"]));
    const blank = rig();
    blank.places.current = null;
    blank.calls.length = 0;
    blank.control.invalidate();
    flush();
    expect(blank.calls.some((c) => c.startsWith("fill ") || c.startsWith("stroke "))).toBe(false);
  });

  it("finds the node under the pointer and none elsewhere", () => {
    const r = rig();
    for (const i of [0, 1, 2]) expect(r.control.nodeAt(r.at(i).x, r.at(i).y)).toBe(i);
    expect(r.control.nodeAt(r.at(0).x + 40, r.at(0).y - 40)).toBe(-1);
  });

  it("waits a moment after a click to see if it is a double click, then opens", () => {
    const r = rig();
    const b = r.at(1);
    click(r, b.x, b.y);
    expect(r.log.select).toHaveBeenCalledWith(1);
    expect(r.log.open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOUBLE_CLICK_MS + 5);
    expect(r.log.open).toHaveBeenCalledTimes(1);
    expect(r.log.open.mock.calls[0]![0]).toBe(1);
    expect(r.log.open.mock.calls[0]![1]).toMatchObject({ ctrlKey: false, button: 0 });
  });

  it("opens at once for a click with a key, which says where", () => {
    const r = rig();
    const b = r.at(1);
    click(r, b.x, b.y, { ctrlKey: true });
    expect(r.log.open).toHaveBeenCalledTimes(1);
    expect(r.log.open.mock.calls[0]![1]).toMatchObject({ ctrlKey: true });
    click(r, b.x, b.y, { shiftKey: true });
    click(r, b.x, b.y, { altKey: true });
    expect(r.log.open).toHaveBeenCalledTimes(3);
  });

  it("opens in place on a double click, without the single click opening as well", () => {
    const r = rig();
    const c = r.at(2);
    click(r, c.x, c.y);
    r.canvas.dispatchEvent(mouse("dblclick", c.x, c.y));
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);
    expect(r.log.openHere).toHaveBeenCalledWith(2);
    expect(r.log.open).not.toHaveBeenCalled();
  });

  it("makes a page where empty space is double clicked, in graph units", () => {
    const r = rig();
    r.canvas.dispatchEvent(mouse("dblclick", 300, 250));
    expect(r.log.createAt).toHaveBeenCalledTimes(1);
    const [x, y] = r.log.createAt.mock.calls[0]! as [number, number];
    const [wx, wy] = r.control.worldAt(300, 250);
    expect([x, y]).toEqual([wx, wy]);
    // A graph that cannot be edited makes nothing.
    const small = rig({ editable: false });
    small.canvas.dispatchEvent(mouse("dblclick", 300, 250));
    expect(small.log.createAt).not.toHaveBeenCalled();
  });

  it("pans when empty space is dragged, and clears the selection on a plain click there", () => {
    const r = rig();
    const before = r.at(0);
    press(r, 350, 40);
    window.dispatchEvent(mouse("mousemove", 380, 60));
    release(380, 60);
    const after = r.at(0);
    expect(after.x - before.x).toBeCloseTo(30);
    expect(after.y - before.y).toBeCloseTo(20);
    expect(r.log.select).not.toHaveBeenCalled();
    click(r, 350, 40);
    expect(r.log.select).toHaveBeenCalledWith(-1);
  });

  it("makes a linked page when a node is dragged to empty space, and not when dropped on a node", () => {
    const r = rig();
    const a = r.at(0);
    press(r, a.x, a.y);
    window.dispatchEvent(mouse("mousemove", 360, 270));
    flush();
    // The link being dragged is drawn while it is dragged.
    expect(r.calls.some((c) => c.startsWith("setLineDash 4,3"))).toBe(true);
    release(360, 270);
    expect(r.log.linkTo).toHaveBeenCalledTimes(1);
    expect(r.log.linkTo.mock.calls[0]![0]).toBe(0);
    expect(r.log.open).not.toHaveBeenCalled();
    const b = r.at(1);
    press(r, a.x, a.y);
    window.dispatchEvent(mouse("mousemove", b.x, b.y));
    release(b.x, b.y);
    expect(r.log.linkTo).toHaveBeenCalledTimes(1);
  });

  it("drags no link out of a node in a graph that cannot be edited", () => {
    const r = rig({ editable: false });
    const a = r.at(0);
    press(r, a.x, a.y);
    window.dispatchEvent(mouse("mousemove", 360, 270));
    release(360, 270);
    expect(r.log.linkTo).not.toHaveBeenCalled();
    expect(r.log.open).not.toHaveBeenCalled();
  });

  it("zooms about the pointer with the wheel", () => {
    const r = rig();
    const before = r.at(1);
    const zoom0 = r.control.zoom;
    const event = new WheelEvent("wheel", { clientX: before.x, clientY: before.y, deltaY: -200, bubbles: true, cancelable: true });
    r.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(r.control.zoom).toBeGreaterThan(zoom0);
    // The node under the pointer stays under it.
    expect(r.at(1).x).toBeCloseTo(before.x);
    expect(r.at(1).y).toBeCloseTo(before.y);
  });

  it("shows the Open menu on a right click, for the node under it or for none", () => {
    const r = rig();
    const c = r.at(2);
    const event = mouse("contextmenu", c.x, c.y, { button: 2 });
    r.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(r.log.context).toHaveBeenCalledWith(2, { x: c.x, y: c.y });
    r.canvas.dispatchEvent(mouse("contextmenu", 350, 40, { button: 2 }));
    expect(r.log.context).toHaveBeenLastCalledWith(-1, { x: 350, y: 40 });
  });

  it("highlights a node's neighbours under the pointer and dims the rest", () => {
    const r = rig();
    const b = r.at(1);
    r.calls.length = 0;
    r.canvas.dispatchEvent(mouse("mousemove", b.x, b.y));
    flush();
    // Linked lines are drawn heavier, and the stranger nodes fade.
    expect(r.calls).toContain("lineWidth=1.6");
    expect(r.calls).toContain("globalAlpha=0.3");
    expect(r.canvas.style.cursor).toBe("pointer");
    r.canvas.dispatchEvent(mouse("mouseleave", 0, 0));
    expect(r.canvas.style.cursor).toBe("");
  });
});

describe("the graph canvas's keys", () => {
  const key = (r: Rig, name: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    r.canvas.dispatchEvent(event);
    return event;
  };

  it("moves the selection along a link in the direction of an arrow", () => {
    const r = rig({ selected: 0 });
    key(r, "ArrowRight");
    expect(r.log.select).toHaveBeenLastCalledWith(1);
    key(r, "ArrowDown");
    expect(r.log.select).toHaveBeenLastCalledWith(2);
  });

  it("pans with an arrow when nothing lies that way, or nothing is selected", () => {
    const r = rig({ selected: 0 });
    const before = r.at(0);
    key(r, "ArrowUp");
    expect(r.log.select).not.toHaveBeenCalled();
    expect(r.at(0).y).toBeGreaterThan(before.y);
    const none = rig();
    const start = none.at(0);
    key(none, "ArrowLeft");
    expect(none.at(0).x).toBeGreaterThan(start.x);
  });

  it("opens the selected node with Enter, the keys saying where, and clears with Escape", () => {
    const r = rig({ selected: 1 });
    key(r, "Enter");
    expect(r.log.open).toHaveBeenCalledWith(1, expect.objectContaining({ shiftKey: false }));
    key(r, "Enter", { shiftKey: true });
    expect(r.log.open).toHaveBeenLastCalledWith(1, expect.objectContaining({ shiftKey: true }));
    key(r, "Escape");
    expect(r.log.select).toHaveBeenLastCalledWith(-1);
    // With nothing selected Enter does nothing.
    const none = rig();
    key(none, "Enter");
    expect(none.log.open).not.toHaveBeenCalled();
  });

  it("zooms with plus and minus, fits with 0, and shows the Open menu from the menu key", () => {
    const r = rig({ selected: 2 });
    const zoom = r.control.zoom;
    key(r, "+");
    expect(r.control.zoom).toBeGreaterThan(zoom);
    key(r, "-");
    key(r, "-");
    expect(r.control.zoom).toBeLessThan(zoom);
    key(r, "0");
    expect(r.control.zoom).toBeCloseTo(zoom);
    key(r, "ContextMenu");
    expect(r.log.context).toHaveBeenCalledWith(2, expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    // Keys with Ctrl or Cmd belong to the window.
    const event = key(r, "+", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it("brings a node to the middle on request", () => {
    const r = rig();
    r.control.focusNode(2);
    const at = r.at(2);
    expect(at.x).toBeCloseTo(200);
    expect(at.y).toBeCloseTo(150);
  });

  it("stops listening when it is taken down", () => {
    const r = rig();
    r.control.destroy();
    const b = r.at(1);
    click(r, b.x, b.y, { ctrlKey: true });
    expect(r.log.open).not.toHaveBeenCalled();
  });
});
