import { describe, expect, it } from "vitest";

import { EMBED_ALLOW, EMBED_REFERRER, EMBED_SANDBOX, embedSandbox, embedUrl, frameAddress } from "./live-url.ts";

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

  it("are never a page the app serves itself, nor a host that is written to look like one", () => {
    for (const bad of [
      "http://tauri.localhost./",
      "http://TAURI.localhost/",
      "http://diagrams.localhost/index.html",
      "http://ipc.localhost/",
      "https://anything.localhost:8443/",
      "http://localhost./",
      "http://example.com./",
    ]) {
      expect(embedUrl(bad), bad).toBeNull();
      expect(frameAddress({ url: bad }), bad).toBeNull();
    }
    // A site of the person's own on this computer is still a web address.
    expect(embedUrl("http://localhost:3000/demo")).toBe("http://localhost:3000/demo");
    expect(embedUrl("http://[::1]:3000/")).toBe("http://[::1]:3000/");
  });

  it("run with scripts, their own storage, popups that leave the sandbox, and the player's presentation, and nothing else", () => {
    expect(EMBED_SANDBOX.split(" ").sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-presentation", "allow-same-origin", "allow-scripts"]);
    for (const never of ["allow-forms", "allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-downloads", "allow-pointer-lock", "allow-modals"]) {
      expect(EMBED_SANDBOX).not.toContain(never);
    }
    expect(embedSandbox("https://example.com/a", "http://localhost:3000")).toBe(EMBED_SANDBOX);
  });

  it("may ask for what a video player needs, and say only their origin as the referrer", () => {
    expect(EMBED_ALLOW.split("; ").sort()).toEqual(["autoplay", "encrypted-media", "fullscreen", "picture-in-picture"]);
    expect(EMBED_REFERRER).toBe("strict-origin-when-cross-origin");
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
    expect(Object.keys(live).sort()).toEqual(["EMBED_ALLOW", "EMBED_REFERRER", "EMBED_SANDBOX", "embedSandbox", "embedUrl", "frameAddress"]);
  });
});

describe("what a frame loads for an embed", () => {
  it("is the site's own embed, with the start and the options of the element", () => {
    expect(frameAddress({ url: "https://youtu.be/dQw4w9WgXcQ?t=30" })).toEqual({
      url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&rel=0",
      link: { url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&rel=0", provider: "youtube", kind: "video" },
    });
    expect(frameAddress({ url: "https://youtu.be/dQw4w9WgXcQ", start: 5, muted: true })?.url).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5&mute=1&rel=0");
  });
  it("is an ordinary page as the browser writes it, and nothing for what is not a web address", () => {
    expect(frameAddress({ url: "https://example.com/a b" })?.url).toBe("https://example.com/a%20b");
    expect(frameAddress({ url: "javascript:alert(1)" })).toBeNull();
    expect(frameAddress({ url: "" })).toBeNull();
  });
});
