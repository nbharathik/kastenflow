import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fakeHost, flush, kitSource, loadKit, mountPoint, type Kit } from "./test-support/env";

let kit: Kit;
let app: HTMLElement;
beforeEach(() => {
  kit = loadKit();
  app = mountPoint();
});
const here = import.meta.dirname;
const texts = (sel: string) => Array.from(app.querySelectorAll(sel)).map((e) => e.textContent);
const click = (el: Element | null) => (el as HTMLElement).click();
const now = new Date(2027, 1, 20); // Saturday, Feb 20 2027

describe("timeline", () => {
  const data = [
    { title: "Abstract", date: "2027-02-10", lane: "NeurIPS" },
    { title: "Paper", date: "2027-02-24", lane: "NeurIPS", announced: false },
    { title: "Conference", start: "2027-04-05", end: "2027-04-10", lane: "CHI" },
    { title: "Camera-ready", date: "2027-03-01", lane: "CHI" },
    { title: "Someday", date: "soon" },
  ];

  it("draws lanes in order of appearance with points and ranges, each with an accessible name", () => {
    kit.components.timeline(app, { data, now, label: "Pipeline" });
    expect(app.querySelector(".kit-tl")!.getAttribute("aria-label")).toBe("Pipeline");
    expect(texts(".kit-tl-lane > .kit-tl-name")).toEqual(["NeurIPS", "CHI"]);
    expect(Array.from(app.querySelectorAll(".kit-tl-lane")).map((l) => l.getAttribute("aria-label"))).toEqual(["Lane NeurIPS", "Lane CHI"]);
    expect(app.querySelectorAll('[data-kind="point"]')).toHaveLength(3);
    expect(app.querySelectorAll('[data-kind="range"]')).toHaveLength(1);
    const names = Array.from(app.querySelectorAll(".kit-tl-item")).map((i) => i.getAttribute("aria-label"));
    expect(names).toContain("Paper: Feb 24, 2027 (estimated), in 4 days");
    expect(names).toContain("Abstract: Feb 10, 2027, 10 days ago");
    expect(names).toContain("Conference: Apr 5, 2027 to Apr 10, 2027");
  });

  it("marks estimates and past items, and tells how many items have no date", () => {
    kit.components.timeline(app, { data, now });
    const paper = Array.from(app.querySelectorAll(".kit-tl-item")).find((i) => i.textContent === "Paper")!;
    expect(paper.getAttribute("data-state")).toBe("est");
    const abstract = Array.from(app.querySelectorAll(".kit-tl-item")).find((i) => i.textContent === "Abstract")!;
    expect(abstract.getAttribute("data-when")).toBe("past");
    expect(app.querySelector(".kit-tl-note")!.textContent).toBe("1 item has no date and is not shown.");
  });

  it("draws a named line for today inside the range, and none when asked not to", () => {
    kit.components.timeline(app, { data, now });
    const today = app.querySelector(".kit-tl-today")!;
    expect(today.getAttribute("aria-label")).toBe("Today, Feb 20, 2027");
    const x = Number((today as HTMLElement).style.getPropertyValue("--x"));
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1);
    kit.components.timeline(app, { data, now, today: false });
    expect(app.querySelector(".kit-tl-today")).toBeNull();
  });

  it("puts items whose labels would collide on separate rows", () => {
    kit.components.timeline(app, { now, data: [{ title: "Alpha submission", date: "2027-03-01" }, { title: "Beta submission", date: "2027-03-02" }] });
    const rows = Array.from(app.querySelectorAll(".kit-tl-item")).map((i) => (i as HTMLElement).style.getPropertyValue("--row"));
    expect(rows).toEqual(["0", "1"]);
    expect((app.querySelector(".kit-tl-track") as HTMLElement).style.getPropertyValue("--rows")).toBe("2");
  });

  it("shows month marks on the axis and honours from and to", () => {
    kit.components.timeline(app, { data, now, from: "2027-02-01", to: "2027-05-31" });
    expect(texts(".kit-tl-tick")).toEqual(["Feb 27", "Mar 27", "Apr 27", "May 27"]);
  });

  it("shows a plain sentence when there is nothing dated", () => {
    const t = kit.components.timeline(app, { data: [{ title: "x", date: "never" }], now });
    expect(app.querySelector(".kit-empty")!.textContent).toBe("No dated items yet.");
    t.setOptions({ empty: "Add a note with a date." });
    expect(app.querySelector(".kit-empty")!.textContent).toBe("Add a note with a date.");
  });

  it("makes items with an id buttons that open the note, with one tab stop", () => {
    const host = fakeHost({ open: undefined });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.timeline(app, { now, kasten: bridge, data: [{ id: "n1", title: "Deadline", date: "2027-03-01" }, { id: "n2", title: "Notify", date: "2027-04-01" }] });
    const buttons = Array.from(app.querySelectorAll("button")) as HTMLButtonElement[];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Deadline: Mar 1, 2027, in 9 days", "Notify: Apr 1, 2027, in 40 days"]);
    expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    click(buttons[1]!);
    expect(host.ofKind("open")[0].args).toEqual({ target: "n2" });
  });

  it("follows a watch query and redraws on a change", async () => {
    const host = fakeHost({ watch: [{ title: "One", date: "2027-03-01" }] });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.timeline(app, { watch: { tag: "deadline" }, kasten: bridge, now });
    await flush();
    expect(texts(".kit-tl-item")).toEqual(["One"]);
    host.emit({ event: "watch", watchId: host.ofKind("watch")[0].args.watchId, value: [{ title: "One", date: "2027-03-01" }, { title: "Two", date: "2027-03-08" }] });
    await flush();
    expect(texts(".kit-tl-item")).toEqual(["One", "Two"]);
  });
});

