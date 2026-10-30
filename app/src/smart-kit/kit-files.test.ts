import { beforeEach, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { kitUrl } from "../lib/vault/smart-types";
import { COMPONENTS, CORE, DATA, kitFiles, kitSource, loadKit, mountPoint, type Kit } from "./test-support/env";

// CSS is read from disk: the test runner turns a stylesheet import into nothing.
const here = import.meta.dirname;
const appStyles = readFileSync(join(here, "..", "styles.css"), "utf8");
const FILES = import.meta.glob<string>(["./docs/*.md", "./examples/*.html"], { query: "?raw", import: "default", eager: true });
const css = readFileSync(join(here, "kit.css"), "utf8");
const docs = Object.fromEntries(Object.entries(FILES).filter(([k]) => k.startsWith("./docs/")).map(([k, v]) => [k.slice(7, -3), v]));
const examples = Object.entries(FILES).filter(([k]) => k.startsWith("./examples/"));

const [START, END] = ["/* tokens:start */", "/* tokens:end */"];
const tokensBlock = css.slice(css.indexOf(START), css.indexOf(END));
const rest = css.replace(tokensBlock, "").replace(/\/\*[\s\S]*?\*\//g, "");
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|cyan|magenta|silver|gold|navy|teal)(?![\w-])/i;

describe("kit.css", () => {
  it("has its colours only in the tokens block", () => {
    expect(css.indexOf(START)).toBeGreaterThan(-1);
    expect(css.indexOf(END)).toBeGreaterThan(css.indexOf(START));
    expect(rest).not.toMatch(RAW_COLOUR);
    expect(tokensBlock).toMatch(RAW_COLOUR);
  });

  it("uses no raw colours in the scripts either", () => {
    for (const f of kitFiles()) {
      const code = kitSource(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/#[0-9a-fA-F]{3,8}["'\s;)]|\b(?:rgb|rgba|hsl|hsla)\(/);
    }
  });

  const DARK = ':root[data-theme="dark"]';
  const value = (slice: string, name: string) => new RegExp(`--color-${name}:\\s*([^;]+);`).exec(slice)?.[1]?.trim();
  const darkBlock = (source: string) => {
    const at = source.indexOf(DARK);
    return source.slice(at, source.indexOf("}", at));
  };

  it("takes its token values from the app, light and dark", () => {
    const names = ["canvas", "panel", "well", "raised", "line", "line-strong", "ink", "muted", "faint", "accent", "danger", "success", "warning", "favourite"];
    const mineLight = tokensBlock.slice(0, tokensBlock.indexOf(DARK));
    const theirsLight = appStyles.slice(0, appStyles.indexOf(DARK));
    for (const n of names) {
      expect(value(darkBlock(appStyles), n), `app dark ${n}`).toBeTruthy();
      expect(value(mineLight, n), `light ${n}`).toBe(value(theirsLight, n));
      expect(value(darkBlock(tokensBlock), n), `dark ${n}`).toBe(value(darkBlock(appStyles), n));
    }
    expect(value(mineLight, "on-accent")).toBe(value(theirsLight, "on-accent"));
  });

  it("follows the app theme with a data-theme switch and respects reduced motion", () => {
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("@media print");
    expect(css.split("\n").length).toBeLessThan(400);
  });
});

describe("kit files", () => {
  it("keeps every script under about 400 lines", () => {
    for (const f of kitFiles()) expect(kitSource(f).split("\n").length, f).toBeLessThan(400);
  });

  it("loads in the documented order without errors", () => {
    expect(() => loadKit()).not.toThrow();
    expect(kitFiles().sort()).toEqual([...CORE, ...COMPONENTS].sort());
  });
});

describe("docs", () => {
  const names = ["countdown", "gallery", "table", "stat", "legend", "bar", "line", "donut", "sparkline", "timeline", "kanban", "calendar", "map"];
  let kit: Kit;
  beforeEach(() => {
    kit = loadKit();
    mountPoint();
  });

  it("has a page for the kit and for every component", () => {
    expect(Object.keys(docs).sort()).toEqual(["kit", ...names].sort());
    for (const n of names) expect(Object.keys(kit.components)).toContain(n);
  });

  it.each(["kit", ...names])("%s: the example runs and draws something", (name) => {
    const md = docs[name] ?? "";
    expect(md).toMatch(/^# /);
    const example = /## Example\s+```js\n([\s\S]*?)```/.exec(md)?.[1];
    expect(example, "an Example section with a js block").toBeTruthy();
    new Function("kit", example!)(kit);
    expect(document.getElementById("app")!.childNodes.length).toBeGreaterThan(0);
    expect(document.getElementById("app")!.querySelector('[role="alert"]')).toBeNull();
  });

  it("names the script and style files the pages load, and they exist", () => {
    const urls = new Set<string>();
    for (const [, html] of examples) for (const m of html.matchAll(/(?:src|href)="(smart:\/\/kit\/1\/[^"]+)"/g)) urls.add(m[1]!);
    const known = (file: string) => file === "kit.css" || file === "kit-visual.css" || DATA.includes(file) || kitFiles().includes(file);
    for (const u of urls) expect(known(u.replace("smart://kit/1/", "")), u).toBe(true);
    expect(urls.has(kitUrl("1", "kit.js"))).toBe(true);
    for (const m of (docs.kit ?? "").matchAll(/(?:src|href)="(smart:\/\/kit\/1\/[^"]+)"/g)) expect(known(m[1]!.replace("smart://kit/1/", "")), m[1]).toBe(true);
  });

  it("uses no internal names in public text", () => {
    const all = [css, ...Object.values(docs), ...examples.map((e) => e[1]), ...kitFiles().map(kitSource)].join("\n");
    expect(all).not.toMatch(/\bdev\/|\bADR\b|milestone/i);
  });
});
