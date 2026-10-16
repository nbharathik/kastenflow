import { type JSX, useEffect, useState } from "react";

import { type RehearsalRecord, compareRuns, lastRunFor, revisionOf } from "../../present/rehearsal.ts";
import { durationText, whenText } from "../../present/rehearsal-text.ts";
import { RehearsalSummary } from "../../present/RehearsalSummary.tsx";
import { runCommand } from "../commands/index.ts";
import { rehearsalsOf } from "../rehearsal-host.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditor } from "../useEditor.ts";
import type { DialogProps } from "./types.ts";
import "./rehearsals.css";

/**
 * The rehearsals kept for this deck, newest first: when, how long, and whether the deck was the same then (a run of a deck whose slides or
 * steps have changed since is marked outdated). Choosing one shows how long each slide took beside the run before it. A new rehearsal starts
 * from here too.
 */
export function RehearsalsDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const store = rehearsalsOf(session.host);
  const [runs, setRuns] = useState<RehearsalRecord[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    store.list(deck.id).then(
      (found) => live && setRuns(found),
      () => live && setRuns([]),
    );
    return () => {
      live = false;
    };
  }, [store, deck.id]);

  const revision = revisionOf(deck);
  const newest = runs ? [...runs.keys()].reverse() : [];
  const record = runs && open !== null ? runs[open] : undefined;
  const before = runs && record && open !== null ? lastRunFor(runs.slice(0, open), record.revision) : undefined;

  return (
    <Dialog
      title="Rehearsals"
      width={640}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Close</TextButton>
          <TextButton
            primary
            onClick={() => {
              onClose();
              void runCommand("view.rehearse", { session, ui });
            }}
          >
            Rehearse now
          </TextButton>
        </>
      }
    >
      {runs === null ? <p className="ks-tm-empty">Looking for your rehearsals…</p> : null}
      {runs?.length === 0 ? <p className="ks-tm-empty">This deck has not been rehearsed. Rehearse it, and each run is kept here with the time of every slide.</p> : null}
      {runs && runs.length > 0 ? (
        <ul className="ks-rh-list" aria-label="Rehearsals, newest first">
          {newest.map((i) => {
            const run = runs[i];
            if (!run) return null;
            return (
              <li key={`${run.at}-${i}`}>
                <button type="button" className="ks-btn ks-rh-run" aria-pressed={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  <span>{whenText(run.at)}</span>
                  <span>{durationText(run.totalMs)}</span>
                  {run.revision !== revision ? <span className="ks-rh-outdated">Outdated: the deck has changed since</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {record ? <RehearsalSummary deck={deck} record={record} comparison={compareRuns(record, before, deck)} inline /> : null}
    </Dialog>
  );
}
