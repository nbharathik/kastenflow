// The people and dates the `@` menu offers beside pages: notes tagged
// `person` or `people`, and the day weeks start on (Settings → Calendar).

import type { NoteMeta } from "../../../lib/vault/types";
import type { LinkProvider, PageLink } from "../../pages/editor/links";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../store";
import { linkPages } from "./page-links";

const PERSON_TAGS = new Set(["person", "people"]);

const cache = new WeakMap<readonly NoteMeta[], PageLink[]>();

/** The pages a note list holds that are tagged as people, made once per list. */
export function peopleIn(notes: readonly NoteMeta[]): PageLink[] {
  let people = cache.get(notes);
  if (!people) {
    const names = new Set(notes.filter((n) => n.tags.some((t) => PERSON_TAGS.has(t.toLowerCase()))).map((n) => n.path));
    people = linkPages(notes).filter((p) => p.path !== undefined && names.has(p.path));
    cache.set(notes, people);
  }
  return people;
}

export function peopleLinks(): Required<Pick<LinkProvider, "people" | "weekStart">> {
  return {
    people: () => peopleIn(useWorkspace.getState().notes),
    weekStart: () => usePrefs.getState().weekStart,
  };
}
