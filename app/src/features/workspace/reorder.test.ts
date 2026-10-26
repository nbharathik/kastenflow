import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "./preview/memory-vault";
import { moveBeside, moveStep } from "./reorder";
import { useWorkspace } from "./store";
import { noteAt, treeOf } from "./tree";

const page = (id: string, title: string, extra = "") => `---\nid: ${id}\ntitle: ${title}\n${extra}---\nBody of ${title}.\n`;

const SEED = {
  "library/parent.md": page("P", "Parent"),
  "library/apple.md": page("A", "Apple", "parent: P\n"),
  "library/banana.md": page("B", "Banana", "parent: P\n"),
  "library/cherry.md": page("C", "Cherry", "parent: P\n"),
  "library/alone.md": page("L", "Alone"),
};

let vault: MemoryVault;
const shown = () => (treeOf(useWorkspace.getState().notes).children.get("P") ?? []).map((n) => n.title);
const toasts = () => useWorkspace.getState().toasts;
const parentText = async () => (await vault.read("library/parent.md")).text;

beforeEach(async () => {
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
});

describe("reordering sub-pages", () => {
  it("lists them alphabetically until an order is stored", () => {
    expect(shown()).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("moves a page up with one call that stores the whole new list, and the sidebar follows", async () => {
    const spy = vi.spyOn(vault, "reorderChildren");
    expect(await moveStep("library/cherry.md", -1)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("library/parent.md", ["A", "C", "B"]);
    expect(await parentText()).toContain("children_order: [A, C, B]");
    expect(shown()).toEqual(["Apple", "Cherry", "Banana"]);
    expect(noteAt(useWorkspace.getState().notes, "library/parent.md")?.childrenOrder).toEqual(["A", "C", "B"]);
  });

  it("moves a page down", async () => {
    await moveStep("library/apple.md", 1);
    expect(shown()).toEqual(["Banana", "Apple", "Cherry"]);
  });

  it("puts a page before or after another one (a drag)", async () => {
    await moveBeside("library/cherry.md", "library/apple.md", false);
    expect(shown()).toEqual(["Cherry", "Apple", "Banana"]);
    await moveBeside("library/cherry.md", "library/banana.md", true);
    expect(shown()).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("says Undo in the notice and puts the order back", async () => {
    await moveStep("library/cherry.md", -1);
    const action = toasts().at(-1)?.action;
    expect(toasts().at(-1)?.text).toBe("Moved “Cherry” up");
    expect(action?.label).toBe("Undo");
    action!.run();
    await vi.waitFor(() => expect(shown()).toEqual(["Apple", "Banana", "Cherry"]));
    expect(await parentText()).not.toContain("children_order");
  });

  it("says in one sentence when there is nowhere to go", async () => {
    expect(await moveStep("library/apple.md", -1)).toBe(false);
    expect(toasts().at(-1)?.text).toBe("“Apple” is already first.");
    expect(await moveStep("library/cherry.md", 1)).toBe(false);
    expect(toasts().at(-1)?.text).toBe("“Cherry” is already last.");
    expect(await moveStep("library/alone.md", 1)).toBe(false);
    expect(toasts().at(-1)?.text).toBe("Only a page inside another page can be moved up or down.");
    expect(await parentText()).not.toContain("children_order");
  });

  it("changes only the order key of the parent", async () => {
    await moveStep("library/banana.md", -1);
    expect(await parentText()).toBe("---\nid: P\ntitle: Parent\nchildren_order: [B, A, C]\n---\nBody of Parent.\n");
  });
});
