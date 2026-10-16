// The note selected in a collection, beside the list, so the list keeps its
// place while a note is read. Opening, peeking and the other actions are the
// ones the Library has; this pane writes nothing.

import type { MouseEvent } from "react";

import { relativeTime } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { Button } from "../../ui/Button";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { iconOf, titleOf } from "../workspace/names";
import { howFrom, useWorkspace } from "../workspace/store";
import { addToAiContext, peekNote } from "./actions";

export function PreviewPane({ note, onClose, onBoard }: { note: NoteMeta; onClose(): void; onBoard(): void }) {
  const open = (event: MouseEvent) => useWorkspace.getState().openPath(note.path, howFrom(event));
  const where = note.project ? note.project : note.path.startsWith("inbox/") ? "Inbox" : "Pages";
  return (
    <aside aria-label="Preview" className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-18">
          <IconOrEmoji icon={iconOf(note)} />
        </span>
        <h2 className="min-w-0 flex-1 break-words text-16 font-semibold">{titleOf(note)}</h2>
        <button type="button" aria-label="Close the preview" title="Close the preview" onClick={onClose} className="rounded px-1.5 text-muted hover:bg-hover hover:text-ink">
          ×
        </button>
      </div>
      <p className="text-12 text-muted">
        {where} · {note.kind} · changed {relativeTime(note.modified)}
      </p>
      {note.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Tags">
          {note.tags.map((tag) => (
            <li key={tag} className="rounded bg-well px-1.5 py-0.5 text-12 text-muted">
              #{tag}
            </li>
          ))}
        </ul>
      )}
      {note.excerpt ? <p className="whitespace-pre-wrap text-14 leading-relaxed">{note.excerpt}</p> : <p className="text-14 text-muted">Nothing written yet.</p>}
      {Object.keys(note.props).length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-13">
          {Object.entries(note.props)
            .slice(0, 8)
            .map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted">{key}</dt>
                <dd className="min-w-0 truncate">{Array.isArray(value) ? value.join(", ") : String(value ?? "")}</dd>
              </div>
            ))}
        </dl>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button tone="primary" size="sm" onClick={open}>
          Open
        </Button>
        <Button size="sm" onClick={() => peekNote(note.path)}>
          Peek
        </Button>
        <Button size="sm" onClick={onBoard}>
          Add to board…
        </Button>
        <Button size="sm" onClick={() => addToAiContext([note])}>
          Add to AI context
        </Button>
      </div>
    </aside>
  );
}