describe("kanban", () => {
  const data = [
    { id: "a", title: "Read paper", status: "To do", tags: ["ml"] },
    { id: "b", title: "Write review", status: "Doing", note: "Due Friday" },
    { title: "Cite it", status: "to do" },
  ];

  it("groups cards into columns by status, with counts in each column's name", () => {
    kit.components.kanban(app, { data, label: "Reading" });
    expect(app.querySelector(".kit-kb")!.getAttribute("aria-label")).toBe("Reading");
    expect(Array.from(app.querySelectorAll("section")).map((s) => s.getAttribute("aria-label"))).toEqual(["To do, 2 cards", "Doing, 1 card"]);
    expect(texts(".kit-kb-title")).toEqual(["Read paper", "Cite it", "Write review"]);
    expect(app.textContent).toContain("Due Friday");
    expect(texts(".kit-chip")).toEqual(["ml"]);
  });

  it("uses the given columns, keeps empty ones and puts the rest under Other", () => {
    kit.components.kanban(app, { data: [...data, { title: "Odd", status: "Parked" }], columns: ["To do", "Doing", "Done"] });
    expect(Array.from(app.querySelectorAll("section")).map((s) => s.getAttribute("aria-label"))).toEqual(["To do, 2 cards", "Doing, 1 card", "Done, 0 cards", "Other, 1 card"]);
    expect(texts(".kit-kb-none")).toEqual(["Nothing here."]);
  });

  it("offers a named Move menu only when onMove is given, and reports the choice", () => {
    kit.components.kanban(app, { data, columns: ["To do", "Doing"] });
    expect(app.querySelector("select")).toBeNull();
    const onMove = vi.fn();
    kit.components.kanban(app, { data, columns: ["To do", "Doing"], onMove });
    const select = app.querySelector("select") as HTMLSelectElement;
    expect(select.getAttribute("aria-label")).toBe("Move Read paper to");
    select.value = "Doing";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onMove).toHaveBeenCalledWith(data[0], "Doing");
  });

  it("opens a note from its title and shows a plain sentence when empty", () => {
    const host = fakeHost({ open: undefined });
    const bridge = kit.createBridge({ transport: host.transport });
    const k = kit.components.kanban(app, { data, kasten: bridge });
    click(app.querySelector("button"));
    expect(host.ofKind("open")[0].args).toEqual({ target: "a" });
    k.update([]);
    expect(app.querySelector(".kit-empty")!.textContent).toBe("No cards yet.");
  });

  it("follows a watch query", async () => {
    const host = fakeHost({ watch: [{ title: "Only", status: "Doing" }] });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.kanban(app, { watch: { tag: "task" }, kasten: bridge });
    await flush();
    expect(texts(".kit-kb-title")).toEqual(["Only"]);
  });
});

