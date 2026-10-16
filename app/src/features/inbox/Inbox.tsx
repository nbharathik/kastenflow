import { useEffect, useMemo, useState } from "react";

import { dayFrom } from "../../lib/dates";
import { useWorkspace } from "../workspace/store";
import { inboxCards } from "../workspace/tree";
import { Capture } from "../workspace/views/Capture";
import { CaptureList } from "./CaptureList";
import { deferredFrom, queueOf } from "./queue";
import { Triage } from "./Triage";
import { Icon } from "../../ui/Icon";

/** The Inbox: quick notes by the day they were caught, newest first.
 * Each can be tagged, put on a
 * board, moved, made a page or marked done; Triage takes the captures one at
 * a time (`triage` opens it at once, as the palette's "Triage captures" does). */
export function Inbox({ triage: start = false }: { triage?: boolean }) {
  const notes = useWorkspace((s) => s.notes);
  const today = dayFrom(0);
  const cards = inboxCards(notes);
  // The cards triage goes through: the Inbox and unfiled captures, less those put off.
  const queue = useMemo(() => queueOf(notes, today), [notes, today]);
  const later = useMemo(() => deferredFrom(notes, today).length, [notes, today]);
  const [triage, setTriage] = useState(start);
  // Going to the Inbox, or to its triage, from elsewhere in the window follows the place; stopping triage is the Inbox's own.
  useEffect(() => {
    setTriage(start);
  }, [start]);

  return (
    <div className="mx-auto w-full max-w-[780px] px-6 pb-24 pt-10 sm:px-12">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-28 font-bold tracking-tight">
          <Icon name="inbox" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
          Inbox
        </h1>
        {queue.length > 0 && !triage && (
          <button
            type="button"
            onClick={() => setTriage(true)}
            className="rounded-lg bg-accent px-3 py-1.5 text-13 font-medium text-on-accent shadow-card transition hover:brightness-110"
            title="One capture at a time, with keys"
          >
            Triage {queue.length}
          </button>
        )}
      </div>
      <p className="mt-1 text-14 text-muted">
        Catch thoughts here, then give each a home: a project, a board, a tag, or the trash when it is done.
        {later > 0 && !triage ? ` ${later} put off until later.` : ""}
      </p>
      {triage ? (
        <Triage cards={queue} onExit={() => setTriage(false)} />
      ) : (
        <>
          <Capture autoFocus />
          <CaptureList cards={cards} />
        </>
      )}
    </div>
  );
}
