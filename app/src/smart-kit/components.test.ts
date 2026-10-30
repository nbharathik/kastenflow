import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeHost, flush, loadKit, mountPoint, type Kit } from "./test-support/env";

let kit: Kit;
let app: HTMLElement;
beforeEach(() => {
  kit = loadKit();
  app = mountPoint();
});
const texts = (sel: string) => Array.from(app.querySelectorAll(sel)).map((e) => e.textContent);
const click = (el: Element | null) => (el as HTMLElement).click();

describe("countdown", () => {
  const now = new Date(2027, 1, 20);
  const data = [
    { title: "Notification", date: "2027-05-15", announced: false },
    { title: "Camera-ready", date: "2027-03-03" },
    { title: "Old", date: "2027-02-18" },
  ];

  it("renders cards sorted by date, each with an accessible name", () => {
    kit.components.countdown(app, { data, now, label: "Deadlines" });
    const list = app.querySelector("ul")!;
    expect(list.getAttribute("role")).toBe("list");
    expect(list.getAttribute("aria-label")).toBe("Deadlines");
    expect(texts("h3")).toEqual(["Old", "Camera-ready", "Notification"]);
    const names = Array.from(app.querySelectorAll("li")).map((l) => l.getAttribute("aria-label"));
    expect(names).toEqual(["Old: 2 days ago, Feb 18, 2027", "Camera-ready: in 11 days, Mar 3, 2027", "Notification: in 84 days, est. May 15, 2027 (estimated)"]);
  });

  it("shows days, units, states and the estimated or announced badge", () => {
    kit.components.countdown(app, { data, now });
    const cards = Array.from(app.querySelectorAll("li"));
    expect(cards.map((c) => c.getAttribute("data-state"))).toEqual(["passed", "later", "later"]);
    expect(cards[0]!.querySelector(".kit-countdown-days")!.textContent).toBe("2days ago");
    expect(cards[1]!.querySelector(".kit-countdown-days")!.textContent).toBe("11days");
    expect(cards[1]!.querySelector(".kit-badge")!.textContent).toBe("Announced");
    expect(cards[2]!.querySelector(".kit-badge")!.getAttribute("data-kind")).toBe("est");
    expect(cards[2]!.textContent).toContain("est. May 15, 2027");
  });

  it("says Today and singular day, and marks the last week as soon", () => {
    kit.components.countdown(app, { now, sort: false, data: [{ title: "A", date: "2027-02-20" }, { title: "B", date: "2027-02-21" }] });
    const days = texts(".kit-countdown-days");
    expect(days).toEqual(["Today", "1day"]);
    expect(app.querySelectorAll("li")[1]!.getAttribute("data-state")).toBe("soon");
  });

  it("shows the time left on the last day of an AoE deadline", () => {
    const at = new Date("2027-03-04T06:30:00Z");
    kit.components.countdown(app, { now: at, data: [{ title: "Abstract", date: "2027-03-03", aoe: true }] });
    expect(app.textContent).toContain("5h 29m left");
    expect(app.textContent).toContain("AoE");
    expect(app.querySelector("li")!.getAttribute("aria-label")).toContain("anywhere on Earth");
    expect(app.querySelector(".kit-countdown-days")!.textContent).toBe("Today");
  });

  it("re-renders on new data, keeping the cards it can", () => {
    const c = kit.components.countdown(app, { data, now });
    const first = app.querySelectorAll("li")[1];
    c.update([...data, { title: "New", date: "2027-04-01" }]);
    expect(app.querySelectorAll("li")).toHaveLength(4);
    c.update([]);
    expect(app.querySelector(".kit-empty")!.textContent).toBe("No dates yet.");
    expect(first).toBeTruthy();
  });

  it("copes with a missing or unreadable date", () => {
    kit.components.countdown(app, { data: [{ title: "Someday", date: "soon" }, { title: "No date" }], now });
    expect(texts(".kit-countdown-days")).toEqual(["?", "?"]);
    expect(app.querySelector("li")!.getAttribute("aria-label")).toContain("date unknown");
  });

  it("follows a watch query", async () => {
    const host = fakeHost({ watch: [{ title: "From vault", date: "2027-03-03" }] });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.countdown(app, { watch: { tag: "deadline" }, kasten: bridge, now });
    await flush();
    expect(texts("h3")).toEqual(["From vault"]);
  });
});

