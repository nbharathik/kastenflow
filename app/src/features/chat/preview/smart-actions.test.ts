// The three smart page actions: the browser preview's copy is the file the app
// ships, they propose (so a chat stages them), they are offered where they fit,
// and they name only tools the server really has.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILT_IN_ACTIONS } from "./actions";

const SHIPPED = [join(process.cwd(), "src-tauri"), join(process.cwd(), "app", "src-tauri")].find((dir) => existsSync(dir));

/** The smart page tools of the server, and the one field of `smart_edit` the words name. */
const TOOLS = ["query_tag", "smart_create", "smart_read", "smart_edit", "smart_check", "smart_write_file", "base_hash"];

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

const SLUGS = ["make-smart-page", "improve-smart-layout", "fix-smart-errors"];
const find = (slug: string) => BUILT_IN_ACTIONS.find((a) => a.slug === slug)!;

describe("the smart page actions", () => {
  it("have the titles people see, and each is the file the app ships", () => {
    expect(SHIPPED).toBeDefined();
    expect(SLUGS.map((s) => find(s).title)).toEqual(["Make a smart page from this", "Improve this smart page's layout", "Fix its errors"]);
    for (const slug of SLUGS) {
      const { title, icon, writes, where, needs, optional, instruction } = find(slug);
      expect({ title, icon, writes, where, needs, optional, instruction }, slug).toEqual(shipped(slug));
    }
  });

  it("propose, so a chat stages what they change", () => {
    for (const slug of SLUGS) expect(find(slug).writes, slug).toBe("propose");
  });

  it("are offered in the right places: making in the page menu and the chat, the other two only from a smart page", () => {
    expect(find("make-smart-page").where).toEqual(["editor", "chat"]);
    expect(find("improve-smart-layout").where).toEqual(["smart"]);
    expect(find("fix-smart-errors").where).toEqual(["smart"]);
    for (const slug of SLUGS) expect(find(slug).where, slug).not.toContain("latex");
  });

  it("name only tools that exist, and the last two say what to do on a page that is not a smart page", () => {
    for (const slug of SLUGS) {
      const named = find(slug).instruction.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
      expect(named.length, slug).toBeGreaterThan(0);
      for (const word of named) expect(TOOLS, `${slug}: ${word}`).toContain(word);
    }
    for (const slug of ["improve-smart-layout", "fix-smart-errors"]) expect(find(slug).instruction).toContain("is not a smart page, say so and change nothing");
    expect(find("fix-smart-errors").instruction).toContain("smart_read");
    expect(find("make-smart-page").instruction).toContain("kasten://smart/kit");
  });
});
