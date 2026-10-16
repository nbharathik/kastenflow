// "Make meeting note": a page from the vault's meeting template, titled and
// dated as the event is, with the event's link among its properties. Made
// only when asked, through the same create the page gallery uses, so the
// core keeps the template, the tag and its schema. An event is never copied
// into the notes otherwise. Dropping an event on a day asks the same for that
// day (`makeEventNote`) and offers Undo; neither writes to the calendar.

import { isDay, shortDay } from "../../../lib/dates";
import type { NoteFile } from "../../../lib/vault/types";
import type { Draft } from "../../workspace/store-types";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import type { ExternalEvent } from "./types";

/** The template's name and where a vault keeps it. */
const TEMPLATE = "meeting";
const TEMPLATE_PATH = "templates/meeting.md";

/** What the new page is made from. Without a meeting template in the vault
 * the page is plain, still tagged and dated. `day` is the day the note is for
 * (the event's own by default): an event dropped on another day keeps its
 * hour there. */
export function meetingDraft(event: ExternalEvent, hasTemplate: boolean, day = event.start.slice(0, 10)): Draft {
  const props: Record<string, unknown> = { date: day };
  if (event.link) props.url = event.link;
  return {
    kind: "page",
    title: event.title.trim() || "Meeting",
    // A time as well, so the template's time variables are the event's.
    date: event.allDay ? day : `${day}${event.start.slice(10)}`,
    template: hasTemplate ? TEMPLATE : null,
    tags: hasTemplate ? undefined : ["meeting"],
    props,
  };
}

/** Makes the page and opens it; null when it could not be made (the window
 * has already said why). */
export function makeMeetingNote(event: ExternalEvent): Promise<NoteFile | null> {
  const workspace = useWorkspace.getState();
  const hasTemplate = workspace.notes.some((note) => note.path === TEMPLATE_PATH);
  return workspace.create(meetingDraft(event, hasTemplate), true);
}

/** Makes the note for an event dropped on `day`, without opening it; the
 * notice offers Undo, which moves the note to the trash. Null when it could
 * not be made. */
export async function makeEventNote(event: ExternalEvent, day: string): Promise<NoteFile | null> {
  if (!isDay(day)) return null;
  const workspace = useWorkspace.getState();
  const hasTemplate = workspace.notes.some((note) => note.path === TEMPLATE_PATH);
  const draft = meetingDraft(event, hasTemplate, day);
  // The template links the day itself; a plain page is given the link, with the hour, so the day lists it.
  if (!hasTemplate) draft.body = `**When:** [[${day}]]${event.allDay ? "" : ` ${event.start.slice(11, 16)}`}\n`;
  const note = await workspace.create(draft, false);
  if (!note) return null;
  useWorkspace.getState().toast(`Made “${titleOf(note.meta)}” for ${shortDay(day)}`, { label: "Undo", run: () => void useWorkspace.getState().trash(note.meta.path, true) });
  return note;
}
