import { describe, expect, it } from "vitest";

import type { SetupPlan } from "../../../lib/vault/project-types";
import { describePlan } from "./setup-preview";

const plan = (create: string[], over: Partial<SetupPlan> = {}): SetupPlan => ({
  projectPath: "projects/thesis/_project.md",
  home: "projects/thesis/pages/Reading list.md",
  create,
  keep: [],
  props: [],
  ...over,
});

describe("what a setup would make", () => {
  it("lists pages, whiteboards, decks and tag databases by name, leaving the project page for its own line", () => {
    const text = describePlan(
      plan([
        "projects/thesis/_project.md",
        "projects/thesis/pages/Reading list.md",
        "projects/thesis/pages/Questions.md",
        "projects/thesis/map.canvas",
        "projects/thesis/talk.deck",
        "tags/paper.yaml",
      ]),
    );
    expect(text.pages).toEqual(["Reading list", "Questions"]);
    expect(text.boards).toEqual(["map"]);
    expect(text.decks).toEqual(["talk"]);
    expect(text.databases).toEqual(["paper"]);
    expect(text.sentence).toBe("The project page, 2 pages, 1 whiteboard, 1 deck and 1 tag database.");
  });

  it("says just the project page for a blank project", () => {
    expect(describePlan(plan(["projects/thesis/_project.md"])).sentence).toBe("The project page.");
  });

  it("leaves the project page out when the project exists already, and says what stays", () => {
    const text = describePlan(plan(["projects/thesis/pages/Questions.md"], { keep: ["projects/thesis/pages/Reading list.md"] }));
    expect(text.sentence).toBe("1 page.");
    expect(text.kept).toBe(1);
  });

  it("says when there is nothing to add", () => {
    expect(describePlan(plan([], { projectPath: "projects/thesis/_project.md", keep: ["a.md"] })).sentence).toBe("Nothing: everything it makes is there already.");
  });
});
