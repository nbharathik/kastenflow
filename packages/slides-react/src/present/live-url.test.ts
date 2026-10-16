import { describe, expect, it } from "vitest";

import { EMBED_SANDBOX, embedSandbox, embedUrl } from "./live-url.ts";

describe("which addresses go in a frame", () => {
  it("are web addresses, as the browser would write them", () => {
    expect(embedUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(embedUrl("  http://localhost:3000  ")).toBe("http://localhost:3000/");
    expect(embedUrl("http://127.0.0.1:8080/?x=1#y")).toBe("http://127.0.0.1:8080/?x=1#y");
  });

  it("are never a script, a file, a page made of data, a picture in the page, or a relative address", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "file:///etc/passwd", "data:text/html,<script>1</script>", "blob:http://x/1", "about:blank", "ftp://x/y", "//example.com", "example.com", "/local/page", "", "   ", null, undefined]) {
      expect(embedUrl(bad), String(bad)).toBeNull();
    }
  });

  it("run with scripts and their own storage, and nothing else", () => {
    expect(EMBED_SANDBOX.split(" ").sort()).toEqual(["allow-same-origin", "allow-scripts"]);
    expect(embedSandbox("https://example.com/a", "http://localhost:3000")).toBe(EMBED_SANDBOX);
  });

  it("have no storage of their own when they are from the origin of the page around them: they could take the sandbox off", () => {
    expect(embedSandbox("http://localhost:3000/demo", "http://localhost:3000")).toBe("allow-scripts");
    expect(embedSandbox("http://localhost:3001/demo", "http://localhost:3000")).toBe(EMBED_SANDBOX);
    expect(embedSandbox("not an address", "http://localhost:3000")).toBe("allow-scripts");
    expect(embedSandbox("https://example.com/", "null")).toBe(EMBED_SANDBOX);
  });
});

describe("the page is never asked whether an address answers", () => {
  it("has no probe of the network in its addressing: a page's refusal is seen on its frame (web-frame)", async () => {
    const live = await import("./live-url.ts");
    expect(Object.keys(live).sort()).toEqual(["EMBED_SANDBOX", "embedSandbox", "embedUrl"]);
  });
});
