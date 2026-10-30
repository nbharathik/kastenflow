// The window's code for smart pages stays on its side of the wall: it never
// imports the kit that runs inside a page's frame, never builds a page from
// text (no innerHTML, srcdoc or eval), and the Markdown of a page holds only
// the embed's link.

import { describe, expect, it } from "vitest";

const sources = {
  ...import.meta.glob("./*.{ts,tsx}", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../pages/editor/blocks/smart-embed.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../workspace/page/smart-links.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../workspace/views/settings/SmartSettings.tsx", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

/** The window's own files: not the tests, nor their helpers. */
const host = Object.entries(sources).filter(([name]) => !/\.test\.|test-support/.test(name));

describe("the window's code for smart pages", () => {
  it("is there to be checked", () => {
    const names = host.map(([name]) => name.replace(/^.*\//, ""));
    for (const file of ["SmartFrame.tsx", "SmartBlock.tsx", "SmartPage.tsx", "AllowRun.tsx", "HistoryTab.tsx", "bridge-host.ts", "smart-embed.ts", "smart-links.tsx", "SmartSettings.tsx"]) expect(names, file).toContain(file);
  });

  it("imports nothing of the kit that runs inside a page", () => {
    for (const [name, text] of host) {
      expect(/from\s+["'][^"']*(smart-kit|\/kit\.js)/.test(text), name).toBe(false);
      expect(/import\(\s*["'][^"']*smart-kit/.test(text), name).toBe(false);
    }
  });

  it("builds no page from text: no innerHTML, srcdoc, eval, Function or document.write", () => {
    for (const [name, text] of host) {
      const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/innerHTML|outerHTML|dangerouslySetInnerHTML|srcdoc|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(code), name).toBe(false);
    }
  });

  it("gives a frame the sandbox and nothing a frame could use to leave it", () => {
    const frame = sources["./SmartFrame.tsx"]!;
    expect(frame).toContain("sandbox={SMART_SANDBOX}");
    expect(frame).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
    // Only the frame component makes an iframe.
    for (const [name, text] of host) if (!name.endsWith("SmartFrame.tsx")) expect(/<iframe|createElement\(["']iframe/.test(text), name).toBe(false);
  });
});
