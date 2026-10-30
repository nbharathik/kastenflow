// One note as a compact row: icon, title and a detail at the right. Right-click
// shows the Open menu; the middle button opens a tab. Kept apart from the
// tiles, which carry the thumbnails of boards and decks.

import type { MouseEvent, ReactNode } from "react";

import { relativeTime } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { openMenuHandlers } from "../../shell/open-menu";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { iconOf, titleOf } from "../workspace/names";
import { howFrom, useWorkspace } from "../workspace/store";

/** Opens the path as the click asks (Ctrl for a tab, Alt+Ctrl to the right...). */
export const openOnClick = (path: string) => (event: MouseEvent) => useWorkspace.getState().openPath(path, howFrom(event));

export function NoteRow({ note, detail }: { note: NoteMeta; detail?: ReactNode }) {
  return (
    <button type="button" data-rove="" onClick={openOnClick(note.path)} {...openMenuHandlers(note.path)} className="kasten-dash-row">
      <span className="kasten-dash-row-icon" aria-hidden="true">
        <IconOrEmoji icon={iconOf(note)} />
      </span>
      <span className="kasten-dash-row-title">{titleOf(note)}</span>
      <span className="kasten-dash-row-detail">{detail ?? relativeTime(note.modified)}</span>
    </button>
  );
}
