import { describe, expect, it } from "vitest";

import { MemoryVault } from "./memory-vault";
import { setList } from "./tag-yaml";

const TASK = "# Tasks\nname: task\nproperties:\n  - {key: status, type: select, options: [Todo, Done]}\n\nviews:\n  - {name: Board, type: kanban, group_by: status}\n\n# kept\nicon: ✅\n";

describe("setList", () => {
  it("replaces one list and keeps every other byte, as the core does", () => {
    const out = setList(TASK, "views", [{ name: "All", type: "table", sort: [{ key: "due", dir: "asc" }] }]);
    expect(out).toBe(
      "# Tasks\nname: task\nproperties:\n  - {key: status, type: select, options: [Todo, Done]}\n\nviews:\n  - {name: All, type: table, sort: [{key: due, dir: asc}]}\n\n# kept\nicon: ✅\n",
    );
  });

  it("writes none as [], adds a missing list, and keeps CRLF", () => {
    expect(setList(TASK, "views", [])).toContain("\nviews: []\n\n# kept\n");
    expect(setList("name: idea", "views", [{ name: "All", type: "table" }])).toBe("name: idea\nviews:\n  - {name: All, type: table}\n");
    expect(setList("name: a\r\nviews: [{name: X, type: table}]\r\n", "views", [{ name: "L", type: "list" }])).toBe("name: a\r\nviews:\r\n  - {name: L, type: list}\r\n");
    expect(setList("name: a\nviews:\n- name: X\n  type: table\ncolor: red\n", "views", [])).toBe("name: a\nviews: []\ncolor: red\n");
  });
});

describe("MemoryVault tag views", () => {
  it("saves views into the tag's file and reads them back", async () => {
    const vault = new MemoryVault({ "tags/task.yaml": TASK });
    const views = [{ name: "Board", type: "kanban" as const, group_by: "status" }, { name: "All", type: "table" as const }];
    const schema = await vault.setTagViews("#Task", views);
    expect(schema.views).toEqual(views);
    expect((await vault.tagSchemas()).find((s) => s.name === "task")!.views).toEqual(views);
    expect(schema.path).toBe("tags/task.yaml");
  });

  it("makes a file for a new tag, and refuses what it cannot show", async () => {
    const vault = new MemoryVault({});
    const schema = await vault.setTagViews("Side projects", [{ name: "Ideas", type: "list" }]);
    expect(schema).toMatchObject({ name: "Side projects", path: "tags/side-projects.yaml" });
    await expect(vault.setTagViews("x", [{ name: "T", type: "roadmap" as never }])).rejects.toThrow(/unknown type/);
    // A timeline is held to the tag's own properties, as the core holds it.
    await expect(vault.setTagViews("x", [{ name: "T", type: "timeline" }])).rejects.toThrow(/needs a start/);
    await expect(vault.setTagViews("x", [{ name: "T", type: "timeline", start: "when" }])).rejects.toThrow(/not a property/);
    // Every kind the core takes, the gallery too.
    expect((await vault.setTagViews("y", [{ name: "G", type: "gallery" }])).views).toEqual([{ name: "G", type: "gallery" }]);
    await expect(vault.setTagViews("x", [{ name: "A", type: "table" }, { name: "a", type: "list" }])).rejects.toThrow(/two views/);
    await expect(vault.setTagProperties("x", [{ key: "a", type: "text", options: [] }, { key: "a", type: "number", options: [] }])).rejects.toThrow(/two properties/);
  });

  it("replaces properties and keeps the views", async () => {
    const vault = new MemoryVault({ "tags/task.yaml": TASK });
    const schema = await vault.setTagProperties("task", [{ key: "status", type: "select", options: ["Todo", "Waiting", "Done"] }]);
    expect(schema.properties[0]!.options).toEqual(["Todo", "Waiting", "Done"]);
    expect(schema.views).toHaveLength(1);
  });
});
