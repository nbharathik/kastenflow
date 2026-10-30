import { beforeEach, describe, expect, it } from "vitest";

import { fakeHost, flush, kitFiles, loadKit, type FakeHost, type Kit } from "./test-support/env";

const RAW = import.meta.glob<string>("./starters/*/*", { query: "?raw", import: "default", eager: true });
const file = (slug: string, name: string): string => RAW[`./starters/${slug}/${name}`] ?? "";
const SLUGS = ["dashboard", "tracker", "gallery", "map", "timeline"];
const TAGS: Record<string, string> = { dashboard: "tracked", tracker: "deadline", gallery: "picture", map: "place", timeline: "event" };

const isoIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sample notes (as the app sends them) for each starter. */
const NOTES: Record<string, unknown[]> = {
  dashboard: [
    { id: "a", title: "Write intro", props: { status: "done" } },
    { id: "b", title: "Run study", props: { status: "doing", due: isoIn(3) } },
    { id: "c", title: "Submit", props: { due: isoIn(60) } },
  ],
  tracker: [
    { id: "a", title: "Abstract", props: { date: isoIn(10), event: "CHI", aoe: true, status: "To do" } },
    { id: "b", title: "Camera-ready", props: { date: isoIn(50), event: "CHI", announced: false } },
    { id: "c", title: "Workshop", props: { date: isoIn(30), end: isoIn(32), event: "ICML" } },
    { id: "d", title: "No date yet", props: {} },
  ],
  gallery: [
    { id: "a", title: "Sketch", props: { image: "assets/sketch.png", caption: "First pass" } },
    { id: "b", title: "Blank", props: {} },
  ],
  map: [
    { id: "a", title: "Lisbon", props: { lat: 38.7, lon: -9.1, country: "Europe", when: "2027" } },
    { id: "b", title: "Tokyo", props: { lat: "35.7", lon: "139.7", country: "Asia" } },
    { id: "c", title: "Nowhere", props: {} },
  ],
  timeline: [
    { id: "a", title: "Kickoff", props: { date: isoIn(-5), lane: "Plan" } },
    { id: "b", title: "Build", props: { date: isoIn(2), end: isoIn(20), lane: "Make" } },
    { id: "c", title: "Launch", props: { date: isoIn(40), announced: false, lane: "Make" } },
  ],
};

let kit: Kit;
let host: FakeHost;
const q = (sel: string) => document.querySelectorAll(sel);
const texts = (sel: string) => Array.from(q(sel)).map((e) => e.textContent);
const scriptsOf = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("script[src]")).map((s) => s.getAttribute("src")!);
const kitFilesOf = (slug: string) => scriptsOf(file(slug, "index.html")).filter((s) => s.startsWith("smart://kit/1/")).map((s) => s.replace("smart://kit/1/", ""));

