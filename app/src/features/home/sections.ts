// Home's sections: what each one is, where it sits and the simple set that
// shows until the person changes it. The person's choice is the window
// preference `homeSections`.

import { chosen, type SectionDef } from "../dashboard/sections";

export type HomeSection = "favourites" | "projects" | "recent" | "pages" | "schedule" | "todo" | "inbox" | "week" | "journal" | "boards" | "decks";

/** `main` sections stack in the wide column, `side` ones in the slim column beside it. */
export const HOME_SECTIONS: readonly SectionDef<HomeSection>[] = [
  { id: "favourites", label: "Favourites", icon: "star", hint: "A thin row of the notes you starred", zone: "main" },
  { id: "projects", label: "Projects", icon: "project", hint: "One row of project chips", zone: "main" },
  { id: "recent", label: "Recent", icon: "clock", hint: "What you opened and edited last, with filters", zone: "main" },
  { id: "pages", label: "Pages", icon: "page", hint: "Every project's pages, and the rest", zone: "main" },
  { id: "schedule", label: "Today", icon: "calendar", hint: "Today's events and dated to-dos, with times", zone: "side" },
  { id: "todo", label: "To-dos", icon: "tasks", hint: "The first open to-dos, and a field to add one", zone: "side" },
  { id: "inbox", label: "Inbox", icon: "inbox", hint: "Quick notes waiting to be sorted", zone: "side" },
  { id: "week", label: "This week", icon: "calendar-days", hint: "The next seven days, with their to-dos", zone: "side" },
  { id: "journal", label: "Journal", icon: "journal", hint: "Today's page and the days before", zone: "side" },
  { id: "boards", label: "Whiteboards", icon: "board", hint: "Your latest whiteboards", zone: "side" },
  { id: "decks", label: "Decks", icon: "present", hint: "Your latest slide decks", zone: "side" },
];

/** The simple layout: a list of recent work and a slim column of today, to-dos and the Inbox. */
export const HOME_DEFAULT: readonly HomeSection[] = ["favourites", "recent", "schedule", "todo", "inbox"];

/** The sections Home shows for the saved preference. */
export const homeSections = (saved: readonly string[] | null): HomeSection[] => chosen(saved, HOME_SECTIONS, HOME_DEFAULT);

/** The shown sections that sit in `zone`, in the person's order. */
export const inZone = (sections: readonly HomeSection[], zone: "main" | "side"): HomeSection[] => sections.filter((id) => HOME_SECTIONS.find((d) => d.id === id)?.zone === zone);