describe("gallery", () => {
  const items = [
    { id: "n1", src: "assets/a.png", title: "First", caption: "Layout" },
    { id: "n2", title: "Second" },
    { src: "assets/c.png", title: "Third" },
  ];

  it("renders figures with alt text, captions and a placeholder for a missing picture", () => {
    kit.components.gallery(app, { data: items, label: "Sketches", columns: 2 });
    expect(app.querySelector("ul")!.getAttribute("aria-label")).toBe("Sketches");
    expect(app.querySelector("ul")!.getAttribute("style")).toContain("--kit-cols:2");
    const imgs = Array.from(app.querySelectorAll("img"));
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual(["First", "Third"]);
    expect(app.querySelector(".kit-gallery-blank")!.getAttribute("role")).toBe("img");
    expect(texts("figcaption")).toEqual(["FirstLayout", "Second", "Third"]);
  });

  it("makes items with an id into named buttons, one tab stop, arrows to move", () => {
    kit.components.gallery(app, { data: items, onSelect: vi.fn() });
    const buttons = Array.from(app.querySelectorAll("button")) as HTMLButtonElement[];
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["First", "Second", "Third"]);
    expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("calls onSelect, or opens the note through the bridge", async () => {
    const onSelect = vi.fn();
    const g = kit.components.gallery(app, { data: items, onSelect });
    click(app.querySelectorAll("button")[1]!);
    expect(onSelect).toHaveBeenCalledWith(items[1], 1);
    g.destroy();
    const host = fakeHost({ open: undefined });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.gallery(app, { data: items, kasten: bridge });
    expect(app.querySelectorAll("button")).toHaveLength(2);
    click(app.querySelector("button"));
    expect(host.ofKind("open")[0].args).toEqual({ target: "n1" });
  });

  it("keeps its roving position across an update", () => {
    const g = kit.components.gallery(app, { data: items, onSelect: vi.fn() });
    const buttons = Array.from(app.querySelectorAll("button")) as HTMLButtonElement[];
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    g.update([...items, { id: "n4", title: "Fourth" }]);
    const after = Array.from(app.querySelectorAll("button"));
    expect(after.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);
  });

  it("shows an empty state", () => {
    kit.components.gallery(app, { data: [], empty: "Add some pictures." });
    expect(app.textContent).toBe("Add some pictures.");
  });
});

describe("table", () => {
  const rows = [
    { id: 1, title: "Beta", pages: 12 },
    { id: 2, title: "alpha", pages: 8 },
    { id: 3, title: "Gamma", pages: 100 },
  ];
  const col = (i: number) => Array.from(app.querySelectorAll("tbody tr")).map((r) => r.children[i]!.textContent);

  it("renders a captioned table with column headers derived from the data", () => {
    kit.components.table(app, { data: rows, label: "Papers" });
    expect(app.querySelector("caption")!.textContent).toBe("Papers");
    expect(texts("th")).toEqual(["Id", "Title", "Pages"]);
    expect(col(1)).toEqual(["Beta", "alpha", "Gamma"]);
    expect(app.querySelector("th")!.getAttribute("scope")).toBe("col");
  });

  it("sorts by a header button: ascending, descending, then back, with aria-sort", () => {
    kit.components.table(app, { data: rows, columns: ["title", { key: "pages", align: "right" }] });
    const th = () => Array.from(app.querySelectorAll("th"));
    expect(th().map((t) => t.getAttribute("aria-sort"))).toEqual(["none", "none"]);
    click(th()[1]!.querySelector("button"));
    expect(col(1)).toEqual(["8", "12", "100"]);
    expect(th()[1]!.getAttribute("aria-sort")).toBe("ascending");
    click(th()[1]!.querySelector("button"));
    expect(col(1)).toEqual(["100", "12", "8"]);
    expect(th()[1]!.getAttribute("aria-sort")).toBe("descending");
    click(th()[1]!.querySelector("button"));
    expect(col(1)).toEqual(["12", "8", "100"]);
    click(th()[0]!.querySelector("button"));
    expect(col(0)).toEqual(["alpha", "Beta", "Gamma"]);
    expect(th()[1]!.getAttribute("aria-sort")).toBe("none");
    expect(app.querySelector("td[data-align='right']")).not.toBeNull();
  });

  it("names its sort buttons and can turn sorting off per column or for all", () => {
    kit.components.table(app, { data: rows, columns: ["title", { key: "pages", sortable: false }] });
    expect(app.querySelectorAll("th button")).toHaveLength(1);
    expect(app.querySelector("th button")!.getAttribute("aria-label")).toBe("Sort by Title");
    kit.components.table(app, { data: rows, columns: ["title"], sortable: false });
    expect(app.querySelectorAll("th button")).toHaveLength(0);
  });

  it("formats cells and makes the first column a button when rows are clickable", () => {
    const onRowClick = vi.fn();
    kit.components.table(app, { data: rows, columns: ["title", { key: "pages", format: (v: number) => v + " pp" }], onRowClick });
    expect(col(1)).toEqual(["12 pp", "8 pp", "100 pp"]);
    click(app.querySelectorAll("tbody tr")[1]!.querySelector("button"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);
  });

  it("keeps the sort and the rows' nodes when the data changes", () => {
    const t = kit.components.table(app, { data: rows, columns: ["title", "pages"], sort: { key: "pages", dir: "asc" } });
    const trs = Array.from(app.querySelectorAll("tbody tr"));
    t.update([{ id: 1, title: "Beta", pages: 13 }, rows[1], rows[2]]);
    expect(col(1)).toEqual(["8", "13", "100"]);
    expect(Array.from(app.querySelectorAll("tbody tr"))).toHaveLength(trs.length);
    t.update([]);
    expect(app.querySelector(".kit-empty")!.textContent).toBe("No rows yet.");
  });
});

describe("stat", () => {
  it("shows tiles with a named value, formatted numbers and deltas for people and screen readers", () => {
    kit.components.stat(app, {
      label: "Reading",
      data: [
        { label: "Papers read", value: 4200, delta: 5 },
        { label: "Unread", value: 17, delta: -2, hint: "since Monday" },
        { label: "Cost", value: "$3.50", delta: 1 },
        { label: "Same", value: 0, delta: 0 },
      ],
    });
    expect(app.querySelector("ul")!.getAttribute("aria-label")).toBe("Reading");
    expect(Array.from(app.querySelectorAll("li")).map((l) => l.getAttribute("aria-label"))).toEqual(["Papers read: 4,200", "Unread: 17", "Cost: $3.50", "Same: 0"]);
    const deltas = Array.from(app.querySelectorAll(".kit-stat-delta"));
    expect(deltas.map((d) => d.getAttribute("data-tone"))).toEqual(["good", "bad", "good", null]);
    expect(deltas.map((d) => d.querySelector(".kit-sr")!.textContent)).toEqual(["up 5", "down 2", "up 1", "no change"]);
    expect(deltas[1]!.firstElementChild!.textContent).toBe("−2");
    expect(app.textContent).toContain("since Monday");
  });

  it("goodIsUp: false makes a rise bad", () => {
    kit.components.stat(app, { goodIsUp: false, data: [{ label: "Cost", value: 1, delta: 3 }] });
    expect(app.querySelector(".kit-stat-delta")!.getAttribute("data-tone")).toBe("bad");
  });

  it("draws a trend when a tile has spark values, and re-renders on update", () => {
    const s = kit.components.stat(app, { data: [{ label: "Pages", value: 9, spark: [1, 3, 2, 9] }] });
    expect(app.querySelector("svg.kit-spark")!.getAttribute("aria-label")).toBe("Pages trend: from 1 to 9, low 1, high 9");
    s.update([{ label: "Pages", value: 10 }]);
    expect(app.querySelector("svg")).toBeNull();
    expect(app.querySelector(".kit-stat-value")!.textContent).toBe("10");
    s.update([]);
    expect(app.querySelector(".kit-empty")).not.toBeNull();
  });
});

describe("legend", () => {
  it("lists items with swatches drawn from the series tokens only", () => {
    kit.components.legend(app, { label: "Status", data: [{ label: "Done", color: "success", value: 12 }, { label: "Late", color: 4 }, { label: "Other" }, { label: "Raw", color: "#ff0000" }] });
    expect(app.querySelector("ul")!.getAttribute("aria-label")).toBe("Status");
    const swatches = Array.from(app.querySelectorAll(".kit-swatch")).map((s) => s.getAttribute("style"));
    expect(swatches).toEqual(["--kit-swatch:var(--kit-series-2)", "--kit-swatch:var(--kit-series-4)", "--kit-swatch:var(--kit-series-3)", "--kit-swatch:var(--kit-series-1)"]);
    expect(app.querySelector(".kit-swatch")!.getAttribute("aria-hidden")).toBe("true");
    expect(app.querySelector(".kit-legend-value")!.textContent).toBe("12");
    expect(app.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });

  it("toggle makes pressable buttons that call back and follow hidden", () => {
    const onToggle = vi.fn();
    const data = [{ label: "A" }, { label: "B", hidden: true }];
    const l = kit.components.legend(app, { toggle: true, onToggle, data });
    const buttons = Array.from(app.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    click(buttons[1]!);
    expect(onToggle).toHaveBeenCalledWith(data[1], 1);
    l.update([{ label: "A", hidden: true }, { label: "B" }]);
    expect(Array.from(app.querySelectorAll("button")).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  it("shows an empty state", () => {
    kit.components.legend(app, { data: [] });
    expect(app.querySelector(".kit-empty")).not.toBeNull();
  });
});

describe("charts", () => {
  const data = [
    { label: "Jan", value: 4 },
    { label: "Feb", value: 9 },
    { label: "Mar", value: 6 },
  ];

  it("niceScale lands on round steps", () => {
    expect(kit.charts.niceScale(0, 9)).toEqual({ lo: 0, hi: 10, ticks: [0, 5, 10] });
    expect(kit.charts.niceScale(0, 100).ticks).toEqual([0, 50, 100]);
    expect(kit.charts.niceScale(-3, 7)).toMatchObject({ lo: -5, hi: 10 });
    expect(kit.charts.niceScale(0, 0).hi).toBeGreaterThan(0);
  });

  it("bar: an image with a name and a text summary, one rect per value, heights to scale", () => {
    kit.components.bar(app, { data, label: "Papers per month" });
    const svg = app.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Papers per month");
    expect(svg.querySelector("desc")!.textContent).toBe("Bar chart, 3 points. Jan 4, Feb 9, Mar 6");
    const rects = Array.from(svg.querySelectorAll("rect.kit-bar"));
    expect(rects).toHaveLength(3);
    const h = rects.map((r) => +r.getAttribute("height")!);
    expect(h[1]! / h[0]!).toBeCloseTo(9 / 4, 1);
    expect(rects[1]!.querySelector("title")!.textContent).toBe("Feb: 9");
    expect(rects[0]!.getAttribute("class")).toContain("kit-s1");
    expect(texts("text.kit-tick")).toContain("Jan");
    expect(app.querySelector(".kit-legend")).toBeNull();
  });

  it("bar: negative values hang below the zero line; grouped series get a legend", () => {
    kit.components.bar(app, { data: { labels: ["A", "B"], series: [{ name: "Plan", values: [5, -3] }, { name: "Done", values: [4, 2] }] } });
    const rects = Array.from(app.querySelectorAll("rect.kit-bar"));
    expect(rects).toHaveLength(4);
    const axisY = +app.querySelector("line.kit-axis")!.getAttribute("y1")!;
    const neg = rects[1]!;
    expect(+neg.getAttribute("y")!).toBeCloseTo(axisY, 0);
    expect(rects[2]!.getAttribute("class")).toContain("kit-s2");
    expect(texts(".kit-legend li")).toEqual(["Plan", "Done"]);
  });

  it("line: a path and a labelled dot per point, several series, a single point is a dot", () => {
    kit.components.line(app, { label: "Words", data: { labels: ["Mon", "Tue", "Wed"], series: [{ name: "Draft", values: [200, 450, 380] }, { name: "Notes", values: [90, 120, 300] }] } });
    expect(app.querySelectorAll("path.kit-line")).toHaveLength(2);
    expect(app.querySelectorAll("circle.kit-dot")).toHaveLength(6);
    expect(app.querySelector("path.kit-line")!.getAttribute("pathLength")).toBe("1000");
    expect(app.querySelector("circle.kit-dot title")!.textContent).toBe("Draft, Mon: 200");
    expect(app.querySelector("svg")!.getAttribute("aria-label")).toBe("Words");
    const l = kit.components.line(mountPoint(), { data: [5] });
    expect(l.el.querySelectorAll("path")).toHaveLength(0);
    expect(l.el.querySelectorAll("circle.kit-dot")).toHaveLength(1);
  });

  it("line: plain numbers are numbered points", () => {
    kit.components.line(app, { data: [3, 1, 2] });
    expect(app.querySelector("desc")!.textContent).toBe("Line chart, 3 points. 1 3, 2 1, 3 2");
  });

  it("donut: segments add up to the whole, the total is in the middle, the legend has shares", () => {
    kit.components.donut(app, { label: "Tasks", centerLabel: "tasks", data: [{ label: "Open", value: 6 }, { label: "Done", value: 14 }, { label: "Skipped", value: 0 }] });
    const segs = Array.from(app.querySelectorAll("circle.kit-donut-seg"));
    expect(segs).toHaveLength(2);
    const sum = segs.map((s) => +s.getAttribute("stroke-dasharray")!.split(" ")[0]!).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 1);
    expect(segs[0]!.getAttribute("stroke-dasharray")).toBe("30 70");
    expect(segs[1]!.getAttribute("stroke-dashoffset")).toBe("-5");
    expect(app.querySelector("text.kit-center-label")!.textContent).toBe("20");
    expect(app.querySelector("svg")!.getAttribute("aria-label")).toBe("Tasks");
    expect(texts(".kit-legend li")).toEqual(["Open30%", "Done70%"]);
    expect(segs[0]!.querySelector("title")!.textContent).toBe("Open: 6 (30%)");
  });

  it("donut: nothing to chart says so", () => {
    kit.components.donut(app, { data: [{ label: "A", value: 0 }] });
    expect(app.querySelector(".kit-empty")).not.toBeNull();
  });

  it("sparkline: a small image that says where it starts, ends and ranges", () => {
    kit.components.sparkline(app, { label: "Pages a day", data: [3, 5, 4, 8, 9, 7] });
    const svg = app.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Pages a day: from 3 to 7, low 3, high 9");
    expect(svg.querySelector("path")!.getAttribute("d")!.startsWith("M")).toBe(true);
    kit.components.sparkline(app, { data: [] });
    expect(app.textContent).toBe("–");
  });

  it("charts re-render in place when the data changes", () => {
    const c = kit.components.bar(app, { data });
    const svg = app.querySelector("svg");
    const rect = app.querySelector("rect.kit-bar");
    c.update([{ label: "Jan", value: 8 }, { label: "Feb", value: 9 }, { label: "Mar", value: 6 }]);
    expect(app.querySelector("svg")).toBe(svg);
    expect(app.querySelector("rect.kit-bar")).toBe(rect);
    c.update([]);
    expect(app.querySelector(".kit-empty")).not.toBeNull();
  });

  it("charts follow a watch query", async () => {
    const host = fakeHost({ watch: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const bridge = kit.createBridge({ transport: host.transport });
    kit.components.donut(app, { watch: { tag: "t" }, kasten: bridge, map: (notes: { id: string }[]) => notes.map((n) => ({ label: n.id, value: 1 })) });
    await flush();
    expect(app.querySelectorAll("circle.kit-donut-seg")).toHaveLength(3);
  });
});

describe("registry", () => {
  it("lists every component by name so a later part can add to it", () => {
    expect(Object.keys(kit.components).sort()).toEqual(["bar", "calendar", "countdown", "donut", "gallery", "kanban", "legend", "line", "map", "sparkline", "stat", "table", "timeline"]);
  });
});
