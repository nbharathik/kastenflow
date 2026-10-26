// The Conference Atlas: the smart page in `fixtures/smart`, run as the app runs it.
// The page's real files (index.html, app.js, smart.yaml) come from the fixture
// vault, the notes it reads come from the fixture's venue notes, and the real kit
// talks to the real bridge host; only the app behind the host is faked. "Today" is
// fixed, so the countdowns do not depend on the day the test runs.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadKit } from "../../smart-kit/test-support/env";
import { WATCH_DEBOUNCE_MS } from "../../lib/vault/smart-types";
import { BridgeHost } from "./bridge-host";
import { argsOf, FakeBackend } from "./test-support/fake-frame";

// The tests run from the app folder.
const VAULT = resolve(process.cwd(), "../fixtures/smart") + "/";
const FOLDER = `${VAULT}projects/research/pages/conference-tracker.smart/`;
const PAGE_FILES = ["index.html", "app.js", "smart.yaml"];
const TODAY = "2026-10-23";

interface Row {
  id: string;
  path: string;
  title: string;
  type: string;
  tags: string[];
  props: Record<string, string | number>;
}

/** The venue notes of the fixture, as the app answers a query for the tag. */
function venueRows(): Row[] {
  const dir = `${VAULT}library/`;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const head = (/^---\n([\s\S]*?)\n---/.exec(readFileSync(dir + f, "utf8").replace(/\r\n/g, "\n")) as string[])[1] as string;
      const row: Row = { id: "", path: `library/${f}`, title: "", type: "page", tags: [], props: {} };
      let inProps = false;
      for (const line of head.split("\n")) {
        const indented = /^ {2}(\w+): (.*)$/.exec(line) as string[] | null;
        if (inProps && indented) {
          const [, key, value] = indented as [string, string, string];
          row.props[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
          continue;
        }
        inProps = line === "props:";
        const top = /^(id|title): (.*)$/.exec(line) as string[] | null;
        if (top) (row as any)[top[1] as string] = top[2];
        const tags = /^tags: \[(.*)\]$/.exec(line) as string[] | null;
        if (tags) row.tags = (tags[1] as string).split(",").map((t) => t.trim());
      }
      return row;
    });
}

const read = (name: string) => readFileSync(FOLDER + name);
const text = (name: string) => read(name).toString("utf8");
const scriptsOf = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("script[src]")).map((s) => s.getAttribute("src")!);

let rows: Row[];
let backend: FakeBackend;
let host: BridgeHost;
let bridge: any;
let kit: any;
let vaultChanged: () => void;
let failQuery = false;

const settle = async () => {
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
};
/** The vault changes and the page's live query answers (after the host's wait). */
const afterChange = async () => {
  vaultChanged();
  await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
  await settle();
};

/** Opens the page the way the app does: its markup, the kit files it lists, a bridge, then its own script. */
async function openPage(theme: "light" | "dark" = "light") {
  const html = text("index.html");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  const files = scriptsOf(html)
    .filter((s) => s.startsWith("smart://kit/1/"))
    .map((s) => s.replace("smart://kit/1/", ""));
  expect(files.every((f) => f === "kit.js" || f.startsWith("lib/") || f.startsWith("components/") || f.startsWith("data/"))).toBe(true);
  kit = loadKit(files);
  backend = new FakeBackend();
  backend.answer = (call) => {
    const args = argsOf<any>(call);
    if (call.kind === "update") {
      Object.assign(rows.find((r) => r.id === args.id)!.props, args.props);
      queueMicrotask(() => vaultChanged());
      return { status: "done", result: { id: args.id } };
    }
    if (call.kind === "query" && failQuery) throw { code: "refused", message: "That is not allowed" };
    if (call.kind === "query") return rows.filter((r) => r.tags.includes(args.tag)).map((r) => structuredClone(r));
    throw { code: "not_found", message: "Nothing like that." };
  };
  let toKit: (message: unknown) => void = () => {};
  const frame = { postMessage: (message: unknown) => void queueMicrotask(() => toKit(message)) } as unknown as Window;
  host = new BridgeHost({
    pagePath: "projects/research/pages/conference-tracker.md",
    pageId: "01PAGE",
    frameToken: "f".repeat(64),
    backend,
    frame: () => frame,
    theme: () => theme,
    onVaultChange: (listener) => {
      vaultChanged = listener;
      return () => {};
    },
  });
  bridge = kit.start({
    captureErrors: false,
    transport: {
      post: (message: unknown) => host.handle({ data: message, source: frame }),
      listen: (fn: (message: unknown) => void) => {
        toKit = fn;
      },
    },
  });
  (window as any).kasten = bridge;
  host.frameLoaded();
  (0, eval)(text("app.js"));
  await settle();
}