describe("calendar", () => {
  const data = [
    { title: "Camera-ready", date: "2027-03-03", id: "n1" },
    { title: "Workshop", date: "2027-03-10", end: "2027-03-12" },
  ];
  const cells = () => Array.from(app.querySelectorAll("td.kit-cal-day-cell"));

  it("draws the month as a table with named columns and days", () => {
    kit.components.calendar(app, { data, month: "2027-03", now, label: "Events" });
    expect(app.querySelector("caption")!.textContent).toBe("Events, March 2027");
    expect(texts("th")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(app.querySelector("th")!.getAttribute("abbr")).toBe("Monday");
    expect(cells()).toHaveLength(31);
    expect(app.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(cells()[2]!.textContent).toContain("Mar 3, 2027, 1 item");
    expect(app.querySelector(".kit-cal-title")!.textContent).toBe("March 2027");
  });

  it("shows a ranged item on every day it covers", () => {
    kit.components.calendar(app, { data, month: "2027-03", now });
    expect(cells().filter((c) => c.textContent!.includes("Workshop"))).toHaveLength(3);
  });

  it("starts the week on Sunday when asked", () => {
    kit.components.calendar(app, { data, month: "2027-03", now, weekStart: 0 });
    expect(texts("th")[0]).toBe("Sun");
    expect(app.querySelectorAll("tr:first-child td.kit-cal-pad, tbody tr:first-child td.kit-cal-pad")).toHaveLength(1);
  });

  it("moves between months with named buttons and comes back to today", () => {
    kit.components.calendar(app, { data, now });
    expect(app.querySelector(".kit-cal-title")!.textContent).toBe("February 2027");
    expect(app.querySelector('[aria-current="date"]')!.textContent).toContain("Feb 20, 2027");
    click(app.querySelector('button[aria-label="Next month"]'));
    expect(app.querySelector(".kit-cal-title")!.textContent).toBe("March 2027");
    click(app.querySelector('button[aria-label="Next month"]'));
    click(app.querySelector('button[aria-label="Previous month"]'));
    expect(app.querySelector(".kit-cal-title")!.textContent).toBe("March 2027");
    click(Array.from(app.querySelectorAll("button")).find((b) => b.textContent === "Today")!);
    expect(app.querySelector(".kit-cal-title")!.textContent).toBe("February 2027");
    click(app.querySelector('button[aria-label="Previous month"]'));
    click(app.querySelector('button[aria-label="Previous month"]'));
    expect(app.querySelector(".kit-cal-title")!.textContent).toBe("December 2026");
  });

  it("limits each day and says how many more, and says so when the month is empty", () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ title: "Item " + n, date: "2027-03-05" }));
    kit.components.calendar(app, { data: many, month: "2027-03", now });
    expect(cells()[4]!.textContent).toContain("+2 more");
    kit.components.calendar(app, { data: [], month: "2027-03", now });
    expect(app.querySelector(".kit-cal-none")!.textContent).toBe("Nothing scheduled this month.");
  });

  it("opens a note from its title and follows a watch query", async () => {
    const host = fakeHost({ open: undefined, watch: data });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.calendar(app, { watch: { tag: "event" }, kasten: bridge, month: "2027-03", now });
    await flush();
    click(app.querySelector("td button"));
    expect(host.ofKind("open")[0].args).toEqual({ target: "n1" });
  });

  it("shows the month a page asks for when options change", () => {
    const c = kit.components.calendar(app, { data, month: "2027-03", now });
    click(app.querySelector('button[aria-label="Next month"]'));
    c.setOptions({ month: "2027-06" });
    expect(app.querySelector(".kit-cal-title")!.textContent).toBe("June 2027");
  });
});

