import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../../lib/vault/types";
import { peopleIn, peopleLinks } from "./people-links";
import { usePrefs } from "../prefs";

const note = (title: string, tags: string[], path = `notes/${title.toLowerCase().replace(/\W+/g, "-")}.md`): NoteMeta => ({
  path,
  id: null,
  title,
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags,
  modified: 0,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
});

describe("people for @", () => {
  it("are the pages tagged person or people, whatever the case", () => {
    const notes = [note("Sam Taylor", ["person"]), note("Priya Rao", ["People", "team"]), note("Roadmap", ["project"]), note("Untagged", [])];
    expect(peopleIn(notes).map((p) => p.title)).toEqual(["Sam Taylor", "Priya Rao"]);
  });

  it("keep each page's path, so the link names the right page", () => {
    const notes = [note("Sam", ["person"], "people/sam.md"), note("Sam", [], "notes/sam.md")];
    expect(peopleIn(notes).map((p) => p.path)).toEqual(["people/sam.md"]);
  });

  it("are made once per notes list", () => {
    const notes = [note("Sam", ["person"])];
    expect(peopleIn(notes)).toBe(peopleIn(notes));
  });
});

describe("the day weeks start on", () => {
  it("comes from the preferences", () => {
    usePrefs.setState({ weekStart: 0 });
    expect(peopleLinks().weekStart()).toBe(0);
    usePrefs.setState({ weekStart: 1 });
    expect(peopleLinks().weekStart()).toBe(1);
  });
});
