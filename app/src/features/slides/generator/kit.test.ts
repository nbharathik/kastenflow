// The drawing kit and the runner that live inside the sandbox's frame, run here as plain scripts: the kit makes the SVG text the
// starters and an agent's code are made of, and the runner turns code into one answer message. They are served to the frame as
// files, so they are read as text and evaluated the way the frame evaluates them.

import { CODE_PICTURE_STARTERS } from "@kasten-slides/react";
import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../../generator-kit/*.{js,html}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const source = (name: string): string => {
  const found = Object.entries(sources).find(([path]) => path.endsWith(`/${name}`));
  if (!found) throw new Error(`no ${name} in the generator kit`);
  return found[1];
};

interface Kit {
  version: number;
  theme: Record<string, string>;
  warnings: string[];
  svg(width: number, height: number, body?: unknown, options?: Record<string, unknown>): string;
  rect(x: number, y: number, w: number, h: number, options?: Record<string, unknown>): string;
  text(x: number, y: number, words: string, options?: Record<string, unknown>): string;
  g(body?: unknown, options?: Record<string, unknown>): string;
  icon(name: string, x: number, y: number, size: number, options?: Record<string, unknown>): string;
  ticks(min: number, max: number, n?: number): number[];
  scaleLinear(domain: number[], range: number[]): ((v: number) => number) & { ticks(n?: number): number[]; invert(p: number): number };
  scaleBand(labels: string[], range: number[], padding?: number): ((label: string) => number) & { bandwidth(): number; center(label: string): number; step(): number };
  axisBottom(scale: unknown, y: number, options?: Record<string, unknown>): string;
  axisLeft(scale: unknown, x: number, options?: Record<string, unknown>): string;
  csv(text: string): Record<string, string | number>[];
  json(text: string): unknown;
  palette(i: number): string;
  format(v: unknown): string;
  wrap(words: string, max: number): string[];
  warn(message: string): void;
}

function makeKit(theme: Record<string, string> = {}): Kit {
  const frameWindow: { createKit?: (theme: Record<string, string>) => Kit } = {};
  new Function("window", source("kit.js"))(frameWindow);
  return frameWindow.createKit!(theme);
}

const wellFormed = (svg: string): Document => {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.querySelector("parsererror"), svg.slice(0, 200)).toBeNull();
  expect(doc.documentElement.nodeName).toBe("svg");
  return doc;
};

describe("the drawing kit", () => {
  it("makes an SVG with the deck's colours, a viewBox and escaped words", () => {
    const kit = makeKit({ accent1: "#112233", text1: "#000000" });
    const svg = kit.svg(200, 100, [kit.rect(1, 2, 3, 4), kit.text(5, 6, 'a < b & "c"', { anchor: "middle", size: 20, weight: 700 })], { background: true });
    const doc = wellFormed(svg);
    const root = doc.documentElement;
    expect(root.getAttribute("viewBox")).toBe("0 0 200 100");
    expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(root.getAttribute("font-family")).toContain("Segoe UI");
    expect(doc.querySelectorAll("rect")).toHaveLength(2);
    expect(doc.querySelector("rect:not([width='200'])")?.getAttribute("fill")).toBe("#112233");
    const text = doc.querySelector("text")!;
    expect(text.textContent).toBe('a < b & "c"');
    expect([text.getAttribute("text-anchor"), text.getAttribute("font-size"), text.getAttribute("font-weight"), text.getAttribute("fill")]).toEqual(["middle", "20", "700", "#000000"]);
    // The colours the deck did not give are the kit's own.
    expect(makeKit({}).theme["accent2"]).toMatch(/^#/);
  });

  it("joins lists of lists as they stand and keeps an empty group open", () => {
    const kit = makeKit();
    expect(kit.g([["<a/>", "<b/>"], "<c/>"], { id: "x" })).toBe('<g id="x"><a/><b/><c/></g>');
    expect(kit.g()).toBe("<g></g>");
  });

  it("says which value is not a number, so the error has a line", () => {
    const kit = makeKit();
    expect(() => kit.rect(Number.NaN, 0, 1, 1)).toThrow("x must be a number");
    expect(() => kit.svg(100, Number.POSITIVE_INFINITY)).toThrow("The height must be a number");
    expect(() => kit.icon("nope", 0, 0, 10)).toThrow(/There is no icon "nope"/);
    expect(kit.icon("check", 10, 20, 48)).toContain("translate(10 20) scale(2)");
  });

  it("scales numbers and bands, and finds round ticks", () => {
    const kit = makeKit();
    const x = kit.scaleLinear([0, 100], [10, 210]);
    expect([x(0), x(50), x(100)]).toEqual([10, 110, 210]);
    expect(x.invert(110)).toBe(50);
    expect(kit.ticks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(kit.ticks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(kit.ticks(5, 5)).toEqual([5]);
    const band = kit.scaleBand(["a", "b", "c", "d"], [0, 400], 0.2);
    expect([band("a"), band.bandwidth(), band.step(), band.center("b")]).toEqual([10, 80, 100, 150]);
    expect(() => band("z")).toThrow('There is no band for "z"');
  });

  it("draws axes as well-formed SVG", () => {
    const kit = makeKit();
    const y = kit.scaleLinear([0, 20], [300, 20]);
    const x = kit.scaleBand(["Jan", "Feb"], [60, 400]);
    const svg = kit.svg(420, 340, [kit.axisLeft(y, 60), kit.axisBottom(x, 300)]);
    const doc = wellFormed(svg);
    expect([...doc.querySelectorAll("text")].map((t) => t.textContent)).toEqual(expect.arrayContaining(["0", "20", "Jan", "Feb"]));
  });

  it("reads CSV with quotes, tabs and numbers, and JSON with a helpful error", () => {
    const kit = makeKit();
    expect(kit.csv('name,total,note\nAda,3,"a, b"\n"Be ""B""",5.5,\n\n')).toEqual([
      { name: "Ada", total: 3, note: "a, b" },
      { name: 'Be "B"', total: 5.5, note: "" },
    ]);
    expect(kit.csv("a\tb\n1\t2\n")).toEqual([{ a: 1, b: 2 }]);
    expect(kit.csv("")).toEqual([]);
    expect(kit.json('{"a": [1, 2]}')).toEqual({ a: [1, 2] });
    expect(() => kit.json("{oops")).toThrow(/The input is not JSON/);
  });

  it("goes round the palette, formats numbers and wraps words", () => {
    const kit = makeKit({ accent1: "#111111", accent2: "#222222", accent3: "#333333", accent4: "#444444", accent5: "#555555", accent6: "#666666" });
    expect([kit.palette(0), kit.palette(5), kit.palette(6), kit.palette(-1)]).toEqual(["#111111", "#666666", "#111111", "#666666"]);
    expect([kit.format(12), kit.format(1234), kit.format(1_500_000), kit.format(2_000_000_000), kit.format("n/a")]).toEqual(["12", "1.2k", "1.5M", "2B", "n/a"]);
    expect(kit.wrap("the quick brown fox jumps", 10)).toEqual(["the quick", "brown fox", "jumps"]);
    kit.warn("x".repeat(500));
    expect(kit.warnings[0]).toHaveLength(300);
  });
});

describe("the starting points, run through the real kit", () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
  for (const starter of CODE_PICTURE_STARTERS) {
    it(`${starter.label} draws a well-formed SVG from its own data`, async () => {
      const kit = makeKit();
      const inputs = Object.fromEntries(starter.program.inputs.map((input) => [input.name, input.value]));
      const body = new AsyncFunction("kit", "inputs", "theme", starter.program.code);
      const svg = await body(kit, inputs, kit.theme);
      expect(typeof svg).toBe("string");
      const text = svg as string;
      const doc = wellFormed(text);
      expect(doc.documentElement.getAttribute("viewBox")).toMatch(/^0 0 [\d.]+ [\d.]+$/);
      expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
      expect(doc.querySelectorAll("text").length + doc.querySelectorAll("path").length).toBeGreaterThan(2);
    });
  }
});

// The ways out of the frame that the page's policy does not cover on its own (a peer connection's traffic is not a `connect-src`
// request), and the others it does, which the runner takes away from the code as well.
const WAYS_OUT = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "WebSocket", "EventSource", "fetch", "XMLHttpRequest"];

describe("the runner", () => {
  // What the test window had under the names the runner takes away, so the other tests get it back.
  const holder = window as unknown as Record<string, unknown>;
  const kept = new Map<string, PropertyDescriptor | undefined>();
  const beacon = Object.getOwnPropertyDescriptor(window.navigator, "sendBeacon");
  const holdWaysOut = () => {
    if (kept.size > 0) return;
    for (const name of WAYS_OUT) {
      kept.set(name, Object.getOwnPropertyDescriptor(window, name));
      Object.defineProperty(window, name, { value: function Stub() {}, configurable: true, writable: true });
    }
    Object.defineProperty(window.navigator, "sendBeacon", { value: () => true, configurable: true, writable: true });
  };
  const giveWaysOutBack = () => {
    for (const [name, was] of kept) {
      if (was) Object.defineProperty(window, name, was);
      else Reflect.deleteProperty(window, name);
    }
    kept.clear();
    if (beacon) Object.defineProperty(window.navigator, "sendBeacon", beacon);
    else Reflect.deleteProperty(window.navigator, "sendBeacon");
  };

  // The runner talks to `window.parent`; in a test window that is the window itself, so what it posts is heard here.
  function runner() {
    const heard: Record<string, unknown>[] = [];
    window.addEventListener("message", (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (data && (data["type"] === "ready" || data["type"] === "result" || data["type"] === "error")) heard.push(data);
    });
    // The code's own console.log is the window's, so that is the console the runner takes over; the test's is put back after.
    const saved = { ...window.console };
    // The test window does not run the script the runner adds, so the function that script declares is made here from its text.
    const append = document.head.appendChild;
    // The runner takes these away from the window it runs in; stand-ins are there for it to find, and put back after.
    holdWaysOut();
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => unknown;
    document.head.appendChild = function <T extends Node>(this: HTMLHeadElement, node: T): T {
      const body = /async function __generator\(kit, inputs, theme\) \{\n([\s\S]*)\n\}\n\/\/# sourceURL/.exec(node.textContent ?? "")?.[1];
      if (node instanceof HTMLScriptElement && body !== undefined) {
        (window as unknown as { __generator: unknown }).__generator = new AsyncFunction("kit", "inputs", "theme", body);
      }
      return append.call(this, node) as T;
    };
    new Function("window", "document", "console", source("runner.js"))(window, document, window.console);
    return {
      heard,
      restore: () => {
        document.head.appendChild = append;
        Object.assign(window.console, saved);
        giveWaysOutBack();
      },
    };
  }

  it("is served as three files and the page names the other two", () => {
    const page = source("runner.html");
    expect(page).toContain('src="kit.js"');
    expect(page).toContain('src="runner.js"');
    expect(page).not.toMatch(/https?:|<link|<img|<iframe/);
  });

  it("says it is ready, runs the code it is handed and answers once with the SVG", async () => {
    const frameWindow = window as unknown as { createKit?: unknown };
    new Function("window", source("kit.js"))(frameWindow);
    const { heard, restore } = runner();
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(heard.some((m) => m["type"] === "ready")).toBe(true);
      // Only the window that holds the frame may tell it what to run: a message from nowhere is not obeyed.
      window.dispatchEvent(new MessageEvent("message", { data: { type: "run", id: "ignored", code: "return '<svg/>';" } }));
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "run", id: "r1", code: "console.log('rows', inputs.sales.length);\nreturn kit.svg(10, 10, kit.rect(0, 0, 5, 5));", inputs: { sales: "a,b" }, theme: {} },
          source: window,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const results = heard.filter((m) => m["type"] === "result" || m["type"] === "error");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ type: "result", id: "r1", logs: ["rows 3"], warnings: [] });
      expect(String(results[0]!["svg"])).toContain("<svg");
    } finally {
      restore();
    }
  });

  it("takes the ways out of the frame away from the code before it runs, the peer connections too", async () => {
    const frameWindow = window as unknown as { createKit?: unknown };
    new Function("window", source("kit.js"))(frameWindow);
    holdWaysOut();
    // The test can see them: they are there until the runner starts.
    expect(typeof holder["RTCPeerConnection"]).toBe("function");
    expect(typeof window.navigator.sendBeacon).toBe("function");
    const { heard, restore } = runner();
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const code = [
        "const names = " + JSON.stringify([...WAYS_OUT]) + ";",
        "console.log(names.map((n) => n + ':' + typeof globalThis[n]).join(' '), 'beacon:' + typeof navigator.sendBeacon);",
        "try { new RTCPeerConnection(); console.log('opened'); } catch (e) { console.log('refused'); }",
        "return kit.svg(10, 10, kit.rect(0, 0, 5, 5));",
      ].join("\n");
      window.dispatchEvent(new MessageEvent("message", { data: { type: "run", id: "r2", code, inputs: {}, theme: {} }, source: window }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = heard.find((m) => m["type"] === "result" || m["type"] === "error");
      expect(result).toMatchObject({ type: "result", id: "r2" });
      const logs = (result as { logs: string[] }).logs;
      expect(logs[0]).toBe(WAYS_OUT.map((n) => `${n}:undefined`).join(" ") + " beacon:undefined");
      expect(logs[1]).toBe("refused");
    } finally {
      restore();
    }
  });
});
