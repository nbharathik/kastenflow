import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectStateChange } from "../../../lib/vault/project-types";
import type { NoteFile, NoteMeta, VaultClient } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { projectNote } from "../hub/test-support";
import { changeProjectState, previousState } from "./state-actions";

const fileOf = (meta: NoteMeta): NoteFile => ({ meta, text: "" }) as NoteFile;

function setup(props: Record<string, unknown> = {}, fails?: string) {
  const page = projectNote("trip", "Trip", { props });
  const setProjectState = vi.fn(async (_path: string, change: ProjectStateChange) => {
    if (fails) throw new Error(fails);
    const next = { ...props };
    for (const [key, value] of Object.entries(change)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    return fileOf({ ...page, props: next });
  });
  useWorkspace.setState({ client: { setProjectState } as unknown as VaultClient, notes: [page], toasts: [] });
  return { page, setProjectState };
}

const toasts = () => useWorkspace.getState().toasts;

beforeEach(() => {
  useWorkspace.setState({ client: null, notes: [], toasts: [] });
});

describe("what puts a project's state back", () => {
  it("removes a status the page never named, and restores one it did", () => {
    expect(previousState({}, { status: "Paused" })).toEqual({ status: null });
    expect(previousState({ status: "done" }, { status: "Paused" })).toEqual({ status: "Done" });
  });

  it("does the same for the health", () => {
    expect(previousState({}, { health: "At risk" })).toEqual({ health: null });
    expect(previousState({ health: "blocked" }, { health: null })).toEqual({ health: "Blocked" });
  });

  it("only mentions what the change touches", () => {
    expect(previousState({ status: "Paused", health: "Blocked" }, { health: "On track" })).toEqual({ health: "Blocked" });
  });

  it("gives up when the page says something the app cannot write back", () => {
    expect(previousState({ status: "someday" }, { status: "Done" })).toBeNull();
  });
});

describe("changing a project's state", () => {
  it("asks the core, takes the new page into the note list and says so, with an Undo", async () => {
    const { setProjectState } = setup();
    await expect(changeProjectState(projectNote("trip", "Trip"), { status: "Paused" })).resolves.toBe(true);
    expect(setProjectState).toHaveBeenCalledWith("projects/trip/_project.md", { status: "Paused" });
    expect(useWorkspace.getState().notes[0]!.props.status).toBe("Paused");
    expect(toasts().map((t) => t.text)).toEqual(["“Trip” is now Paused"]);
    expect(toasts()[0]!.action?.label).toBe("Undo");
  });

  it("takes it back with Undo, without offering Undo of the Undo", async () => {
    const { setProjectState } = setup();
    await changeProjectState(projectNote("trip", "Trip"), { status: "Paused" });
    toasts()[0]!.action!.run();
    await vi.waitFor(() => expect(setProjectState).toHaveBeenCalledTimes(2));
    expect(setProjectState).toHaveBeenLastCalledWith("projects/trip/_project.md", { status: null });
    await vi.waitFor(() => expect(useWorkspace.getState().notes[0]!.props.status).toBeUndefined());
    expect(toasts().at(-1)!.text).toBe("“Trip” is Active again");
    expect(toasts().at(-1)!.action).toBeUndefined();
  });

  it("words the health, and clearing it", async () => {
    setup({ health: "Blocked" });
    await changeProjectState(projectNote("trip", "Trip", { props: { health: "Blocked" } }), { health: "At risk" });
    expect(toasts().at(-1)!.text).toBe("“Trip” is At risk");
    await changeProjectState(projectNote("trip", "Trip", { props: { health: "At risk" } }), { health: null });
    expect(toasts().at(-1)!.text).toBe("Cleared the health of “Trip”");
  });

  it("shows the core's refusal and changes nothing", async () => {
    setup({}, "The tag #paper defines status");
    await expect(changeProjectState(projectNote("trip", "Trip"), { status: "Done" })).resolves.toBe(false);
    expect(toasts().map((t) => t.text)).toEqual(["The tag #paper defines status"]);
    expect(useWorkspace.getState().notes[0]!.props.status).toBeUndefined();
  });

  it("offers no Undo when the old value cannot be written back", async () => {
    setup({ status: "someday" });
    await changeProjectState(projectNote("trip", "Trip", { props: { status: "someday" } }), { status: "Done" });
    expect(toasts()[0]!.action).toBeUndefined();
  });

  it("does nothing without a vault", async () => {
    await expect(changeProjectState(projectNote("trip", "Trip"), { status: "Done" })).resolves.toBe(false);
    expect(toasts()).toEqual([]);
  });
});
