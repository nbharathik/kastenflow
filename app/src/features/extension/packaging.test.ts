// The installer carries the browser extension, so Chrome or Edge can "Load
// unpacked" from the installed app: the extension's manifest, its popup, its
// icons and its compiled code are Tauri resources, and Settings can show the
// folder. This checks the configuration against the extension's own files; an
// installer, a clean install and an in-place update are not run here.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { describe, expect, it } from "vitest";

/** The repository root: the folder above `app` that holds `browser-extension`. */
const ROOT = (() => {
  let dir = process.cwd();
  while (!existsSync(join(dir, "browser-extension", "manifest.json"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("browser-extension not found above " + process.cwd());
    dir = up;
  }
  return dir;
})();

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const manifest = JSON.parse(read("browser-extension/manifest.json")) as {
  action: { default_popup: string; default_icon: Record<string, string> };
  background: { service_worker: string };
  icons: Record<string, string>;
};
const conf = JSON.parse(read("app/src-tauri/tauri.conf.json")) as { bundle: { resources?: Record<string, string> } };

/** Every file the resources put in the installed app, as paths inside the extension folder: `dir/*` takes the files directly in `dir`. */
function packed(): Set<string> {
  const out = new Set<string>();
  for (const [source, target] of Object.entries(conf.bundle.resources ?? {})) {
    // Sources are relative to app/src-tauri.
    const from = posix.normalize(posix.join("app/src-tauri", source));
    if (!from.startsWith("browser-extension/")) continue;
    const inside = from.slice("browser-extension/".length);
    const into = target.replace(/^browser-extension\/?/, "");
    if (inside.endsWith("/*")) {
      const dir = inside.slice(0, -2);
      for (const name of readdirSync(join(ROOT, "browser-extension", dir))) out.add(posix.join(into, name));
    } else {
      out.add(into);
    }
  }
  return out;
}

describe("the browser extension in the installer", () => {
  it("is a resource of the app, under a folder called browser-extension", () => {
    const resources = conf.bundle.resources ?? {};
    expect(Object.keys(resources).length).toBeGreaterThan(0);
    for (const [source, target] of Object.entries(resources)) {
      if (!source.includes("browser-extension")) continue;
      expect(target.startsWith("browser-extension/"), `${source} goes to ${target}`).toBe(true);
    }
  });

  it("holds every file the manifest names: the popup, the service worker and the icons", () => {
    const files = packed();
    const named = [manifest.action.default_popup, manifest.background.service_worker, ...Object.values(manifest.action.default_icon), ...Object.values(manifest.icons)];
    for (const file of named) expect(files.has(file), file).toBe(true);
    expect(files.has("manifest.json")).toBe(true);
    expect(files.has("README.md")).toBe(true);
  });

  it("holds what the popup page loads", () => {
    const html = read("browser-extension/popup.html");
    const loaded = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]!).filter((ref) => !/^(https?:)?\/\//.test(ref));
    expect(loaded.length).toBeGreaterThan(0);
    const files = packed();
    for (const ref of loaded) expect(files.has(posix.normalize(ref)), ref).toBe(true);
  });

  it("holds all the compiled code, every file, since the worker and the popup import one another", () => {
    const files = packed();
    for (const name of readdirSync(join(ROOT, "browser-extension", "dist"))) expect(files.has(`dist/${name}`), name).toBe(true);
  });

  it("has been compiled: every source file has its compiled file beside the others (a release carries dist/ as it is)", () => {
    const sources = readdirSync(join(ROOT, "browser-extension", "src")).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"));
    const compiled = new Set(readdirSync(join(ROOT, "browser-extension", "dist")));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) expect(compiled.has(name.replace(/\.ts$/, ".js")), name).toBe(true);
  });

  it("leaves the sources and build files out: only what the browser loads travels", () => {
    const files = [...packed()];
    expect(files.some((f) => f.startsWith("src/") || f === "tsconfig.json")).toBe(false);
  });

  it("is told about in the extension's README, which travels with it", () => {
    const readme = read("browser-extension/README.md");
    expect(readme).toContain("Load unpacked");
    expect(readme).toContain("Pair it with KastenFlow");
    // Nothing outside dev/ may name the internal notes.
    expect(readme).not.toMatch(/\bdev\/|ADR/);
  });
});
