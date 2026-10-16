// A repair on the health page is shown before it is done: what it will do, what
// it leaves alone, and how to take it back. Applying one is an operation the
// app already has (trash, make a page, draw a picture again), with its Undo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramEditor } from "../diagrams/editor";
import { useDiagramHost } from "../diagrams/host-store";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { planRepair } from "./repairs";

const COPY = "library/Plan (conflict 2026-10-11 09-30).md";
const SEED = {
  "library/Plan.md": "---\ntitle: Plan\n---\nMine.\n",
  [COPY]: "---\ntitle: Plan\n---\nTheirs.\n",
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  "projects/trip/pages/plan.md": "---\ntitle: Trip plan\n---\nSee [[Hotels]].\n",
};

let vault: MemoryVault;
const paths = async () => (await vault.list()).map((n) => n.path);

beforeEach(async () => {
  vault = new MemoryVault(SEED);
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.setState({ toasts: [] });
  useDiagramHost.setState({ queue: [], seen: [], editing: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  useWorkspace.setState({ client: null });
});

describe("planning a repair writes nothing", () => {
  it("describes trashing a conflict copy, with the page it came from left alone", async () => {
    const before = await paths();
    const plan = planRepair({ kind: "trash-copy", copy: COPY, original: "library/Plan.md" }, { editorInstalled: true });
    expect(plan.will).toEqual([`Move “${COPY}” to the trash.`]);
    expect(plan.leaves).toContain("library/Plan.md");
    expect(plan.leaves).toContain("is not touched");
    expect(plan.undo).toContain("Undo");
    expect(plan.blocked).toBeNull();
    expect(await paths()).toEqual(before);
    // Without the page it came from, it says so rather than promising it is safe.
    const alone = planRepair({ kind: "trash-copy", copy: COPY, original: null }, { editorInstalled: true });
    expect(alone.leaves).toContain("page it came from is not at its old place");
  });

  it("describes making a page for a link that leads nowhere, in the project of the page that has it", () => {
    const inProject = planRepair({ kind: "create-page", title: "Hotels", project: "trip" }, { editorInstalled: true });
    expect(inProject.will.join(" ")).toContain("empty page called “Hotels”");
    expect(inProject.will.join(" ")).toContain("trip");
    expect(planRepair({ kind: "create-page", title: "Hotels", project: null }, { editorInstalled: true }).will.join(" ")).toContain("library");
  });

  it("describes drawing a picture again, and is blocked while the diagram editor is not installed", () => {
    const ready = planRepair({ kind: "redraw-picture", diagram: "library/flow.drawio", title: "flow" }, { editorInstalled: true });
    expect(ready.blocked).toBeNull();
    expect(ready.leaves).toContain("The diagram itself is not changed");
    const blocked = planRepair({ kind: "redraw-picture", diagram: "library/flow.drawio", title: "flow" }, { editorInstalled: false });
    expect(blocked.blocked).toContain("Install the diagram editor");
  });
});

describe("applying a repair", () => {
  it("moves the copy to the trash and leaves the page, with an Undo in the notice", async () => {
    const plan = planRepair({ kind: "trash-copy", copy: COPY, original: "library/Plan.md" }, { editorInstalled: true });
    const done = await plan.apply();
    expect(done).toContain("trash");
    const after = await paths();
    expect(after).not.toContain(COPY);
    expect(after).toContain("library/Plan.md");
    const undo = useWorkspace.getState().toasts.at(-1)?.action;
    expect(undo?.label).toBe("Undo");
    void undo!.run();
    await expect.poll(paths).toContain(COPY);
  });

  it("makes the page in the project, and Undo takes it away again", async () => {
    const plan = planRepair({ kind: "create-page", title: "Hotels", project: "trip" }, { editorInstalled: true });
    await plan.apply();
    const made = (await vault.list()).find((n) => n.title === "Hotels");
    expect(made?.path.startsWith("projects/trip/")).toBe(true);
    const undo = useWorkspace.getState().toasts.at(-1)?.action;
    expect(undo?.label).toBe("Undo");
    void undo!.run();
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "Hotels")).toBeUndefined();
  });

  it("asks for the picture to be drawn again, even when it was drawn before", async () => {
    useDiagramHost.setState({ seen: ["library/flow.drawio"] });
    useDiagramEditor.setState({ info: { version: "32.2.0", bytes: 1, url: "", installed: true, busy: false } });
    const plan = planRepair({ kind: "redraw-picture", diagram: "library/flow.drawio", title: "flow" }, { editorInstalled: true });
    await plan.apply();
    expect(useDiagramHost.getState().queue).toContain("library/flow.drawio");
  });

  it("refuses a blocked repair without doing anything", async () => {
    const plan = planRepair({ kind: "redraw-picture", diagram: "library/flow.drawio", title: "flow" }, { editorInstalled: false });
    await expect(plan.apply()).rejects.toThrow("Install the diagram editor");
    expect(useDiagramHost.getState().queue).toEqual([]);
  });
});