const q = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const pins = () => q("#map g.kit-pin");
const bars = () => q('#pipeline li.kit-tl-item[data-kind="range"]');
const cards = () => q("#venues figure.kit-gallery-item");
const tiles = () => q("#countdowns li.kit-countdown-card");
const tileTitles = () => tiles().map((t) => t.querySelector("h3")!.textContent);
const barOf = (title: string) => q("#pipeline button.kit-tl-btn").find((b) => b.getAttribute("aria-label")!.startsWith(title + ":"))!.closest("li") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0));
  rows = venueRows();
  failQuery = false;
});
afterEach(() => {
  host?.dispose();
  kit?.stop?.();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the fixture's data", () => {
  it("is 18 invented venues, at least three of them estimates, on several continents", () => {
    expect(rows).toHaveLength(18);
    expect(rows.every((r) => r.tags.includes("conference") && /^https:\/\/[\w-]+\.example\.org$/.test(String(r.props.url)))).toBe(true);
    expect(rows.filter((r) => r.props.deadline_status === "est").length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.props.deadline_status === "est" || r.props.deadline_status === "announced")).toBe(true);
    // Rough continent boxes: the cities spread over six of them.
    const where = (r: Row) => {
      const lat = r.props.lat as number;
      const lon = r.props.lon as number;
      if (lon < -30) return lat > 12 ? "north america" : "south america";
      if (lon > 110 && lat < -10) return "oceania";
      if (lon > 60) return "asia";
      return lat < 15 && lon < 60 ? "africa" : "europe";
    };
    expect(new Set(rows.map(where)).size).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => Math.abs(r.props.lat as number) <= 90 && Math.abs(r.props.lon as number) <= 180)).toBe(true);
  });

  it("puts the abstract deadline before the paper deadline, and some deadlines already past", () => {
    for (const r of rows) expect(String(r.props.abstract_deadline) < String(r.props.paper_deadline), r.title).toBe(true);
    const past = rows.filter((r) => String(r.props.paper_deadline) < TODAY);
    expect(past.length).toBeGreaterThanOrEqual(1);
    expect(new Set(rows.map((r) => r.props.paper_deadline)).size).toBe(18);
  });
});

describe("the page's files", () => {
  it("hold no data, no colours, no network and no inline styles", () => {
    const all = PAGE_FILES.map(text).join("\n");
    const code = text("app.js");
    expect(code).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|https?:\/\//);
    for (const r of rows) {
      expect(all).not.toContain(r.title);
      expect(all).not.toContain(String(r.props.city));
    }
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|<style|\bstyle=/);
    expect(scriptsOf(text("index.html")).filter((s) => s !== "app.js").every((s) => s.startsWith("smart://kit/1/"))).toBe(true);
    expect(text("smart.yaml")).toMatch(/^version: 1$/m);
  });
});