describe("map", () => {
  const pins = [
    { label: "Lisbon", lat: 38.7, lon: -9.1, note: "Opening day", id: "n1" },
    { label: "Tokyo", lat: 35.7, lon: 139.7 },
  ];
  const data = { pins, highlight: ["Europe"] };

  it("projects with Equal Earth: the equator and the poles land where they should", () => {
    const { project, WIDTH, HEIGHT } = kit.maps;
    expect(WIDTH).toBe(1000);
    expect(HEIGHT).toBeGreaterThan(480);
    expect(HEIGHT).toBeLessThan(495);
    const [cx, cy] = project(0, 0);
    expect(cx).toBeCloseTo(500, 5);
    expect(cy).toBeCloseTo(HEIGHT / 2, 5);
    expect(project(-180, 0)[0]).toBeCloseTo(0, 5);
    expect(project(180, 0)[0]).toBeCloseTo(1000, 5);
    expect(project(0, 90)[1]).toBeCloseTo(0, 5);
    expect(project(0, -90)[1]).toBeCloseTo(HEIGHT, 5);
    expect(project(0, 60)[1]).toBeLessThan(project(0, 30)[1]);
    expect(project(10, 90)[0]).toBeLessThan(project(10, 0)[0]); // meridians pinch towards the poles
  });

  it("draws the world, a highlighted region, pins with labels and a list of places", () => {
    kit.components.map(app, { data, label: "Host cities" });
    const svg = app.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Host cities");
    expect(svg.querySelector("desc")!.textContent).toBe("2 places: Lisbon (38.7, -9.1); Tokyo (35.7, 139.7). Highlighted: Europe.");
    expect(svg.querySelectorAll("path.kit-region")).toHaveLength(8);
    const on = svg.querySelectorAll('path[data-on="true"]');
    expect(on).toHaveLength(1);
    expect(on[0]!.querySelector("title")!.textContent).toBe("Europe");
    expect(texts(".kit-pin-label")).toEqual(["Lisbon", "Tokyo"]);
    expect(app.querySelector(".kit-map-list")!.getAttribute("aria-label")).toBe("Host cities places");
    expect(texts(".kit-map-item")).toEqual(["LisbonOpening day", "Tokyo"]);
  });

  it("matches a highlighted region by name, code or continent, ignoring case", () => {
    kit.components.map(app, { data: { pins: [], highlight: ["asia", "AFRICA"] } });
    expect(app.querySelectorAll('path[data-on="true"]')).toHaveLength(2);
    expect(app.querySelector(".kit-empty")).toBeNull();
  });

  it("accepts a plain list of pins, and hides the labels past twelve pins", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ label: "P" + i, lat: i * 5, lon: i * 10 }));
    kit.components.map(app, { data: many });
    expect(app.querySelectorAll(".kit-pin")).toHaveLength(13);
    expect(app.querySelectorAll(".kit-pin-label")).toHaveLength(0);
    kit.components.map(app, { data: many, labels: true });
    expect(app.querySelectorAll(".kit-pin-label")).toHaveLength(13);
  });

  it("shows a pin's label and marks it when its list item is hovered or focused", () => {
    kit.components.map(app, { data: pins, labels: false });
    expect(app.querySelectorAll(".kit-pin-label")).toHaveLength(0);
    const item = app.querySelector("li button") as HTMLElement;
    item.dispatchEvent(new MouseEvent("mouseenter"));
    expect(app.querySelector('.kit-pin[data-active="true"] .kit-pin-label')!.textContent).toBe("Lisbon");
    expect(app.querySelector("li[data-active]")).not.toBeNull();
    app.querySelector("li button")!.dispatchEvent(new MouseEvent("mouseleave"));
    expect(app.querySelector(".kit-pin[data-active]")).toBeNull();
  });

  it("opens a note from its list item or its pin, with one tab stop in the list", () => {
    const host = fakeHost({ open: undefined });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.map(app, { data: pins, kasten: bridge });
    expect(app.querySelectorAll("button")).toHaveLength(1); // Tokyo has no note to open
    click(app.querySelector("button"));
    app.querySelector(".kit-pin")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.ofKind("open").map((m) => m.args)).toEqual([{ target: "n1" }, { target: "n1" }]);
    expect(app.querySelector("button")!.getAttribute("tabindex")).toBe("0");
  });

  it("zooms to the pins and regions with fit: content, inside the world", () => {
    kit.components.map(app, { data: { pins: [pins[0]], highlight: ["Europe"] }, fit: "content" });
    const [x, y, w, h] = app.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number];
    expect(w).toBeLessThan(1000);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1000.1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + h).toBeLessThanOrEqual(kit.maps.HEIGHT + 0.1);
    expect(w / h).toBeCloseTo(1000 / kit.maps.HEIGHT, 1);
  });

  it("skips pins without a usable position and says so", () => {
    kit.components.map(app, { data: [...pins, { label: "Nowhere" }, { label: "Off", lat: 120, lon: 0 }, { label: "Blank", lat: "", lon: "" }] });
    expect(app.querySelectorAll(".kit-pin")).toHaveLength(2);
    expect(app.querySelector(".kit-map-note")!.textContent).toBe("3 places have no usable position and are not shown.");
  });

  it("shows a plain sentence when there is nothing, and still draws pins if the world is missing", () => {
    const m = kit.components.map(app, { data: [] });
    expect(app.querySelector(".kit-empty")!.textContent).toBe("No places yet.");
    kit.maps.setWorld(null);
    m.update(pins);
    expect(app.querySelector(".kit-map-blank")).not.toBeNull();
    expect(app.querySelector("desc")!.textContent).toContain("The world outline is not loaded.");
    expect(app.querySelectorAll(".kit-pin")).toHaveLength(2);
  });

  it("follows a watch query and redraws on a change", async () => {
    const host = fakeHost({ watch: [pins[0]] });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.map(app, { watch: { tag: "venue" }, kasten: bridge });
    await flush();
    expect(app.querySelectorAll(".kit-pin")).toHaveLength(1);
    host.emit({ event: "watch", watchId: host.ofKind("watch")[0].args.watchId, value: pins });
    await flush();
    expect(app.querySelectorAll(".kit-pin")).toHaveLength(2);
  });
});