/** Open a starter the way the app would: its markup, the kit scripts it lists, a bridge, then its own script. */
async function open(slug: string, notes: unknown[] | "fail") {
  document.body.innerHTML = new DOMParser().parseFromString(file(slug, "index.html"), "text/html").body.innerHTML;
  kit = loadKit(kitFilesOf(slug));
  host = fakeHost({
    watch: () => {
      if (notes === "fail") throw { code: "refused", message: "not allowed" };
      return notes;
    },
  });
  (window as unknown as { kasten: unknown }).kasten = kit.createBridge({ transport: host.transport });
  (0, eval)(file(slug, "app.js"));
  await flush();
}
const pushNotes = async (value: unknown[]) => {
  host.emit({ event: "watch", watchId: host.ofKind("watch")[0].args.watchId, value });
  await flush();
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe.each(SLUGS)("starter %s: files", (slug) => {
  it("has a manifest, a page, a script and a Markdown body", () => {
    for (const name of ["smart.yaml", "index.html", "app.js", "page.md"]) expect(file(slug, name).length, name).toBeGreaterThan(0);
    const yaml = file(slug, "smart.yaml");
    expect(yaml).toMatch(/^version: 1$/m);
    expect(yaml).toMatch(/^title: \S/m);
    expect(yaml).toMatch(/^kit: "1"$/m);
    expect(yaml).toContain(`tag: ${TAGS[slug]}`);
    expect(Number(/^ {2}height: (\d+)$/m.exec(yaml)?.[1])).toBeLessThanOrEqual(1200);
    expect(file(slug, "page.md")).toMatch(/^# \S/);
    expect(file(slug, "page.md")).toContain(`#${TAGS[slug]}`);
  });

  it("loads only kit files that exist, in an order that works, plus its own script", () => {
    const html = file(slug, "index.html");
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toContain('name="viewport"');
    expect(html).toContain('href="smart://kit/1/kit.css"');
    expect(html).toContain('href="smart://kit/1/kit-visual.css"');
    const scripts = scriptsOf(html);
    expect(scripts[scripts.length - 1]).toBe("app.js");
    const files = kitFilesOf(slug);
    expect(files[0]).toBe("kit.js");
    for (const f of files) expect(kitFiles().includes(f) || f === "data/world-110m.js", f).toBe(true);
    expect(() => loadKit(files)).not.toThrow();
  });

  it("hard-codes no data, no colours, no network and no internal names", () => {
    const all = ["smart.yaml", "index.html", "app.js", "page.md"].map((n) => file(slug, n)).join("\n");
    const code = file(slug, "app.js");
    expect(code.split("\n").length).toBeLessThan(400);
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|https?:\/\//);
    expect(all).not.toMatch(/#[0-9a-fA-F]{6}\b|\brgba?\(|\bhsla?\(/);
    expect(all).not.toMatch(/\bdev\/|\bADR\b|milestone/i);
    expect(code).not.toMatch(/(?:date|due|start|end|lat|lon)\s*:\s*["']?-?\d/); // no values written into the script
  });
});

describe.each(SLUGS)("starter %s: live notes", (slug) => {
  it("shows nothing but a quiet shell before the first answer", () => {
    document.body.innerHTML = new DOMParser().parseFromString(file(slug, "index.html"), "text/html").body.innerHTML;
    expect(Array.from(q("[id]")).filter((e) => (e as HTMLElement).hidden).length).toBeGreaterThan(0);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("says in one line how to add data when there is none", async () => {
    await open(slug, []);
    const empty = document.getElementById("empty")!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute("role")).toBe("status");
    expect(empty.textContent).toContain(`#${TAGS[slug]}`);
    expect(empty.textContent!.split("\n")).toHaveLength(1);
    expect(host.ofKind("watch")[0].args.query).toEqual({ tag: TAGS[slug] });
  });

  it("says plainly when the notes cannot be read", async () => {
    await open(slug, "fail");
    const empty = document.getElementById("empty")!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute("role")).toBe("alert");
    expect(empty.textContent).toContain("Could not read your notes");
  });

  it("hides the empty line once there are notes, and goes back to it when they are gone", async () => {
    await open(slug, NOTES[slug]!);
    expect(document.getElementById("empty")!.hidden).toBe(true);
    await pushNotes([]);
    expect(document.getElementById("empty")!.hidden).toBe(false);
  });
});

describe("starter dashboard: content", () => {
  it("counts notes, shows a chart by status and a sortable table, and follows changes", async () => {
    await open("dashboard", NOTES.dashboard!);
    expect(texts(".kit-stat-value")).toEqual(["3", "1", "1"]);
    expect(texts(".kit-stat-label")).toEqual(["Notes", "Done", "Due this week"]);
    expect(document.querySelector('svg[role="img"]')!.getAttribute("aria-label")).toBe("Notes by status");
    expect(texts("tbody tr")).toHaveLength(3);
    expect(texts("th")).toEqual(["Note", "Status", "Due"]);
    await pushNotes([...(NOTES.dashboard as unknown[]), { id: "d", title: "More", props: { status: "done" } }]);
    expect(texts(".kit-stat-value")[0]).toBe("4");
    expect(texts("tbody tr")).toHaveLength(4);
  });

  it("opens the note of a clicked row", async () => {
    await open("dashboard", NOTES.dashboard!);
    (document.querySelector("tbody button") as HTMLElement).click();
    expect(host.ofKind("open").length).toBe(1);
  });
});

describe("starter tracker: content", () => {
  it("draws lanes, counts down to what is coming and groups cards by status", async () => {
    await open("tracker", NOTES.tracker!);
    expect(texts(".kit-tl-lane > .kit-tl-name")).toEqual(["CHI", "ICML"]);
    expect(q(".kit-tl-item")).toHaveLength(3);
    expect(q('.kit-tl-item[data-kind="range"]')).toHaveLength(1);
    expect(texts(".kit-countdown-card h3")).toEqual(["Abstract", "Camera-ready"]);
    expect(q(".kit-countdown-card .kit-badge[data-kind='est']")).toHaveLength(1);
    expect(texts(".kit-countdown-card .kit-badge")).toContain("AoE");
    expect((document.getElementById("status-section") as HTMLElement).hidden).toBe(false);
    expect(Array.from(q("section.kit-kb-col")).map((s) => s.getAttribute("aria-label"))).toEqual(["To do, 1 card"]);
  });

  it("hides the status cards when no note has a status, and follows changes", async () => {
    await open("tracker", [NOTES.tracker![1]]);
    expect((document.getElementById("status-section") as HTMLElement).hidden).toBe(true);
    await pushNotes(NOTES.tracker!);
    expect(q(".kit-tl-item")).toHaveLength(3);
    expect((document.getElementById("status-section") as HTMLElement).hidden).toBe(false);
  });

  it("says how to add data when notes have no date", async () => {
    await open("tracker", [NOTES.tracker![3]]);
    expect(document.getElementById("empty")!.hidden).toBe(false);
  });
});

describe("starter gallery: content", () => {
  it("shows a picture with its caption, a blank frame without an image, and follows changes", async () => {
    await open("gallery", NOTES.gallery!);
    expect(q("img")).toHaveLength(1);
    expect(q("img")[0]!.getAttribute("src")).toBe("assets/sketch.png");
    expect(q("img")[0]!.getAttribute("alt")).toBe("Sketch");
    expect(q(".kit-gallery-blank")).toHaveLength(1);
    expect(texts("figcaption")).toEqual(["SketchFirst pass", "Blank"]);
    expect(Array.from(q("button")).map((b) => b.getAttribute("aria-label"))).toEqual(["Sketch", "Blank"]);
    await pushNotes([NOTES.gallery![0]]);
    expect(q("figure")).toHaveLength(1);
  });
});

describe("starter map: content", () => {
  it("pins notes with a position, highlights their countries and lists the places", async () => {
    await open("map", NOTES.map!);
    expect(q(".kit-pin")).toHaveLength(2);
    expect(texts(".kit-pin-label")).toEqual(["Lisbon", "Tokyo"]);
    expect(q('path[data-on="true"]')).toHaveLength(2);
    expect(texts(".kit-map-item")).toEqual(["Lisbon2027", "Tokyo"]);
    expect(document.querySelector("svg")!.getAttribute("aria-label")).toBe("Places");
    await pushNotes([NOTES.map![0]]);
    expect(q(".kit-pin")).toHaveLength(1);
    expect(q('path[data-on="true"]')).toHaveLength(1);
  });

  it("asks for lat and lon when no note has a position", async () => {
    await open("map", [NOTES.map![2]]);
    expect(document.getElementById("empty")!.textContent).toContain("lat and lon");
  });
});

describe("starter timeline: content", () => {
  it("draws lanes with a today line, an estimate and a range, and follows changes", async () => {
    await open("timeline", NOTES.timeline!);
    expect(texts(".kit-tl-lane > .kit-tl-name")).toEqual(["Plan", "Make"]);
    expect(q('.kit-tl-item[data-kind="range"]')).toHaveLength(1);
    expect(q('.kit-tl-item[data-state="est"]')).toHaveLength(1);
    expect(q(".kit-tl-today")).toHaveLength(1);
    await pushNotes([NOTES.timeline![0]]);
    expect(q(".kit-tl-item")).toHaveLength(1);
  });
});
