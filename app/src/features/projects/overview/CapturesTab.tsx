// The overview's Captures tab: the notes tagged `capture` that are in this
// project, and those that are not filed in any project yet, each with a "File
// here" that moves it into the project (the core's move, which Undo takes back).
// Until anything is captured the tab says what captures are.

import type { ReactNode } from "react";

import { relativeTime } from "../../../lib/dates";
import type { NoteMeta } from "../../../lib/vault/types";
import { Button } from "../../../ui/Button";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { openMenuHandlers } from "../../../shell/open-menu";
import { iconOf, titleOf } from "../../workspace/names";
import { howFromView, useWorkspace } from "../../workspace/store";
import { CAPTURE_TAG, capturesOf } from "./items";

interface Props {
  folder: string;
  projectTitle: string;
  notes: readonly NoteMeta[];
}

export function CapturesTab({ folder, projectTitle, notes }: Props) {
  const { filed, unfiled } = capturesOf(notes, folder);
  const move = useWorkspace((s) => s.move);

  const fileAll = async () => {
    let moved = 0;
    for (const note of unfiled) if (await move(note.path, folder, true)) moved++;
    useWorkspace.getState().toast(`Filed ${moved} ${moved === 1 ? "capture" : "captures"} in ${projectTitle}`);
  };

  if (filed.length === 0 && unfiled.length === 0) {
    return (
      <div className="kasten-overview-empty">
        <p className="text-14 font-medium text-ink">No captures yet</p>
        <p className="mt-1 text-13">Notes tagged #{CAPTURE_TAG} are the things you caught on the way: quick notes, and the pages and selections the browser tab and the browser extension send. They show up here, ready to file in this project.</p>
      </div>
    );
  }
  return (
    <div className="kasten-overview-captures">
      {unfiled.length > 0 && (
        <section aria-label="Not filed yet">
          <div className="kasten-overview-section-head">
            <h2 className="text-14 font-semibold">Not filed yet</h2>
            <span className="text-13 text-muted">{unfiled.length}</span>
            <span className="flex-1" />
            {unfiled.length > 1 && (
              <Button size="sm" onClick={() => void fileAll()}>
                File all here
              </Button>
            )}
          </div>
          <ul className="kasten-overview-list">
            {unfiled.map((note) => (
              <Capture key={note.path} note={note} action={<Button size="sm" onClick={() => void move(note.path, folder)} aria-label={`File ${titleOf(note)} in ${projectTitle}`}>File here</Button>} />
            ))}
          </ul>
        </section>
      )}
      {filed.length > 0 && (
        <section aria-label="In this project">
          <div className="kasten-overview-section-head">
            <h2 className="text-14 font-semibold">In this project</h2>
            <span className="text-13 text-muted">{filed.length}</span>
          </div>
          <ul className="kasten-overview-list">
            {filed.map((note) => (
              <Capture key={note.path} note={note} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Capture({ note, action }: { note: NoteMeta; action?: ReactNode }) {
  const open = useWorkspace((s) => s.openPath);
  return (
    <li className="kasten-overview-capture">
      <button type="button" className="kasten-overview-open" onClick={(event) => open(note.path, howFromView(event))} {...openMenuHandlers(note.path)}>
        <span className="kasten-overview-icon" aria-hidden="true">
          <IconOrEmoji icon={iconOf(note)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-14">{titleOf(note)}</span>
          {note.excerpt && <span className="block truncate text-13 text-muted">{note.excerpt}</span>}
        </span>
        <span className="shrink-0 text-12 text-muted">{relativeTime(note.modified)}</span>
      </button>
      {action}
    </li>
  );
}