describe("map data", () => {
  const json = readFileSync(join(here, "data", "world-110m.json"), "utf8");
  const world = JSON.parse(json);

  it("keeps the contract: regions with an id, a name and rings of [lon, lat] inside the world", () => {
    expect(Array.isArray(world.regions)).toBe(true);
    expect(world.regions.length).toBeGreaterThan(0);
    for (const r of world.regions) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.name).toBe("string");
      expect(r.rings.length).toBeGreaterThan(0);
      for (const ring of r.rings) {
        expect(ring.length).toBeGreaterThan(2);
        for (const [lon, lat] of ring) {
          expect(Math.abs(lon)).toBeLessThanOrEqual(180);
          expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        }
      }
    }
  });

  it("is clearly marked as a placeholder until the real Natural Earth file replaces it", () => {
    expect(world.placeholder).toBe(true);
    expect(json).toMatch(/PLACEHOLDER/);
    expect(kitSource("data/world-110m.js")).toMatch(/^\/\* PLACEHOLDER/);
    expect(json.length).toBeLessThan(300 * 1024);
  });

  it("is what the script installs (the script is built from the JSON)", () => {
    expect(kit.maps.world).toEqual(world);
  });
});

describe("kit-visual.css", () => {
  const css = readFileSync(join(here, "kit-visual.css"), "utf8");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|cyan|magenta|silver|gold|navy|teal)(?![\w-])/i;

  it("has no raw colours and no internal names", () => {
    expect(code).not.toMatch(RAW_COLOUR);
    expect(css).not.toMatch(/\bdev\/|\bADR\b|milestone/i);
    expect(css.split("\n").length).toBeLessThan(400);
  });

  it("moves things only when the person has not asked for reduced motion", () => {
    const at = code.indexOf("prefers-reduced-motion: no-preference");
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(0, at)).not.toMatch(/transition|animation/);
  });

  it("uses only the kit's series tokens for chart-like colours", () => {
    for (const m of code.matchAll(/var\(--kit-series-(\d+)\)/g)) expect(Number(m[1])).toBeLessThanOrEqual(8);
  });
});
