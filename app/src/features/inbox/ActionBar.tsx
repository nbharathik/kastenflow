// The buttons under a capture in triage. Every one has a key (triage-keys.ts)
// and says it on its face; the pickers open above their button.

import type { NoteMeta } from "../../lib/vault/types";
import { BoardAction, TagAction } from "./CardActions";
import { CollectionAction, LaterAction } from "./TriagePickers";
import { readingOf } from "./queue";
import type { TriageAct } from "./triage-keys";

export type Picking = "tag" | "board" | "collection" | "later";

interface Props {
  card: NoteMeta;
  picking: Picking | null;
  setPicking(picking: Picking | null): void;
  run(act: TriageAct): void;
}

const kbd = "rounded bg-line/70 px-1.5 font-sans text-11";

export function ActionBar({ card, picking, setPicking, run }: Props) {
  const pick = (what: Picking) => ({ open: picking === what, onOpen: () => setPicking(what), onClose: () => setPicking(null) });
  const reading = readingOf(card);
  const plain: [TriageAct, string, string, string][] = [
    ["move", "M", "Project", "Move to a project"],
    ["task", "N", "Task", "Make a task that links this card"],
    ["archive", "A", "Archive", "Keep it and take it out of the queue"],
    ["reading", "R", reading ? `Reading: ${reading}` : "Reading", "Mark Unread, Reading or Finished"],
    ["page", "P", "Page", "Make it a page, in Pages"],
    ["done", "D", "Done", "Move it to the trash"],
    ["open", "↵", "Open", "Open the card"],
    ["stop", "Esc", "Stop", "Back to the list"],
  ];
  return (
    <div role="toolbar" aria-label="What to do with this card" className="mt-4 flex flex-wrap gap-2">
      <TagAction path={card.path} hint="T" {...pick("tag")} />
      <BoardAction path={card.path} hint="B" {...pick("board")} />
      <CollectionAction card={card} hint="C" {...pick("collection")} />
      <LaterAction card={card} hint="L" {...pick("later")} />
      {plain.map(([act, key, label, hint]) => (
        <button key={act} type="button" title={hint} aria-keyshortcuts={key === "↵" ? "Enter" : key} onClick={() => run(act)} className="ui-btn">
          <kbd className={kbd}>{key}</kbd>
          {label}
        </button>
      ))}
    </div>
  );
}
