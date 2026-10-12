// What the extension is allowed to do is written once, in its manifest, and kept
// small: four permissions and one host. Its own code reaches no other address.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "../../../../../browser-extension/manifest.json";

/** The extension's folder: the tests run from `app/`. */
const FOLDER = [join(process.cwd(), "browser-extension"), join(process.cwd(), "..", "browser-extension")].find((dir) => existsSync(join(dir, "manifest.json")))!;
const sources = () => readdirSync(join(FOLDER, "src")).filter((name) => name.endsWith(".ts"));

describe("the manifest", () => {
  it("is Manifest V3 with four permissions and one host, and nothing that reaches into pages by itself", () => {
    expect(manifest.manifest_version).toBe(3);
    expect([...manifest.permissions].sort()).toEqual(["activeTab", "contextMenus", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*"]);
    for (const key of ["content_scripts", "externally_connectable", "web_accessible_resources", "optional_permissions", "optional_host_permissions", "declarative_net_request", "key"]) {
      expect(key in manifest, key).toBe(false);
    }
  });

  it("names a popup, a service worker and icons that are there", () => {
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(existsSync(join(FOLDER, "popup.html"))).toBe(true);
    // Compiled by `tsc` from the source of the same name.
    expect(manifest.background).toEqual({ service_worker: "dist/background-main.js", type: "module" });
    expect(existsSync(join(FOLDER, "src", "background-main.ts"))).toBe(true);
    expect(readFileSync(join(FOLDER, "popup.html"), "utf8")).toContain('src="dist/popup-main.js"');
    expect(existsSync(join(FOLDER, "src", "popup-main.ts"))).toBe(true);
    for (const icon of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) expect(existsSync(join(FOLDER, icon)), icon).toBe(true);
  });

  it("asks nothing of the person but Kasten's own address: no page of the web is named in its code", () => {
    const found = sources().flatMap((name) => {
      const text = readFileSync(join(FOLDER, "src", name), "utf8");
      return [...text.matchAll(/https?:\/\/[A-Za-z0-9.[\]-]+/g)].map((m) => `${name} ${m[0]}`).filter((hit) => !hit.endsWith("http://127.0.0.1"));
    });
    expect(found).toEqual([]);
  });

  it("brings in no package: it is plain TypeScript, compiled by tsc", () => {
    expect(existsSync(join(FOLDER, "package.json"))).toBe(false);
    for (const name of sources()) {
      const imports = [...readFileSync(join(FOLDER, "src", name), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
      for (const target of imports) expect(target.startsWith("./"), `${name} imports ${target}`).toBe(true);
    }
  });

  it("tells the page nothing of Kasten's: no cookies, and no use of the page's own address for where to send", () => {
    const client = readFileSync(join(FOLDER, "src", "client.ts"), "utf8");
    expect(client).toContain('credentials: "omit"');
    expect(client).toContain('referrerPolicy: "no-referrer"');
    expect(client).not.toMatch(/location\.|window\./);
  });
});
