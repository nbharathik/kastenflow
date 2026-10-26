// The person's batch calls reach the commands the app's backend registers, and
// the changes are written as kasten-core's ops read them.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { createPage, newTagSchema, ref, replaceBlock, viewOrder } from "./batch-changes";
import { tauriBatch } from "./batch-tauri";
import { BATCH_LIMITS } from "./batch-types";

beforeEach(() => invoke.mockClear());

describe("the batch calls", () => {
  it("send the changes and the summary, or none", async () => {
    const changes = [createPage({ title: "A" })];
    await tauriBatch.runBatch(changes, "Do it");
    expect(invoke).toHaveBeenLastCalledWith("batch_run", { changes, reason: "Do it" });
    await tauriBatch.runBatch(changes);
    expect(invoke).toHaveBeenLastCalledWith("batch_run", { changes, reason: null });
  });

  it("read a page's blocks and ask where a new tag's schema goes", async () => {
    await tauriBatch.pageBlocks("library/a.md");
    expect(invoke).toHaveBeenLastCalledWith("page_blocks", { path: "library/a.md" });
    await tauriBatch.newTagFile("reading-list");
    expect(invoke).toHaveBeenLastCalledWith("new_tag_file", { tag: "reading-list" });
  });

  it("know the limits the core keeps", () => {
    expect(BATCH_LIMITS).toEqual({ changes: 100, bytes: 1024 * 1024 });
  });
});

describe("the changes", () => {
  it("make a page with its tags, properties and where it goes", () => {
    expect(createPage({ title: "Dune", tags: ["books"], props: { Pages: 412 }, parent: "library/shelf.md" })).toEqual({
      kind: "create_note",
      type: "page",
      title: "Dune",
      tags: ["books"],
      props: { Pages: 412 },
      parent: "library/shelf.md",
    });
    expect(createPage({ title: "A", project: "market" })).toEqual({ kind: "create_note", type: "page", title: "A", tags: [], props: {}, project: "market" });
    expect(createPage({ title: "A", project: null })).not.toHaveProperty("project");
  });

  it("name a note an earlier change makes", () => {
    expect(ref(0)).toEqual({ $ref: 0 });
    const child = createPage({ title: "B", parent: ref(0) });
    expect(child.parent).toEqual({ $ref: 0 });
    // It goes over the wire as plain JSON the core reads.
    expect(JSON.parse(JSON.stringify(child))).toMatchObject({ parent: { $ref: 0 } });
  });

  it("write a tag's schema with only the options a property has", () => {
    expect(newTagSchema("books", [{ key: "Pages", type: "number", options: [] }, { key: "Stage", type: "select", options: ["Read", "Next"] }], [{ name: "Table", type: "table" }])).toEqual({
      kind: "tag_schema",
      tag: "books",
      schema: {
        properties: [{ key: "Pages", type: "number" }, { key: "Stage", type: "select", options: ["Read", "Next"] }],
        views: [{ name: "Table", type: "table" }],
      },
    });
  });

  it("replace a block, and put rows in order", () => {
    expect(replaceBlock("library/a.md", { id: "b2", hash: "abc" }, "![[tags/x.yaml#Table]]\n")).toEqual({
      kind: "edit_page",
      path: "library/a.md",
      steps: [{ op: "replace", block: { block: "b2", hash: "abc" }, markdown: "![[tags/x.yaml#Table]]\n" }],
    });
    expect(viewOrder("task", "Table", ["01A", "01B"])).toEqual({ kind: "set_view_order", tag: "task", view: "Table", ids: ["01A", "01B"] });
  });
});
