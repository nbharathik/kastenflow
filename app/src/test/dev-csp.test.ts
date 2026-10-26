import { describe, expect, it } from "vitest";

import { appCsp, devCsp } from "../../dev-csp";

describe("the window's policy under tauri dev", () => {
  it("keeps every rule of the app's own, and only opens what hot reload needs", () => {
    const dev = new Map(devCsp(1420).split("; ").map((rule) => [rule.split(" ")[0], rule.split(" ").slice(1)] as const));
    for (const [directive, sources] of Object.entries(appCsp())) {
      if (directive === "script-src") continue;
      for (const source of sources.split(" ")) expect(dev.get(directive), `${directive} ${source}`).toContain(source);
    }
    expect(dev.get("object-src")).toEqual(["'none'"]);
    // A slide's embedded page loads in a frame, and a slide's video plays from the vault's own files.
    // The diagram editor's frame is named too (the `diagrams` scheme, as each system writes it), and a smart page's (the `smart` scheme).
    expect(dev.get("frame-src")).toEqual(["http:", "https:", "http://diagrams.localhost", "diagrams://localhost", "http://smart.localhost", "smart://localhost"]);
    expect(dev.get("media-src")).toEqual(["'self'", "blob:", "asset:", "http://asset.localhost"]);
    expect(dev.get("img-src")).not.toContain("https:");
    expect(dev.get("connect-src")).toContain("ws://localhost:1420");
    // The slide engine is WebAssembly, which a policy must allow to run.
    expect(dev.get("script-src")).toEqual(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]);
    expect(appCsp()["script-src"]).toBe("'self' 'wasm-unsafe-eval'");
  });

  it("lets frames and video in and opens nothing else: what a page in a frame does is its own, and the app's pages still take nothing from outside", () => {
    const app = appCsp();
    expect(app["frame-src"]).toBe("http: https: http://diagrams.localhost diagrams://localhost http://smart.localhost smart://localhost");
    expect(app["media-src"]).toBe("'self' blob: asset: http://asset.localhost");
    // Scripts, styles, connections, pictures, fonts, objects, base addresses and forms are as they were.
    expect(app["default-src"]).toBe("'self'");
    expect(app["script-src"]).toBe("'self' 'wasm-unsafe-eval'");
    expect(app["connect-src"]).toBe("'self' ipc: http://ipc.localhost");
    expect(app["img-src"]).toBe("'self' asset: http://asset.localhost data: blob:");
    expect(app["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(app["font-src"]).toBe("'self' data:");
    expect(app["object-src"]).toBe("'none'");
    expect(app["base-uri"]).toBe("'none'");
    expect(app["form-action"]).toBe("'none'");
    // Only the two are new, and neither takes a script or a connection from anywhere.
    expect(Object.keys(app).sort()).toEqual(["base-uri", "connect-src", "default-src", "font-src", "form-action", "frame-src", "img-src", "media-src", "object-src", "script-src", "style-src"]);
    expect((app["frame-src"] ?? "").split(" ")).not.toContain("*");
    expect((app["media-src"] ?? "").split(" ")).not.toContain("http:");
  });
});
