// A project's home: the dashboard at the top of its project page.
// What it shows is the `home` property of the project page, beside
// `archived`: absent for the usual sections, `false` to hide it, or the
// list of sections in their order. Written with the core's update_props.

import { chosen, sameList, type SectionDef } from "../dashboard/sections";

export type ProjectSection = "summary" | "capture" | "todo" | "kanban" | "recent" | "pages" | "cards" | "boards" | "decks";

export const PROJECT_SECTIONS: readonly SectionDef<ProjectSection>[] = [
  { id: "summary", label: "Summary", icon: "gauge", hint: "What the project is, and how far along", wide: true },
  { id: "capture", label: "Quick note", icon: "zap", hint: "Catch a thought as a card in this project", wide: true },
  { id: "pages", label: "Pages", icon: "page", hint: "Every page in the project" },
  { id: "boards", label: "Whiteboards", icon: "board", hint: "The project's whiteboards" },
  { id: "decks", label: "Decks", icon: "present", hint: "The project's slide decks, with their first slide" },
  { id: "todo", label: "To-dos", icon: "tasks", hint: "Open to-dos in the project's pages" },
  { id: "recent", label: "Recently edited", icon: "clock", hint: "The project's latest pages and cards" },
  { id: "kanban", label: "Task board", icon: "kanban", hint: "The project's #task notes by status", wide: true },
  { id: "cards", label: "Cards", icon: "cards", hint: "The project's short notes" },
];

/** What a project holds first (its pages and boards, side by side), then
 * what is going on in it (to-dos and recent edits). */
export const PROJECT_DEFAULT: readonly ProjectSection[] = ["summary", "capture", "pages", "boards", "todo", "recent"];

export interface ProjectHomeSettings {
  shown: boolean;
  sections: ProjectSection[];
}

/** The home a project page asks for with its `home` property. */
export function projectHome(props: Record<string, unknown>): ProjectHomeSettings {
  const value = props.home;
  if (value === false || (typeof value === "string" && /^(false|off|no|hidden)$/i.test(value.trim()))) {
    return { shown: false, sections: [...PROJECT_DEFAULT] };
  }
  return { shown: true, sections: chosen(value, PROJECT_SECTIONS, PROJECT_DEFAULT) };
}

/** The `home` property for these settings: null (removed) for the usual
 * home, so a project page keeps no setting it does not need. */
export function homeProp({ shown, sections }: ProjectHomeSettings): unknown {
  if (!shown) return false;
  return sameList(sections, PROJECT_DEFAULT) ? null : [...sections];
}