describe("the page, read live", () => {
  it("shows nothing but a quiet shell until the notes arrive, then a pin, a bar and a card for each of the 18", async () => {
    await openPage();
    expect(document.getElementById("content")!.hidden).toBe(false);
    expect(document.getElementById("empty")!.hidden).toBe(true);
    expect(pins()).toHaveLength(18);
    expect(bars()).toHaveLength(18);
    expect(cards()).toHaveLength(18);
    expect(backend.asked.map((a) => a.call.kind)).toEqual(["query"]);
    expect(argsOf<any>(backend.asked[0]!.call).tag).toBe("conference");
  });

  it("counts down to the three nearest paper deadlines after the fixed today", async () => {
    await openPage();
    const expected = rows
      .filter((r) => String(r.props.paper_deadline) >= TODAY)
      .sort((a, b) => String(a.props.paper_deadline).localeCompare(String(b.props.paper_deadline)))
      .slice(0, 3)
      .map((r) => r.title);
    expect(expected).toEqual(["Atlas Symposium on Secure Computing", "Cascade Conference on Human Factors", "Savanna Workshop on Applied Learning"]);
    expect(tileTitles()).toEqual(expected);
    expect(tiles().map((t) => /^\d+/.exec(t.querySelector(".kit-countdown-days")!.textContent!)![0])).toEqual(["12", "20", "28"]);
    expect(tiles().map((t) => t.querySelector(".kit-countdown-date span")!.textContent)).toEqual(["Nov 4, 2026", "Nov 12, 2026", "est. Nov 20, 2026"]);
    // A deadline that has passed is not offered.
    expect(tileTitles()).not.toContain("Danube Conference on Data Engineering");
  });

  it("styles an estimate differently from an announced date, in the bars, tiles and cards", async () => {
    await openPage();
    const estimates = rows.filter((r) => r.props.deadline_status === "est");
    expect(q('#pipeline li.kit-tl-item[data-state="est"]')).toHaveLength(estimates.length);
    expect(q('#pipeline li.kit-tl-item[data-state="announced"]')).toHaveLength(18 - estimates.length);
    expect(barOf("Savanna Workshop on Applied Learning").getAttribute("data-state")).toBe("est");
    expect(barOf("Atlas Symposium on Secure Computing").getAttribute("data-state")).toBe("announced");
    expect(barOf("Savanna Workshop on Applied Learning").querySelector("button")!.getAttribute("aria-label")).toContain("(estimated)");
    expect(q('#countdowns .kit-badge[data-kind="est"]')).toHaveLength(1);
    expect(q('#countdowns .kit-badge[data-kind="announced"]')).toHaveLength(2);
    const captions = cards().map((c) => c.querySelector("figcaption")!.textContent!);
    expect(captions.filter((c) => c.includes("est."))).toHaveLength(estimates.length);
    expect(captions.find((c) => c.includes("Lisbon"))).toBe("Atlas Symposium on Secure ComputingLisbon · Nov 4, 2026");
  });

  it("moves a bar and a countdown when one note's paper deadline changes, with no code file touched", async () => {
    const before = PAGE_FILES.map(read);
    await openPage();
    const cascade = rows.find((r) => r.title.startsWith("Cascade"))!;
    const wide = Number(barOf(cascade.title).style.getPropertyValue("--w"));
    expect(wide).toBeGreaterThan(0);
    expect(tileTitles()).toContain(cascade.title);

    await bridge.update({ id: cascade.id, props: { paper_deadline: "2026-12-30" } });
    await afterChange();

    expect(Number(barOf(cascade.title).style.getPropertyValue("--w"))).toBeGreaterThan(wide * 3);
    expect(barOf(cascade.title).querySelector("button")!.getAttribute("aria-label")).toContain("Dec 30, 2026");
    expect(tileTitles()).toEqual(["Atlas Symposium on Secure Computing", "Savanna Workshop on Applied Learning", "Lakeside Conference on Distributed Systems"]);
    expect(cards().find((c) => c.textContent!.startsWith(cascade.title))!.textContent).toContain("Dec 30, 2026");
    // Still one of each for every venue.
    expect([pins().length, bars().length, cards().length]).toEqual([18, 18, 18]);
    // The backend was only asked to read and to update a note; the page's files are the same bytes.
    expect(new Set(backend.asked.map((a) => a.call.kind))).toEqual(new Set(["query", "update"]));
    expect(PAGE_FILES.map(read).every((now, i) => now.equals(before[i] as Buffer))).toBe(true);
  });

  it("follows a change made outside the page (another window, an agent) in the same way", async () => {
    await openPage();
    const atlas = rows.find((r) => r.title.startsWith("Atlas"))!;
    atlas.props.deadline_status = "est";
    atlas.props.paper_deadline = "2026-11-01";
    await afterChange();
    const first = tiles()[0] as HTMLElement;
    expect(first.querySelector("h3")!.textContent).toBe(atlas.title);
    expect(/^\d+/.exec(first.querySelector(".kit-countdown-days")!.textContent!)![0]).toBe("9");
    expect(first.querySelector(".kit-badge")!.getAttribute("data-kind")).toBe("est");
    expect(barOf(atlas.title).getAttribute("data-state")).toBe("est");
    expect(q('#pipeline li.kit-tl-item[data-state="est"]')).toHaveLength(5);
  });

  it("adds and removes a pin as notes are added and removed", async () => {
    await openPage();
    const first = structuredClone(rows[0]) as Row;
    rows.push({ ...first, id: "01NEW", title: "Brand New Workshop", props: { ...first.props, paper_deadline: "2026-10-24", lat: 0, lon: 0 } });
    await afterChange();
    expect(pins()).toHaveLength(19);
    expect(tileTitles()[0]).toBe("Brand New Workshop");
    rows = rows.filter((r) => r.id !== "01NEW");
    await afterChange();
    expect(pins()).toHaveLength(18);
  });

  it("says in one sentence what to add when there are no notes, and reads a failure plainly", async () => {
    rows = [];
    await openPage();
    expect(document.getElementById("content")!.hidden).toBe(true);
    expect(document.getElementById("empty")!.textContent).toMatch(/^Nothing here yet\. Tag a note #conference/);
  });

  it("reads a failed query as one plain sentence, not a broken page", async () => {
    failQuery = true;
    await openPage();
    const empty = document.getElementById("empty")!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute("role")).toBe("alert");
    expect(empty.textContent).toBe("Could not read your notes: That is not allowed. Reopen the page to try again.");
    expect(document.getElementById("content")!.hidden).toBe(true);
  });
});

