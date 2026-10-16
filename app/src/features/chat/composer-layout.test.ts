// The message box keeps one size: a fixed number of rows, a fixed bar, one row of
// chips. jsdom lays nothing out, so this reads the style sheets the way the
// scan tests do and pins the declarations that keep it still.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => existsSync(join(dir, "main.tsx")))!;
const read = (path: string) => readFileSync(join(SRC, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The text between the braces of the first rule whose selector line is exactly `selector`, nested rules included. */
function block(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"));
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  return "";
}

const composer = read("features/chat/composer.css");
const chips = read("features/chat/chips.css");
const changes = read("features/chat/changes/changes.css");

describe("the message box's size", () => {
  it("gives the text box a height from its rows, never a minimum or a maximum", () => {
    const box = block(composer, ".kasten-chat-composer");
    expect(box).toMatch(/height:\s*calc\(var\(--chat-lines,\s*3\)\s*\*\s*1\.5em\s*\+\s*14px\)/);
    expect(box).toMatch(/overflow-y:\s*auto/);
    expect(box).toMatch(/scrollbar-gutter:\s*stable/);
    expect(box).toMatch(/field-sizing:\s*fixed/);
    expect(composer).not.toMatch(/max-height:\s*220px/);
    expect(composer).not.toMatch(/min-height:\s*44px/);
  });

  it("measures nothing in the component", () => {
    const code = readFileSync(join(SRC, "features/chat/view/Composer.tsx"), "utf8");
    expect(code).not.toMatch(/MAX_HEIGHT|scrollHeight|useLayoutEffect|style\.height/);
    expect(code).toMatch(/rows=\{3\}/);
  });

  it("keeps the bar at 44px with or without a model picker", () => {
    const bar = block(composer, ".kasten-chat-composer-bar");
    expect(bar).toMatch(/height:\s*44px/);
    expect(bar).toMatch(/box-sizing:\s*border-box/);
  });

  it("keeps the chips in one row of one height whose chips scroll sideways, with + Context beside them", () => {
    const row = block(composer, ".kasten-chat-chips");
    expect(row).toMatch(/height:\s*33px/);
    expect(row).toMatch(/box-sizing:\s*border-box/);
    expect(row).not.toMatch(/flex-wrap:\s*wrap/);
    const scrolling = block(composer, ".kasten-chat-chips-scroll");
    expect(scrolling).toMatch(/flex-wrap:\s*nowrap/);
    expect(scrolling).toMatch(/overflow-x:\s*auto/);
    expect(scrolling).toMatch(/scrollbar-width:\s*none/);
    expect(scrolling).toMatch(/min-width:\s*0/);
    expect(block(composer, ".kasten-chat-chip")).toMatch(/flex:\s*none/);
    expect(block(composer, ".kasten-chat .kasten-chat-add-button")).toMatch(/flex:\s*none/);
  });

  it("opens the list a chip holds over the box, so the box does not grow", () => {
    const list = block(chips, ".kasten-chat-chip-list");
    expect(list).toMatch(/position:\s*absolute/);
    expect(list).toMatch(/max-height:/);
    expect(list).toMatch(/overflow:\s*auto/);
  });

  it("opens the + Context menus from the box, which does not clip them", () => {
    // The chips scroll, so a menu positioned from a chip's own container would be cut off by that row.
    expect(composer).not.toMatch(/\.kasten-chat-add\s*\{[^}]*position:\s*relative/);
    expect(block(composer, ".kasten-chat-add")).toMatch(/position:\s*static/);
  });

  it("caps the staged changes the box has above it", () => {
    expect(block(changes, ".kasten-changes-view")).toMatch(/max-height:\s*min\(35vh,\s*320px\)/);
  });
});
