// "Lay out this page": the browser preview's copy is the file the app ships,
// and the steps it names are the real ones of the page-edit tool.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILT_IN_ACTIONS } from "./actions";

const SHIPPED = [join(process.cwd(), "src-tauri"), join(process.cwd(), "app", "src-tauri")].find((dir) => existsSync(dir));

/** The step names of the page-edit tool, as its tool text lists them. */
const STEPS = ["insert", "replace", "move", "delete", "set_todo", "wrap_columns", "unwrap_columns", "toggle", "callout", "table_cells", "table_rows", "table_columns", "embed"];

function shipped(slug: string) {
  const text = readFileSync(join(SHIPPED!, "src/chat/actions/builtin", `${slug}.md`), "utf8").replace(/\r\n/g, "\n");
  const [, front = "", ...body] = text.split(/^---\s*$/m);
  const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
  const list = (key: string) =>
    field(key)
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return { title: field("title"), icon: field("icon"), writes: field("writes"), where: list("where"), needs: list("needs"), optional: list("optional"), instruction: body.join("---").trim() };
}

describe("the Lay out this page action", () => {
  const action = BUILT_IN_ACTIONS.find((a) => a.slug === "layout-page")!;

  it("is the file the app ships", () => {
    expect(SHIPPED).toBeDefined();
    const { title, icon, writes, where, needs, optional, instruction } = action;
    expect({ title, icon, writes, where, needs, optional, instruction }).toEqual(shipped("layout-page"));
  });

  it("proposes, in the page's menu and the chat, and names only tools and steps that exist", () => {
    expect(action.writes).toBe("propose");
    expect(action.where).toEqual(["editor", "chat"]);
    const named = action.instruction.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
    for (const word of named) expect([...STEPS, "read_page_blocks", "edit_page"], word).toContain(word);
    expect(named).toEqual(expect.arrayContaining(["read_page_blocks", "edit_page", "wrap_columns"]));
  });
});
