// The small tools in an embed's head are icons: no words, a name for screen
// readers and a tooltip, reachable by keyboard, and shown whenever the embed is
// pointed at, holds the focus or is being worked on.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { embedTool } from "./embed-tools";

const here = dirname(fileURLToPath(import.meta.url));
const source = (name: string) => readFileSync(join(here, name), "utf8");

describe("embedTool", () => {
  it("is a button with an icon, a name and a tooltip, and no words", () => {
    const tool = embedTool("kasten-board-embed-open", "icon:arrow-up-right", "Open whiteboard", "Open the whiteboard (Ctrl+click for a new tab)");
    expect(tool.tagName).toBe("BUTTON");
    expect(tool.type).toBe("button");
    expect(tool.getAttribute("aria-label")).toBe("Open whiteboard");
    expect(tool.title).toBe("Open the whiteboard (Ctrl+click for a new tab)");
    expect(tool.textContent).toBe("");
    expect(tool.querySelector("svg")).not.toBeNull();
    expect(tool.classList.contains("kasten-embed-tool")).toBe(true);
    expect(tool.classList.contains("kasten-board-embed-open")).toBe(true);
    expect(tool.tabIndex).toBe(0);
  });

  it("uses its name as the tooltip when it is given no other", () => {
    expect(embedTool("x", "icon:present", "Present").title).toBe("Present");
  });
});

describe("the embeds' heads", () => {
  it("write no words for the repeated tools (Open, Present)", () => {
    for (const name of ["board-embed.ts", "database-embed.ts", "embed-view.ts", "deck-embed.ts", "diagram-embed.ts"]) {
      const text = source(name);
      expect(text, name).not.toMatch(/textContent:\s*"(Open[^"]*|Present)"/);
    }
  });

  it("show the tools on hover, on keyboard focus and while the embed is worked on", () => {
    const css = source("embed-tools.css");
    expect(css).toMatch(/\.kasten-embed-tool\s*\{[^}]*opacity:\s*0/);
    expect(css).toContain(":hover .kasten-embed-tool");
    expect(css).toContain(":focus-within .kasten-embed-tool");
    expect(css).toContain(".kasten-embed-tool:focus-visible");
    expect(css).toContain('[data-active="true"] .kasten-embed-tool');
  });

  it("leave nothing hidden by opacity in the embeds' styles without a focus reveal", () => {
    const hides = readdirSync(here)
      .filter((name) => name.endsWith(".css") && /embed|divider|bookmark/.test(name))
      .filter((name) => /opacity:\s*0;/.test(source(name)) && !/:focus-within|:focus-visible/.test(source(name)));
    expect(hides).toEqual([]);
  });
});
