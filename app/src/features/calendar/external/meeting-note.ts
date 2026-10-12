// "Make meeting note": a page from the vault's meeting template, titled and
// dated as the event is, with the event's link among its properties. Made
// only when asked, through the same create the page gallery uses, so the
// core keeps the template, the tag and its schema. An event is never copied
// into the notes otherwise.

import type { NoteFile } from "../../../lib/vault/types";
import type { Draft } from "../../workspace/store-types";
import { useWorkspace } from "../../workspace/store";
import type { ExternalEvent } from "./types";

/** The template's name and where a vault keeps it. */
const TEMPLATE = "meeting";
const TEMPLATE_PATH = "templates/meeting.md";

/** What the new page is made from. Without a meeting template in the vault
 * the page is plain, still tagged and dated. */
export function meetingDraft(event: ExternalEvent, hasTemplate: boolean): Draft {
  const day = event.start.slice(0, 10);
  const props: Record<string, unknown> = { date: day };
  if (event.link) props.url = event.link;
  return {
    kind: "page",
    title: event.title.trim() || "Meeting",
    // A time as well, so the template's time variables are the event's.
    date: event.allDay ? day : event.start,
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