describe.each(["light", "dark"] as const)("in the %s theme", (theme) => {
  it("takes the app's theme and draws with token variables only", async () => {
    await openPage(theme);
    expect(document.documentElement.getAttribute("data-theme")).toBe(theme);
    const shell = document.getElementById("content")!;
    const inline = [shell, ...Array.from(shell.querySelectorAll<HTMLElement>("*"))].map((e) => e.getAttribute("style") ?? "").filter(Boolean);
    expect(inline.length).toBeGreaterThan(0);
    for (const s of inline) {
      // Only layout variables (a position, a width, a row), never a colour.
      for (const decl of s.split(";").map((d) => d.trim()).filter(Boolean)) expect(decl, s).toMatch(/^(--[\w-]+|font-size)\s*:\s*[-\d.]+(rem|px)?$/);
    }
    const html = shell.outerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/);
    expect(Array.from(shell.querySelectorAll("[fill], [stroke]")).every((e) => /^(none|currentColor|var\(--[\w-]+\))$/.test(e.getAttribute("fill") ?? e.getAttribute("stroke") ?? "none"))).toBe(true);
  });

  it("draws the same markup in both themes: the colours change in the kit's tokens, not in the page", async () => {
    await openPage(theme);
    const html = document.getElementById("content")!.innerHTML;
    host.dispose();
    document.body.innerHTML = "";
    await openPage(theme === "light" ? "dark" : "light");
    expect(document.getElementById("content")!.innerHTML).toBe(html);
  });
});
