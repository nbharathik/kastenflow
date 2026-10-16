// "Go to Projects" in the palette and the shortcut lists.

import { beforeEach, describe, expect, it } from "vitest";

import { KEY_SECTIONS } from "../../shortcuts/catalog";
import { useWorkspace } from "../store";
import { derive } from "../store-layout";
import { initialLayout } from "../tabs";
import { COMMANDS } from "./commands";

beforeEach(() => {
  useWorkspace.setState({ ...derive(initialLayout()), notes: [], stack: [], stackOpen: false });
});

describe("the palette's Go to Projects", () => {
  const command = () => COMMANDS.find((c) => c.id === "projects")!;

  it("is one entry that opens the Projects hub", () => {
    expect(command().label).toBe("Go to Projects");
    command().run();
    expect(useWorkspace.getState().place).toEqual({ view: "projects" });
  });

  it("is found by the words a person would try, and is in the shortcut sheet under Go to", () => {
    for (const word of ["gallery", "status", "overdue", "archive"]) expect(command().words).toContain(word);
    expect(KEY_SECTIONS.find((s) => s.title === "Go to")!.ids).toContain("projects");
    expect(COMMANDS.filter((c) => c.id === "projects")).toHaveLength(1);
  });
});
