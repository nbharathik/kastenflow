// The collection calls reach the commands the app's backend registers, with
// the arguments it reads; the clipper asks before it keeps a page twice.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { tauriCollections } from "./collections-tauri";
import { tauriVault } from "./tauri";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({});
});

describe("the collection calls", () => {
  it("list, read, make, change, rename, trash and restore", async () => {
    await tauriCollections.collections();
    expect(invoke).toHaveBeenLastCalledWith("collections");
    await tauriCollections.collection("views/a.yaml");
    expect(invoke).toHaveBeenLastCalledWith("collection", { path: "views/a.yaml" });
    await tauriCollections.createCollection("Reading queue", { query: "#capture", icon: null });
    expect(invoke).toHaveBeenLastCalledWith("create_collection", { name: "Reading queue", edits: { query: "#capture", icon: null } });
    await tauriCollections.createCollection("Bare");
    expect(invoke).toHaveBeenLastCalledWith("create_collection", { name: "Bare", edits: {} });
    await tauriCollections.updateCollection("views/a.yaml", { when: { updated: "last-7-days" } }, "abc");
    expect(invoke).toHaveBeenLastCalledWith("update_collection", { path: "views/a.yaml", edits: { when: { updated: "last-7-days" } }, baseHash: "abc" });
    await tauriCollections.renameCollection("views/a.yaml", "Other", "abc");
    expect(invoke).toHaveBeenLastCalledWith("rename_collection", { path: "views/a.yaml", name: "Other", baseHash: "abc" });
    await tauriCollections.trashCollection("views/a.yaml");
    expect(invoke).toHaveBeenLastCalledWith("trash_collection", { path: "views/a.yaml" });
    await tauriCollections.restoreCollection(".trash/20260924T080000Z/views/a.yaml");
    expect(invoke).toHaveBeenLastCalledWith("restore_collection", { trashed: ".trash/20260924T080000Z/views/a.yaml" });
  });

  it("send null for a key to remove, so the core removes it", async () => {
    await tauriCollections.updateCollection("views/a.yaml", { icon: null, filter: null }, "h");
    const sent = JSON.parse(JSON.stringify(invoke.mock.calls[0]![1] as object)) as { edits: Record<string, unknown> };
    expect(sent.edits).toEqual({ icon: null, filter: null });
  });
});

describe("the calls about a page that is already saved", () => {
  it("look a page up by its address", async () => {
    await tauriCollections.capturedFrom("https://example.com/a");
    expect(invoke).toHaveBeenLastCalledWith("captured_from", { url: "https://example.com/a" });
  });

  it("clip a page without keeping it twice, unless told to", async () => {
    await tauriCollections.clipPage("https://example.com/a");
    expect(invoke).toHaveBeenLastCalledWith("clip_url", { url: "https://example.com/a", again: false });
    await tauriCollections.clipPage("https://example.com/a", true);
    expect(invoke).toHaveBeenLastCalledWith("clip_url", { url: "https://example.com/a", again: true });
  });

  it("add a tag to many pages in one call", async () => {
    await tauriCollections.addTagToMany(["library/a.md", "library/b.md"], "reading");
    expect(invoke).toHaveBeenLastCalledWith("add_tag_to_many", { paths: ["library/a.md", "library/b.md"], tag: "reading" });
  });

  it("clipUrl keeps the page whatever is saved, and resolves to the note", async () => {
    const note = { meta: { path: "inbox/a.md" }, text: "", hash: "h" };
    invoke.mockResolvedValueOnce({ kind: "saved", note });
    const client = tauriVault("A vault");
    expect(await client.clipUrl("https://example.com/a")).toBe(note);
    expect(invoke).toHaveBeenLastCalledWith("clip_url", { url: "https://example.com/a", again: true });
  });
});
